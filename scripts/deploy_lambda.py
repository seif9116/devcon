"""
Deploy the devcon-evaluate-explanation Lambda function.

Creates an IAM role with Bedrock permissions, packages the handler,
deploys (or updates) the Lambda function, and creates a Function URL
with CORS enabled.  Saves the function URL back to scripts/kb_config.json.

NOTE: The AWS account has Lambda public-access-block enabled, so the
Function URL uses AWS_IAM auth.  Callers must sign requests with SigV4
(e.g. from a Next.js API route using the SDK).
"""

import io
import json
import time
import zipfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGION = "us-east-1"
FUNCTION_NAME = "devcon-evaluate-explanation"
ROLE_NAME = "devcon-lambda-evaluation-role"
RUNTIME = "python3.13"
ACCOUNT_ID = "975050247261"

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "kb_config.json"
HANDLER_PATH = SCRIPT_DIR / "lambda" / "handler.py"

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

iam = boto3.client("iam", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


def create_lambda_role(kb_id: str) -> str:
    """Create (or reuse) an IAM role for the Lambda function.

    Returns the role ARN.
    """
    trust_policy = json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"Service": "lambda.amazonaws.com"},
                    "Action": "sts:AssumeRole",
                }
            ],
        }
    )

    # --- Create role ---
    try:
        response = iam.create_role(
            RoleName=ROLE_NAME,
            AssumeRolePolicyDocument=trust_policy,
            Description="Execution role for devcon-evaluate-explanation Lambda",
        )
        role_arn = response["Role"]["Arn"]
        print(f"  Created IAM role: {role_arn}")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "EntityAlreadyExists":
            role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME}"
            print(f"  IAM role already exists: {role_arn}")
        else:
            raise

    # --- Attach basic execution policy ---
    iam.attach_role_policy(
        RoleName=ROLE_NAME,
        PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    )
    print("  Attached AWSLambdaBasicExecutionRole")

    # --- Inline policy for Bedrock access ---
    bedrock_policy = json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": "bedrock:InvokeModel",
                    "Resource": "*",
                },
                {
                    "Effect": "Allow",
                    "Action": "bedrock:Retrieve",
                    "Resource": f"arn:aws:bedrock:{REGION}:{ACCOUNT_ID}:knowledge-base/{kb_id}",
                },
            ],
        }
    )

    iam.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName="bedrock-access",
        PolicyDocument=bedrock_policy,
    )
    print("  Attached inline bedrock-access policy")

    # IAM propagation delay
    print("  Waiting 10s for IAM propagation...")
    time.sleep(10)

    return role_arn


def create_zip() -> bytes:
    """Create an in-memory zip of the Lambda handler.

    Returns the zip bytes.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(HANDLER_PATH, "handler.py")
    buf.seek(0)
    zip_bytes = buf.read()
    print(f"  Created deployment zip ({len(zip_bytes)} bytes)")
    return zip_bytes


def deploy_function(role_arn: str, kb_id: str) -> None:
    """Create or update the Lambda function."""
    zip_bytes = create_zip()

    env_vars = {"Variables": {"KB_ID": kb_id}}

    try:
        lambda_client.create_function(
            FunctionName=FUNCTION_NAME,
            Runtime=RUNTIME,
            Role=role_arn,
            Handler="handler.handler",
            Code={"ZipFile": zip_bytes},
            Timeout=60,
            MemorySize=256,
            Environment=env_vars,
            Description="Evaluate candidate explanations for ABST exam prep",
        )
        print(f"  Created Lambda function: {FUNCTION_NAME}")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceConflictException":
            print(f"  Function already exists, updating...")
            # Update configuration first
            lambda_client.update_function_configuration(
                FunctionName=FUNCTION_NAME,
                Runtime=RUNTIME,
                Role=role_arn,
                Handler="handler.handler",
                Timeout=60,
                MemorySize=256,
                Environment=env_vars,
                Description="Evaluate candidate explanations for ABST exam prep",
            )
            # Wait for the config update to complete
            print("  Waiting for configuration update...")
            waiter = lambda_client.get_waiter("function_updated_v2")
            waiter.wait(FunctionName=FUNCTION_NAME)

            # Update code
            lambda_client.update_function_code(
                FunctionName=FUNCTION_NAME,
                ZipFile=zip_bytes,
            )
            print(f"  Updated Lambda function: {FUNCTION_NAME}")
        else:
            raise

    # Wait for function to be Active
    print("  Waiting for function to become Active...")
    waiter = lambda_client.get_waiter("function_active_v2")
    waiter.wait(FunctionName=FUNCTION_NAME)
    print("  Function is Active")


def create_function_url() -> str:
    """Create a Function URL with CORS and AWS_IAM auth.

    The AWS account has public-access-block enabled, so we use AWS_IAM
    auth.  Callers (e.g. Next.js API routes) must sign requests with
    SigV4.

    Returns the function URL.
    """
    # --- Create Function URL config (AWS_IAM auth) ---
    try:
        response = lambda_client.create_function_url_config(
            FunctionName=FUNCTION_NAME,
            AuthType="AWS_IAM",
            Cors={
                "AllowOrigins": ["*"],
                "AllowMethods": ["*"],
                "AllowHeaders": ["content-type"],
            },
        )
        url = response["FunctionUrl"]
        print(f"  Created Function URL: {url}")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceConflictException":
            # URL config already exists -- update it and fetch the URL
            lambda_client.update_function_url_config(
                FunctionName=FUNCTION_NAME,
                AuthType="AWS_IAM",
                Cors={
                    "AllowOrigins": ["*"],
                    "AllowMethods": ["*"],
                    "AllowHeaders": ["content-type"],
                },
            )
            response = lambda_client.get_function_url_config(
                FunctionName=FUNCTION_NAME,
            )
            url = response["FunctionUrl"]
            print(f"  Function URL already exists (updated): {url}")
        else:
            raise

    # --- Grant the current IAM user/role permission to invoke ---
    try:
        lambda_client.add_permission(
            FunctionName=FUNCTION_NAME,
            StatementId="AllowIAMInvokeFunctionUrl",
            Action="lambda:InvokeFunctionUrl",
            Principal=ACCOUNT_ID,
            FunctionUrlAuthType="AWS_IAM",
        )
        print("  Added IAM invoke permission for account")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceConflictException":
            print("  IAM invoke permission already exists")
        else:
            raise

    return url


def main():
    """Orchestrate the full deployment."""
    # --- Load config ---
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    kb_id = config["kb_id"]
    print(f"Loaded config: KB_ID={kb_id}, region={config['region']}")

    # --- Step 1: IAM role ---
    print("\n[1/4] Creating IAM role...")
    role_arn = create_lambda_role(kb_id)

    # --- Step 2: Deploy function ---
    print("\n[2/4] Deploying Lambda function...")
    deploy_function(role_arn, kb_id)

    # --- Step 3: Function URL ---
    print("\n[3/4] Creating Function URL...")
    url = create_function_url()

    # --- Step 4: Save config ---
    print("\n[4/4] Saving config...")
    config["lambda_url"] = url
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Saved lambda_url to {CONFIG_PATH}")

    print(f"\nDone!  Lambda URL: {url}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Create a Bedrock Knowledge Base backed by OpenSearch Serverless (AOSS)
for the Alberta Basic Security Training (ABST) participant manual.

Idempotent: re-running skips resources that already exist.
Saves KB ID to scripts/kb_config.json for downstream consumers.
"""

import boto3
import json
import os
import sys
import time

from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGION = "us-west-2"
ACCOUNT_ID = "975050247261"
BUCKET_NAME = f"devcon-abst-pdf-{ACCOUNT_ID}-west2"
KB_NAME = "devcon-abst-kb"
KB_ROLE_NAME = "devcon-abst-kb-role"
EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"
EMBEDDING_MODEL_ARN = f"arn:aws:bedrock:{REGION}::foundation-model/{EMBEDDING_MODEL}"
COLLECTION_NAME = "devcon-abst-vectors"
INDEX_NAME = "bedrock-kb-index"
VECTOR_FIELD = "bedrock-knowledge-base-default-vector"
TEXT_FIELD = "AMAZON_BEDROCK_TEXT_CHUNK"
METADATA_FIELD = "AMAZON_BEDROCK_METADATA"

PDF_SOURCE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "abst-particpants-manual-oct-2014-2 (1).pdf",
)
PDF_S3_KEY = "abst-manual.pdf"

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kb_config.json")

# Clients
sts = boto3.client("sts", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)
iam = boto3.client("iam", region_name=REGION)
aoss = boto3.client("opensearchserverless", region_name=REGION)
bedrock_agent = boto3.client("bedrock-agent", region_name=REGION)

CALLER_ARN = sts.get_caller_identity()["Arn"]
# For assumed roles, also include the role ARN itself for AOSS data access
# e.g. arn:aws:sts::...:assumed-role/WSParticipantRole/Participant -> arn:aws:iam::...:role/WSParticipantRole
CALLER_ROLE_ARN = None
if ":assumed-role/" in CALLER_ARN:
    parts = CALLER_ARN.split(":")
    role_path = parts[5]  # assumed-role/WSParticipantRole/Participant
    role_name = role_path.split("/")[1]
    CALLER_ROLE_ARN = f"arn:aws:iam::{ACCOUNT_ID}:role/{role_name}"


# ---------------------------------------------------------------------------
# 1. S3 bucket + upload PDF
# ---------------------------------------------------------------------------

def create_s3_bucket():
    """Create the S3 bucket (if needed) and upload the ABST PDF."""
    print("\n=== Step 1: S3 bucket ===")

    # Create bucket
    try:
        if REGION == "us-east-1":
            s3.create_bucket(Bucket=BUCKET_NAME)
        else:
            s3.create_bucket(
                Bucket=BUCKET_NAME,
                CreateBucketConfiguration={"LocationConstraint": REGION},
            )
        print(f"  Created bucket: {BUCKET_NAME}")
    except s3.exceptions.BucketAlreadyOwnedByYou:
        print(f"  Bucket already exists: {BUCKET_NAME}")
    except Exception as e:
        if "BucketAlreadyOwnedByYou" in str(e) or "BucketAlreadyExists" in str(e):
            print(f"  Bucket already exists: {BUCKET_NAME}")
        else:
            raise

    # Upload PDF
    print(f"  Uploading {PDF_SOURCE} -> s3://{BUCKET_NAME}/{PDF_S3_KEY}")
    s3.upload_file(PDF_SOURCE, BUCKET_NAME, PDF_S3_KEY)
    print("  Upload complete.")


# ---------------------------------------------------------------------------
# 2. OpenSearch Serverless collection
# ---------------------------------------------------------------------------

def create_aoss_collection():
    """Create AOSS encryption/network/access policies and a VECTORSEARCH collection."""
    print("\n=== Step 2: AOSS collection ===")

    # --- Encryption policy ---
    enc_policy_name = f"{COLLECTION_NAME}-enc"
    try:
        aoss.create_security_policy(
            name=enc_policy_name,
            type="encryption",
            policy=json.dumps({
                "Rules": [{"ResourceType": "collection", "Resource": [f"collection/{COLLECTION_NAME}"]}],
                "AWSOwnedKey": True,
            }),
        )
        print(f"  Created encryption policy: {enc_policy_name}")
    except Exception as e:
        if "ConflictException" in str(type(e).__name__) or "already exists" in str(e).lower() or "ConflictException" in str(e):
            print(f"  Encryption policy already exists: {enc_policy_name}")
        else:
            raise

    # --- Network policy ---
    net_policy_name = f"{COLLECTION_NAME}-net"
    try:
        aoss.create_security_policy(
            name=net_policy_name,
            type="network",
            policy=json.dumps([{
                "Rules": [
                    {"ResourceType": "collection", "Resource": [f"collection/{COLLECTION_NAME}"]},
                    {"ResourceType": "dashboard", "Resource": [f"collection/{COLLECTION_NAME}"]},
                ],
                "AllowFromPublic": True,
            }]),
        )
        print(f"  Created network policy: {net_policy_name}")
    except Exception as e:
        if "ConflictException" in str(type(e).__name__) or "already exists" in str(e).lower() or "ConflictException" in str(e):
            print(f"  Network policy already exists: {net_policy_name}")
        else:
            raise

    # --- Create collection ---
    collection_id = None
    collection_arn = None
    endpoint = None

    # Check if collection already exists
    existing = aoss.list_collections(
        collectionFilters={"name": COLLECTION_NAME}
    ).get("collectionSummaries", [])

    if existing:
        collection_id = existing[0]["id"]
        collection_arn = existing[0]["arn"]
        print(f"  Collection already exists: {collection_id}")
    else:
        resp = aoss.create_collection(
            name=COLLECTION_NAME,
            type="VECTORSEARCH",
        )
        collection_id = resp["createCollectionDetail"]["id"]
        collection_arn = resp["createCollectionDetail"]["arn"]
        print(f"  Created collection: {collection_id}")

    # Wait for ACTIVE
    print("  Waiting for collection to become ACTIVE (this can take a few minutes)...")
    while True:
        details = aoss.batch_get_collection(ids=[collection_id])["collectionDetails"]
        if details:
            status = details[0].get("status")
            endpoint = details[0].get("collectionEndpoint")
            print(f"    Status: {status}")
            if status == "ACTIVE":
                break
        time.sleep(15)

    print(f"  Collection endpoint: {endpoint}")

    # --- Data access policy (needed for the KB role AND us to create the index) ---
    access_policy_name = f"{COLLECTION_NAME}-access"
    kb_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{KB_ROLE_NAME}"

    principals = [kb_role_arn]
    if CALLER_ROLE_ARN:
        principals.append(CALLER_ROLE_ARN)
    if CALLER_ARN not in principals:
        principals.append(CALLER_ARN)

    access_policy_doc = json.dumps([{
        "Rules": [
            {
                "ResourceType": "collection",
                "Resource": [f"collection/{COLLECTION_NAME}"],
                "Permission": [
                    "aoss:CreateCollectionItems",
                    "aoss:DeleteCollectionItems",
                    "aoss:UpdateCollectionItems",
                    "aoss:DescribeCollectionItems",
                ],
            },
            {
                "ResourceType": "index",
                "Resource": [f"index/{COLLECTION_NAME}/*"],
                "Permission": [
                    "aoss:CreateIndex",
                    "aoss:DeleteIndex",
                    "aoss:UpdateIndex",
                    "aoss:DescribeIndex",
                    "aoss:ReadDocument",
                    "aoss:WriteDocument",
                ],
            },
        ],
        "Principal": principals,
    }])

    try:
        aoss.create_access_policy(
            name=access_policy_name,
            type="data",
            policy=access_policy_doc,
        )
        print(f"  Created data access policy: {access_policy_name}")
    except Exception as e:
        if "ConflictException" in str(type(e).__name__) or "already exists" in str(e).lower() or "ConflictException" in str(e):
            print(f"  Data access policy already exists, updating...")
            try:
                aoss.update_access_policy(
                    name=access_policy_name,
                    type="data",
                    policy=access_policy_doc,
                    policyVersion=aoss.get_access_policy(name=access_policy_name, type="data")["accessPolicyDetail"]["policyVersion"],
                )
                print(f"  Updated data access policy: {access_policy_name}")
            except Exception as update_err:
                if "No changes detected" in str(update_err):
                    print(f"  Data access policy unchanged: {access_policy_name}")
                else:
                    raise
        else:
            raise

    return collection_arn, endpoint, collection_id


# ---------------------------------------------------------------------------
# 3. IAM role for the Knowledge Base
# ---------------------------------------------------------------------------

def create_kb_role(collection_arn):
    """Create IAM role trusted by Bedrock with S3, AOSS, and embedding perms."""
    print("\n=== Step 3: IAM role ===")

    trust_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "bedrock.amazonaws.com"},
            "Action": "sts:AssumeRole",
            "Condition": {
                "StringEquals": {"aws:SourceAccount": ACCOUNT_ID},
                "ArnLike": {"aws:SourceArn": f"arn:aws:bedrock:{REGION}:{ACCOUNT_ID}:knowledge-base/*"},
            },
        }],
    })

    # Create role
    try:
        resp = iam.create_role(
            RoleName=KB_ROLE_NAME,
            AssumeRolePolicyDocument=trust_policy,
            Description="Bedrock KB role for ABST Knowledge Base",
        )
        role_arn = resp["Role"]["Arn"]
        print(f"  Created role: {role_arn}")
    except iam.exceptions.EntityAlreadyExistsException:
        role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{KB_ROLE_NAME}"
        # Update trust policy in case it changed
        iam.update_assume_role_policy(RoleName=KB_ROLE_NAME, PolicyDocument=trust_policy)
        print(f"  Role already exists: {role_arn}")

    # Inline policy: S3 read
    s3_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": ["s3:GetObject", "s3:ListBucket"],
            "Resource": [
                f"arn:aws:s3:::{BUCKET_NAME}",
                f"arn:aws:s3:::{BUCKET_NAME}/*",
            ],
        }],
    })
    iam.put_role_policy(RoleName=KB_ROLE_NAME, PolicyName="s3-read", PolicyDocument=s3_policy)

    # Inline policy: Bedrock embedding
    bedrock_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": "bedrock:InvokeModel",
            "Resource": EMBEDDING_MODEL_ARN,
        }],
    })
    iam.put_role_policy(RoleName=KB_ROLE_NAME, PolicyName="bedrock-embedding", PolicyDocument=bedrock_policy)

    # Inline policy: AOSS access
    aoss_policy = json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": "aoss:APIAccessAll",
            "Resource": collection_arn,
        }],
    })
    iam.put_role_policy(RoleName=KB_ROLE_NAME, PolicyName="aoss-access", PolicyDocument=aoss_policy)

    print("  Attached inline policies: s3-read, bedrock-embedding, aoss-access")
    print("  Waiting 15s for IAM propagation...")
    time.sleep(15)

    return role_arn


# ---------------------------------------------------------------------------
# 4. Create vector index + Bedrock Knowledge Base
# ---------------------------------------------------------------------------

def create_knowledge_base(role_arn, collection_arn, endpoint):
    """Create the AOSS vector index and the Bedrock Knowledge Base."""
    print("\n=== Step 4: Knowledge Base ===")

    # --- Create vector index in AOSS ---
    # Build an OpenSearch client using SigV4 auth
    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        REGION,
        "aoss",
        session_token=credentials.token,
    )

    # The endpoint from AOSS looks like https://xxx.us-east-1.aoss.amazonaws.com
    host = endpoint.replace("https://", "")

    os_client = OpenSearch(
        hosts=[{"host": host, "port": 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=300,
    )

    # Create index
    index_body = {
        "settings": {
            "index": {
                "knn": True,
            }
        },
        "mappings": {
            "properties": {
                VECTOR_FIELD: {
                    "type": "knn_vector",
                    "dimension": 1024,
                    "method": {
                        "engine": "faiss",
                        "name": "hnsw",
                        "space_type": "l2",
                    },
                },
                TEXT_FIELD: {"type": "text"},
                METADATA_FIELD: {"type": "text"},
            }
        },
    }

    try:
        os_client.indices.create(index=INDEX_NAME, body=index_body)
        print(f"  Created AOSS index: {INDEX_NAME}")
        print("  Waiting 30s for index to propagate...")
        time.sleep(30)
    except Exception as e:
        if "resource_already_exists_exception" in str(e).lower() or "already exists" in str(e).lower():
            print(f"  Index already exists: {INDEX_NAME}")
        else:
            raise

    # --- Create the Bedrock Knowledge Base ---
    # Check if it already exists
    existing_kbs = bedrock_agent.list_knowledge_bases(maxResults=100).get("knowledgeBaseSummaries", [])
    kb_id = None
    for kb in existing_kbs:
        if kb["name"] == KB_NAME:
            kb_id = kb["knowledgeBaseId"]
            print(f"  Knowledge Base already exists: {kb_id}")
            return kb_id

    resp = bedrock_agent.create_knowledge_base(
        name=KB_NAME,
        description="ABST participant manual knowledge base for flashcard explanations",
        roleArn=role_arn,
        knowledgeBaseConfiguration={
            "type": "VECTOR",
            "vectorKnowledgeBaseConfiguration": {
                "embeddingModelArn": EMBEDDING_MODEL_ARN,
            },
        },
        storageConfiguration={
            "type": "OPENSEARCH_SERVERLESS",
            "opensearchServerlessConfiguration": {
                "collectionArn": collection_arn,
                "vectorIndexName": INDEX_NAME,
                "fieldMapping": {
                    "vectorField": VECTOR_FIELD,
                    "textField": TEXT_FIELD,
                    "metadataField": METADATA_FIELD,
                },
            },
        },
    )

    kb_id = resp["knowledgeBase"]["knowledgeBaseId"]
    print(f"  Created Knowledge Base: {kb_id}")
    return kb_id


# ---------------------------------------------------------------------------
# 5. Data source + ingestion
# ---------------------------------------------------------------------------

def create_data_source_and_ingest(kb_id):
    """Create an S3 data source on the KB and start ingestion."""
    print("\n=== Step 5: Data source + ingestion ===")

    ds_name = "abst-pdf-source"

    # Check if data source already exists
    existing_ds = bedrock_agent.list_data_sources(
        knowledgeBaseId=kb_id, maxResults=100
    ).get("dataSourceSummaries", [])

    ds_id = None
    for ds in existing_ds:
        if ds["name"] == ds_name:
            ds_id = ds["dataSourceId"]
            print(f"  Data source already exists: {ds_id}")
            break

    if ds_id is None:
        resp = bedrock_agent.create_data_source(
            knowledgeBaseId=kb_id,
            name=ds_name,
            description="ABST participant manual PDF in S3",
            dataSourceConfiguration={
                "type": "S3",
                "s3Configuration": {
                    "bucketArn": f"arn:aws:s3:::{BUCKET_NAME}",
                },
            },
        )
        ds_id = resp["dataSource"]["dataSourceId"]
        print(f"  Created data source: {ds_id}")

    # Start ingestion
    print("  Starting ingestion job...")
    ingest_resp = bedrock_agent.start_ingestion_job(
        knowledgeBaseId=kb_id,
        dataSourceId=ds_id,
    )
    job_id = ingest_resp["ingestionJob"]["ingestionJobId"]
    print(f"  Ingestion job started: {job_id}")

    # Wait for completion
    print("  Waiting for ingestion to complete...")
    while True:
        job = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            ingestionJobId=job_id,
        )["ingestionJob"]
        status = job["status"]
        print(f"    Ingestion status: {status}")
        if status in ("COMPLETE", "FAILED", "STOPPED"):
            break
        time.sleep(10)

    if status == "COMPLETE":
        stats = job.get("statistics", {})
        print(f"  Ingestion complete! Stats: {json.dumps(stats, default=str)}")
    else:
        print(f"  WARNING: Ingestion ended with status {status}")
        if "failureReasons" in job:
            print(f"  Failure reasons: {job['failureReasons']}")


# ---------------------------------------------------------------------------
# 6. Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Bedrock Knowledge Base Setup for ABST")
    print(f"  Region:     {REGION}")
    print(f"  Account:    {ACCOUNT_ID}")
    print(f"  Caller:     {CALLER_ARN}")
    print(f"  Bucket:     {BUCKET_NAME}")
    print(f"  Collection: {COLLECTION_NAME}")
    print(f"  KB Name:    {KB_NAME}")
    print("=" * 60)

    create_s3_bucket()

    collection_arn, endpoint, collection_id = create_aoss_collection()

    role_arn = create_kb_role(collection_arn)

    kb_id = create_knowledge_base(role_arn, collection_arn, endpoint)

    create_data_source_and_ingest(kb_id)

    # Save config
    config = {
        "kb_id": kb_id,
        "region": REGION,
        "collection_name": COLLECTION_NAME,
        "bucket_name": BUCKET_NAME,
    }
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    print(f"\nConfig saved to {CONFIG_PATH}")
    print(json.dumps(config, indent=2))
    print("\nDone!")


if __name__ == "__main__":
    main()

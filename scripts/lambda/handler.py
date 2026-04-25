"""
Lambda handler for evaluating candidate explanations against ABST manual content.

Receives a question, correct answer, and user explanation via POST.
Retrieves relevant chunks from a Bedrock Knowledge Base, then uses
Claude Opus to score English proficiency and conceptual understanding.

Environment variables:
    KB_ID       – Bedrock Knowledge Base ID
    AWS_REGION  – AWS region (defaults to us-east-1)
"""

import json
import os

import boto3

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

KB_ID = os.environ.get("KB_ID", "SBTCWY1W77")
REGION = os.environ.get("AWS_REGION", "us-east-1")
MODEL_ID = "anthropic.claude-opus-4-6-v1"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

SYSTEM_PROMPT = (
    "You are an evaluator for security guard exam preparation. "
    "You will receive reference material from the ABST manual, an exam question, "
    "the correct answer, and a candidate's explanation of why that answer is correct.\n\n"
    "Evaluate the candidate on two dimensions:\n\n"
    "1. **English Proficiency (1-5):** Assess grammar, sentence structure, spelling, "
    "and overall clarity. A score of 3 means acceptable with minor errors.\n\n"
    "2. **Conceptual Understanding (1-5):** Assess whether the candidate demonstrates "
    "correct concepts and uses proper ABST terminology. A score of 3 means the core "
    "concept is understood with mostly correct terminology.\n\n"
    "You MUST respond with ONLY valid JSON in exactly this format — no extra text, "
    "no markdown fences:\n"
    '{"english":{"score":N,"feedback":"..."},"concepts":{"score":N,"feedback":"..."}}\n\n'
    "Keep feedback to 1-2 sentences each."
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

bedrock_agent_runtime = None
bedrock_runtime = None


def _get_bedrock_agent_runtime():
    global bedrock_agent_runtime
    if bedrock_agent_runtime is None:
        bedrock_agent_runtime = boto3.client(
            "bedrock-agent-runtime", region_name=REGION
        )
    return bedrock_agent_runtime


def _get_bedrock_runtime():
    global bedrock_runtime
    if bedrock_runtime is None:
        bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)
    return bedrock_runtime


def _response(status_code: int, body: dict) -> dict:
    """Build a Lambda Function URL response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _retrieve_context(query: str) -> str:
    """Retrieve relevant chunks from the Bedrock Knowledge Base.

    Returns a combined string of retrieved passages, or a fallback message
    if the retrieval fails for any reason.
    """
    try:
        client = _get_bedrock_agent_runtime()
        response = client.retrieve(
            knowledgeBaseId=KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": 5}
            },
        )
        results = response.get("retrievalResults", [])
        if not results:
            return "(Reference material unavailable)"

        chunks = []
        for i, result in enumerate(results, 1):
            text = result.get("content", {}).get("text", "").strip()
            if text:
                chunks.append(f"[Reference {i}]\n{text}")

        return "\n\n".join(chunks) if chunks else "(Reference material unavailable)"

    except Exception:
        return "(Reference material unavailable)"


def _evaluate(reference: str, question: str, correct_answer: str, explanation: str) -> dict:
    """Call Claude Opus via Bedrock to evaluate the candidate explanation."""
    user_message = (
        f"## Reference Material from ABST Manual\n{reference}\n\n"
        f"## Exam Question\n{question}\n\n"
        f"## Correct Answer\n{correct_answer}\n\n"
        f"## Candidate's Explanation\n{explanation}"
    )

    request_body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 512,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_message}],
        }
    )

    client = _get_bedrock_runtime()
    response = client.invoke_model(
        modelId=MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=request_body,
    )

    response_body = json.loads(response["body"].read())
    assistant_text = response_body["content"][0]["text"].strip()

    # Parse the JSON response from Claude
    return json.loads(assistant_text)


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------


def handler(event, context):
    """AWS Lambda Function URL handler."""

    # ---- CORS preflight ----
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if not method:
        # Fallback: some event formats expose method at top level
        method = event.get("httpMethod", "")

    if method == "OPTIONS":
        return _response(200, {"message": "OK"})

    # ---- Parse body ----
    try:
        body_raw = event.get("body", "")
        if event.get("isBase64Encoded", False):
            import base64
            body_raw = base64.b64decode(body_raw).decode("utf-8")

        body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw

        question_text = body["questionText"]
        correct_answer = body["correctAnswer"]
        user_explanation = body["userExplanation"]

        if not all([question_text, correct_answer, user_explanation]):
            raise ValueError("All fields must be non-empty")

    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        return _response(400, {
            "error": f"Invalid request: {str(exc)}. "
                     "Expected JSON with questionText, correctAnswer, and userExplanation."
        })

    # ---- Retrieve context from Knowledge Base ----
    search_query = f"{question_text} {correct_answer}"
    reference = _retrieve_context(search_query)

    # ---- Evaluate with Claude ----
    try:
        result = _evaluate(reference, question_text, correct_answer, user_explanation)
        return _response(200, result)
    except Exception:
        return _response(500, {"error": "Evaluation failed. Please try again."})

#!/usr/bin/env python3
"""
Generate structured wiki concept pages from the Alberta Basic Security Training
PDF, map questions to wiki pages, upload to S3, and re-index the Bedrock KB.

Usage:
    source scripts/.venv/bin/activate
    python3 scripts/generate_wiki.py
"""

import boto3
import json
import os
import re
import sys
import time

import pdfplumber

# Force unbuffered output so progress is visible
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PDF_PATH = os.path.join(ROOT_DIR, "abst-particpants-manual-oct-2014-2 (1).pdf")

PAGES_JSON_PATH = os.path.join(ROOT_DIR, "public", "wiki", "pages.json")
QUESTIONS_JSON_PATH = os.path.join(ROOT_DIR, "public", "questions.json")
KB_CONFIG_PATH = os.path.join(ROOT_DIR, "scripts", "kb_config.json")

MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
MAX_TOKENS = 16384
REGION = "us-east-1"

# Module definitions: (module_number, name, start_page_0idx, end_page_0idx_exclusive)
MODULES = [
    (1, "Introduction to the Security Industry", 8, 25),
    (2, "The Canadian Legal System and Security Professionals", 25, 50),
    (3, "Basic Security Procedures", 50, 87),
    (4, "Communication for Security Professionals", 87, 106),
    (5, "Documentation and Evidence", 106, 129),
    (6, "Response Procedures for Security Professionals", 129, 147),
    (7, "Health and Safety for Security Professionals", 147, 158),
]

# ---------------------------------------------------------------------------
# Bedrock helper
# ---------------------------------------------------------------------------

from botocore.config import Config as BotoConfig

bedrock_client = boto3.client(
    "bedrock-runtime",
    region_name=REGION,
    config=BotoConfig(read_timeout=600, connect_timeout=10, retries={"max_attempts": 0}),
)


def call_bedrock(prompt: str, max_tokens: int = MAX_TOKENS, retries: int = 2) -> str:
    """Call Bedrock Claude and return the text response."""
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
    )
    for attempt in range(retries + 1):
        try:
            response = bedrock_client.invoke_model(
                modelId=MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            result = json.loads(response["body"].read())
            return result["content"][0]["text"]
        except Exception as e:
            if attempt < retries:
                wait = 10 * (attempt + 1)
                print(f"  [WARN] Bedrock call failed ({e}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise


def parse_json_response(raw: str) -> object:
    """Robustly parse JSON from an LLM response (strip markdown fences, etc.)."""
    cleaned = raw.strip()
    # Strip markdown code fences
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try to extract a JSON object or array
    for pattern in [r"\{[\s\S]*\}", r"\[[\s\S]*\]"]:
        match = re.search(pattern, raw)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Could not parse JSON from response (first 500 chars): {raw[:500]}")


# ---------------------------------------------------------------------------
# PDF text extraction
# ---------------------------------------------------------------------------


def extract_module_text(pdf, start_page: int, end_page: int) -> str:
    """Extract and concatenate text for the given page range."""
    texts = []
    for i in range(start_page, min(end_page, len(pdf.pages))):
        page_text = pdf.pages[i].extract_text()
        if page_text:
            texts.append(page_text)
    return "\n\n".join(texts)


def truncate_text(text: str, max_chars: int = 50000) -> str:
    """If text is too long, truncate while preserving important sections."""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    print(f"  [INFO] Text truncated from {len(text)} to {max_chars} chars")
    return truncated


# ---------------------------------------------------------------------------
# Step 1: Generate wiki pages per module
# ---------------------------------------------------------------------------

WIKI_PROMPT_TEMPLATE = """\
You are an expert educator creating study material for the Alberta Basic Security Training (ABST) exam.

Below is the text of **Module {mod_num}: {mod_name}** from the ABST Participant Manual.

Your task: Create **3 to 6 structured wiki concept pages** that cover the key concepts, definitions, procedures, and legal points in this module. Each page should be a self-contained reference article that a student could read to understand one concept area.

Guidelines:
- Each page should have a clear, specific title (not just the module name).
- The body should be well-structured Markdown with headings (##, ###), bullet points, bold terms, and examples where appropriate.
- Cover the most exam-relevant and practically important concepts.
- Pages should be complementary, not overlapping.
- Include key definitions, rules, procedures, and any lists or frameworks from the material.
- Write at a level accessible to ESL learners while retaining all technical accuracy.

Return ONLY a valid JSON object (no markdown fences, no explanation). The format must be:

{{
  "pages": [
    {{
      "slug": "kebab-case-slug-for-url",
      "title": "Clear Descriptive Title",
      "moduleId": {mod_num},
      "body": "## Clear Descriptive Title\\n\\nMarkdown content here...",
      "relatedSlugs": []
    }}
  ]
}}

Rules:
- Slugs must be unique, lowercase, kebab-case, and descriptive (e.g., "types-of-security-licences", "criminal-code-arrest-powers").
- The "relatedSlugs" array will be filled in later; leave it empty for now.
- Produce 3-6 pages.
- Return ONLY the JSON object.

--- MODULE TEXT START ---
{module_text}
--- MODULE TEXT END ---
"""


def generate_wiki_pages_for_module(pdf, mod_num, mod_name, start_page, end_page):
    """Generate wiki pages for a single module."""
    print(f"\n{'='*60}")
    print(f"Generating wiki pages for Module {mod_num}: {mod_name}")
    print(f"  Pages {start_page+1}-{end_page} (0-indexed: {start_page}-{end_page-1})")

    module_text = extract_module_text(pdf, start_page, end_page)
    print(f"  Extracted {len(module_text)} characters of text")
    module_text = truncate_text(module_text)

    prompt = WIKI_PROMPT_TEMPLATE.format(
        mod_num=mod_num,
        mod_name=mod_name,
        module_text=module_text,
    )

    print(f"  Calling Bedrock ({MODEL_ID})...")
    start_time = time.time()
    raw_response = call_bedrock(prompt)
    elapsed = time.time() - start_time
    print(f"  Response received in {elapsed:.1f}s ({len(raw_response)} chars)")

    result = parse_json_response(raw_response)

    pages = result.get("pages", [])
    if not isinstance(pages, list):
        print(f"  [ERROR] Expected pages array, got {type(pages)}")
        return []

    # Validate pages
    validated = []
    for p in pages:
        slug = p.get("slug", "")
        title = p.get("title", "")
        body = p.get("body", "")
        module_id = p.get("moduleId", mod_num)

        if not slug or not title or not body:
            print(f"  [WARN] Skipping page with missing slug/title/body")
            continue

        validated.append({
            "slug": slug,
            "title": title,
            "moduleId": module_id,
            "body": body,
            "relatedSlugs": [],
        })

    print(f"  Generated {len(validated)} wiki pages")
    for p in validated:
        print(f"    - {p['slug']}: {p['title']}")

    return validated


# ---------------------------------------------------------------------------
# Step 2: Fill in relatedSlugs across all pages
# ---------------------------------------------------------------------------


def fill_related_slugs(all_pages):
    """For each page, find 1-3 related pages from the full set."""
    # Simple heuristic: pages in the same module are related
    # Also connect pages across modules that share keywords
    for page in all_pages:
        same_module = [
            p["slug"] for p in all_pages
            if p["moduleId"] == page["moduleId"] and p["slug"] != page["slug"]
        ]
        page["relatedSlugs"] = same_module[:3]


# ---------------------------------------------------------------------------
# Step 3: Map questions to wiki pages
# ---------------------------------------------------------------------------

MAPPING_PROMPT_TEMPLATE = """\
You are mapping quiz questions to relevant wiki concept pages for a study app.

Below are the wiki pages (slug and title) and the quiz questions (ID and text).

For EACH question, identify which wiki pages are most relevant (1-3 pages per question). A page is relevant if understanding that page's concept would help answer the question.

Return ONLY a valid JSON object mapping question IDs to arrays of page slugs:

{{
  "m1q1": ["slug-1", "slug-2"],
  "m1q2": ["slug-3"],
  ...
}}

Rules:
- Every question must appear in the mapping.
- Each question should map to 1-3 page slugs.
- Only use slugs from the provided list.
- Return ONLY the JSON object.

--- WIKI PAGES ---
{pages_list}

--- QUESTIONS ---
{questions_list}
"""


def generate_question_mapping(all_pages, questions_data):
    """Generate a mapping from question IDs to wiki page slugs."""
    print(f"\n{'='*60}")
    print("Generating question-to-wiki-page mapping...")

    # Build compact representations
    pages_list = "\n".join(
        f"- {p['slug']} (Module {p['moduleId']}): {p['title']}"
        for p in all_pages
    )

    questions_list = []
    for module in questions_data["modules"]:
        for q in module["questions"]:
            # Use level3 text (exam-level English)
            text = q["level3"]["text"]
            questions_list.append(f"- {q['id']} (Module {module['id']}): {text}")
    questions_list_str = "\n".join(questions_list)

    prompt = MAPPING_PROMPT_TEMPLATE.format(
        pages_list=pages_list,
        questions_list=questions_list_str,
    )

    print(f"  Calling Bedrock ({MODEL_ID})...")
    start_time = time.time()
    raw_response = call_bedrock(prompt)
    elapsed = time.time() - start_time
    print(f"  Response received in {elapsed:.1f}s ({len(raw_response)} chars)")

    mapping = parse_json_response(raw_response)

    if not isinstance(mapping, dict):
        print(f"  [ERROR] Expected dict, got {type(mapping)}")
        return {}

    # Validate: ensure all slugs actually exist
    valid_slugs = {p["slug"] for p in all_pages}
    validated_mapping = {}
    for qid, slugs in mapping.items():
        if isinstance(slugs, list):
            validated_mapping[qid] = [s for s in slugs if s in valid_slugs]
        else:
            print(f"  [WARN] Question {qid} has non-list mapping: {slugs}")

    print(f"  Mapped {len(validated_mapping)} questions to wiki pages")
    return validated_mapping


# ---------------------------------------------------------------------------
# Step 4: Update questions.json with conceptPages
# ---------------------------------------------------------------------------


def update_questions_json(mapping):
    """Add conceptPages field to each question in questions.json."""
    print(f"\n{'='*60}")
    print("Updating questions.json with conceptPages...")

    with open(QUESTIONS_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    updated_count = 0
    for module in data["modules"]:
        for q in module["questions"]:
            qid = q["id"]
            if qid in mapping:
                q["conceptPages"] = mapping[qid]
                updated_count += 1
            else:
                q["conceptPages"] = []
                print(f"  [WARN] No mapping for question {qid}")

    with open(QUESTIONS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"  Updated {updated_count} questions with conceptPages")
    print(f"  Saved to {QUESTIONS_JSON_PATH}")


# ---------------------------------------------------------------------------
# Step 5: Upload to S3 and re-index KB
# ---------------------------------------------------------------------------


def upload_and_reindex(all_pages):
    """Upload wiki markdown files to S3 and trigger KB re-ingestion."""
    print(f"\n{'='*60}")
    print("Uploading wiki pages to S3 and re-indexing KB...")

    # Load KB config
    with open(KB_CONFIG_PATH, "r") as f:
        kb_config = json.load(f)

    bucket_name = kb_config["bucket_name"]
    kb_id = kb_config["kb_id"]
    region = kb_config.get("region", REGION)

    s3_client = boto3.client("s3", region_name=region)
    bedrock_agent = boto3.client("bedrock-agent", region_name=region)

    # Upload each wiki page as wiki/{slug}.md
    print(f"  Uploading {len(all_pages)} wiki pages to s3://{bucket_name}/wiki/...")
    for page in all_pages:
        key = f"wiki/{page['slug']}.md"
        # Build markdown content with metadata header
        md_content = f"# {page['title']}\n\n"
        md_content += f"Module {page['moduleId']}\n\n"
        md_content += page["body"]

        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=md_content.encode("utf-8"),
            ContentType="text/markdown",
        )
        print(f"    Uploaded: {key}")

    # Find the data source ID for this KB
    data_sources = bedrock_agent.list_data_sources(
        knowledgeBaseId=kb_id, maxResults=100
    ).get("dataSourceSummaries", [])

    if not data_sources:
        print("  [ERROR] No data sources found for KB. Skipping ingestion.")
        return

    ds_id = data_sources[0]["dataSourceId"]
    print(f"  Using data source: {ds_id}")

    # Start ingestion job
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
# Main
# ---------------------------------------------------------------------------


def main():
    print("=" * 60)
    print("Wiki Page Generator for ABST")
    print(f"  PDF: {PDF_PATH}")
    print(f"  Model: {MODEL_ID}")
    print("=" * 60)

    if not os.path.exists(PDF_PATH):
        print(f"ERROR: PDF not found at {PDF_PATH}")
        sys.exit(1)

    pdf = pdfplumber.open(PDF_PATH)
    print(f"PDF has {len(pdf.pages)} pages")

    # --- Step 1: Generate wiki pages for each module ---
    all_pages = []
    for mod_num, mod_name, start_page, end_page in MODULES:
        pages = generate_wiki_pages_for_module(pdf, mod_num, mod_name, start_page, end_page)
        all_pages.extend(pages)

    pdf.close()

    if not all_pages:
        print("\nERROR: No wiki pages were generated!")
        sys.exit(1)

    # Deduplicate slugs (just in case)
    seen_slugs = set()
    deduped = []
    for p in all_pages:
        if p["slug"] not in seen_slugs:
            seen_slugs.add(p["slug"])
            deduped.append(p)
        else:
            print(f"  [WARN] Duplicate slug removed: {p['slug']}")
    all_pages = deduped

    # --- Step 1b: Fill in relatedSlugs ---
    fill_related_slugs(all_pages)

    # --- Step 2: Save pages.json ---
    wiki_dir = os.path.dirname(PAGES_JSON_PATH)
    os.makedirs(wiki_dir, exist_ok=True)

    pages_output = {"pages": all_pages}
    with open(PAGES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(pages_output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved {len(all_pages)} wiki pages to {PAGES_JSON_PATH}")

    # --- Step 3: Generate question-to-page mapping ---
    with open(QUESTIONS_JSON_PATH, "r", encoding="utf-8") as f:
        questions_data = json.load(f)

    mapping = generate_question_mapping(all_pages, questions_data)

    # --- Step 4: Update questions.json ---
    update_questions_json(mapping)

    # --- Step 5: Upload to S3 and re-index ---
    upload_and_reindex(all_pages)

    # --- Summary ---
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"  Total wiki pages generated: {len(all_pages)}")
    for mod_num, mod_name, _, _ in MODULES:
        mod_pages = [p for p in all_pages if p["moduleId"] == mod_num]
        print(f"    Module {mod_num}: {len(mod_pages)} pages")
    print(f"  Questions mapped: {len(mapping)}")
    print(f"  pages.json: {PAGES_JSON_PATH}")
    print(f"  questions.json: {QUESTIONS_JSON_PATH}")
    print("\nDone!")


if __name__ == "__main__":
    main()

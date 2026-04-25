#!/usr/bin/env python3
"""
Extract questions from the Alberta Basic Security Training PDF and generate
structured multilingual quiz JSON using AWS Bedrock Claude.
"""

import boto3
import json
import os
import re
import sys
import time

import pdfplumber

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PDF_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "abst-particpants-manual-oct-2014-2 (1).pdf",
)

OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public",
    "questions.json",
)

MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
MAX_TOKENS = 8192

# Module definitions: (module_number, name, start_page_0idx, end_page_0idx_exclusive)
# These are 0-indexed page numbers derived from the PDF analysis.
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

client = boto3.client("bedrock-runtime", region_name="us-east-1")


def call_bedrock(prompt: str, max_tokens: int = MAX_TOKENS, retries: int = 1) -> str:
    """Call Bedrock Claude and return the text response. Retries once on failure."""
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
    )
    for attempt in range(retries + 1):
        try:
            response = client.invoke_model(
                modelId=MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            result = json.loads(response["body"].read())
            return result["content"][0]["text"]
        except Exception as e:
            if attempt < retries:
                print(f"  [WARN] Bedrock call failed ({e}), retrying in 5s...")
                time.sleep(5)
            else:
                raise


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


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

PROMPT_TEMPLATE = """\
You are an expert educator and test designer. Below is the text of **Module {mod_num}: {mod_name}** from the Alberta Basic Security Training (ABST) Participant Manual.

The text contains "Check Your Knowledge" (pre-test) and "Post-Test" sections with True/False and fill-in-the-blank questions. Your job:

1. **Extract** the existing questions from "Check Your Knowledge" and "Post-Test" sections.
2. **Generate additional** multiple-choice questions from the module content so that the total reaches 8-12 questions.
3. Convert ALL questions (including True/False and fill-in-the-blank) into **multiple-choice format** with exactly 4 options (A, B, C, D) and one correct answer.

For EACH question, provide three versions:
- **level3**: Original exam-level English with full professional/legal jargon.
- **level2**: Simplified English at a grade 3 reading level using elementary vocabulary. Keep the same meaning but use simple, short words and sentences.
- **level1**: French translation of the level3 version.

Return ONLY a valid JSON array (no markdown fences, no explanation, no extra text). Each element must follow this exact structure:

[
  {{
    "id": "m{mod_num}q1",
    "level3": {{
      "text": "Question text in exam-level English?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": 0
    }},
    "level2": {{
      "text": "Simple English version of the question?",
      "options": ["Simple A", "Simple B", "Simple C", "Simple D"],
      "answer": 0
    }},
    "level1": {{
      "text": "French version of the question?",
      "options": ["Option A en francais", "Option B en francais", "Option C en francais", "Option D en francais"],
      "answer": 0
    }}
  }}
]

Rules:
- The "answer" field is the 0-based index (0-3) of the correct option.
- The correct answer index MUST be the same across all three levels for each question.
- Number questions sequentially: m{mod_num}q1, m{mod_num}q2, ...
- Produce 8-12 questions total.
- Return ONLY the JSON array. No other text.

--- MODULE TEXT START ---
{module_text}
--- MODULE TEXT END ---
"""


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_questions(questions: list, mod_num: int) -> list:
    """Validate and fix the structure of parsed questions."""
    validated = []
    for i, q in enumerate(questions):
        try:
            qid = q.get("id", f"m{mod_num}q{i+1}")
            for level in ("level3", "level2", "level1"):
                assert level in q, f"Missing {level}"
                lvl = q[level]
                assert "text" in lvl, f"Missing text in {level}"
                assert "options" in lvl, f"Missing options in {level}"
                assert "answer" in lvl, f"Missing answer in {level}"
                assert isinstance(lvl["options"], list), f"options not a list in {level}"
                assert len(lvl["options"]) == 4, f"Need 4 options in {level}, got {len(lvl['options'])}"
                assert isinstance(lvl["answer"], int), f"answer not int in {level}"
                assert 0 <= lvl["answer"] <= 3, f"answer out of range in {level}"
            q["id"] = qid
            validated.append(q)
        except AssertionError as e:
            print(f"  [WARN] Skipping question {i+1}: {e}")
    return validated


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def truncate_text(text: str, max_chars: int = 80000) -> str:
    """If text is too long, keep the first part and the question sections."""
    if len(text) <= max_chars:
        return text

    # Try to find Check Your Knowledge and Post-Test sections
    question_markers = ["Check Your Knowledge", "Post-Test", "Post Test"]
    question_sections = []
    for marker in question_markers:
        idx = text.find(marker)
        if idx != -1:
            # Take text around the marker (5000 chars after)
            end = min(idx + 5000, len(text))
            question_sections.append(text[idx:end])

    # Take the first chunk of content + question sections
    question_text = "\n\n--- QUESTION SECTIONS ---\n\n".join(question_sections)
    remaining = max_chars - len(question_text) - 200
    if remaining > 0:
        truncated = text[:remaining] + "\n\n[... content truncated ...]\n\n" + question_text
    else:
        truncated = text[:max_chars]

    print(f"  [INFO] Text truncated from {len(text)} to {len(truncated)} chars")
    return truncated


def main():
    print(f"Opening PDF: {PDF_PATH}")
    if not os.path.exists(PDF_PATH):
        print(f"ERROR: PDF not found at {PDF_PATH}")
        sys.exit(1)

    pdf = pdfplumber.open(PDF_PATH)
    print(f"PDF has {len(pdf.pages)} pages")

    all_modules = []

    for mod_num, mod_name, start_page, end_page in MODULES:
        print(f"\n{'='*60}")
        print(f"Processing Module {mod_num}: {mod_name}")
        print(f"  Pages {start_page+1}-{end_page} (0-indexed: {start_page}-{end_page-1})")

        # Extract text
        module_text = extract_module_text(pdf, start_page, end_page)
        print(f"  Extracted {len(module_text)} characters of text")

        # Truncate if needed
        module_text = truncate_text(module_text)

        # Build prompt
        prompt = PROMPT_TEMPLATE.format(
            mod_num=mod_num,
            mod_name=mod_name,
            module_text=module_text,
        )

        # Call Bedrock
        print(f"  Calling Bedrock ({MODEL_ID})...")
        start_time = time.time()
        raw_response = call_bedrock(prompt)
        elapsed = time.time() - start_time
        print(f"  Response received in {elapsed:.1f}s ({len(raw_response)} chars)")

        # Parse JSON from response
        # Strip any markdown fences if present
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            # Remove opening fence
            cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)

        try:
            questions = json.loads(cleaned)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Failed to parse JSON: {e}")
            print(f"  Raw response (first 500 chars): {raw_response[:500]}")
            # Try to find JSON array in the response
            match = re.search(r"\[.*\]", raw_response, re.DOTALL)
            if match:
                try:
                    questions = json.loads(match.group())
                    print(f"  [INFO] Extracted JSON array from response")
                except json.JSONDecodeError:
                    print(f"  [ERROR] Could not extract valid JSON. Skipping module.")
                    questions = []
            else:
                questions = []

        if not isinstance(questions, list):
            print(f"  [ERROR] Expected a list, got {type(questions)}. Skipping module.")
            questions = []

        # Validate
        questions = validate_questions(questions, mod_num)
        print(f"  Validated {len(questions)} questions")

        all_modules.append(
            {
                "id": mod_num,
                "name": mod_name,
                "questions": questions,
            }
        )

    pdf.close()

    # Write output
    output_dir = os.path.dirname(OUTPUT_PATH)
    os.makedirs(output_dir, exist_ok=True)

    output = {"modules": all_modules}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"Output written to {OUTPUT_PATH}")
    total_questions = sum(len(m["questions"]) for m in all_modules)
    print(f"Total: {len(all_modules)} modules, {total_questions} questions")
    for m in all_modules:
        print(f"  Module {m['id']}: {len(m['questions'])} questions")

    if total_questions == 0:
        print("\nWARNING: No questions were generated!")
        sys.exit(1)


if __name__ == "__main__":
    main()

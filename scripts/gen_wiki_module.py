#!/usr/bin/env python3
"""Generate wiki pages for a single module. Usage: python3 gen_wiki_module.py <module_number>"""

import boto3
import json
import os
import re
import sys
import pdfplumber
from botocore.config import Config as BotoConfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH = os.path.join(ROOT, "abst-particpants-manual-oct-2014-2 (1).pdf")
OUT_DIR = os.path.join(ROOT, "public", "wiki", "modules")
REGION = "us-east-1"
MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

MODULES = {
    1: ("Introduction to the Security Industry", 8, 25),
    2: ("The Canadian Legal System and Security Professionals", 25, 50),
    3: ("Basic Security Procedures", 50, 87),
    4: ("Communication for Security Professionals", 87, 106),
    5: ("Documentation and Evidence", 106, 129),
    6: ("Response Procedures for Security Professionals", 129, 147),
    7: ("Health and Safety for Security Professionals", 147, 158),
}

client = boto3.client("bedrock-runtime", region_name=REGION,
    config=BotoConfig(read_timeout=300, retries={"max_attempts": 0}))

PROMPT = """\
Below is **Module {n}: {name}** from the ABST Participant Manual.

Generate 3-6 concept pages. Each is a focused article (200-400 words).

Return ONLY a JSON array, no fences:
[{{"slug":"kebab-case","title":"Title","body":"## Title\\n\\nMarkdown...","relatedSlugs":["other"]}}]

Rules: exact ABST terminology, markdown with headings/bullets/bold, unique slugs.

--- TEXT ---
{text}
--- END ---
"""

def main():
    mod_num = int(sys.argv[1])
    name, start, end = MODULES[mod_num]
    print(f"Module {mod_num}: {name}")

    pdf = pdfplumber.open(PDF_PATH)
    texts = []
    for i in range(start, min(end, len(pdf.pages))):
        t = pdf.pages[i].extract_text()
        if t: texts.append(t)
    pdf.close()
    text = "\n\n".join(texts)[:80000]
    print(f"  {len(text)} chars extracted")

    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": PROMPT.format(n=mod_num, name=name, text=text)}],
    })
    print(f"  Calling Bedrock...")
    resp = client.invoke_model(modelId=MODEL_ID, contentType="application/json", accept="application/json", body=body)
    raw = json.loads(resp["body"].read())["content"][0]["text"].strip()

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)

    pages = json.loads(raw)
    for p in pages:
        p["moduleId"] = mod_num

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"m{mod_num}.json")
    with open(out, "w") as f:
        json.dump(pages, f, indent=2, ensure_ascii=False)
    print(f"  {len(pages)} pages -> {out}")
    for p in pages:
        print(f"    - {p['slug']}: {p['title']}")

if __name__ == "__main__":
    main()

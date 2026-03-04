"""
Neetarded Golden Dataset — Proof of Concept
============================================
This script takes a hardcoded raw NEET question, sends it to
Groq API (Llama 3.3 70B), and prints the structured JSON output.

Prerequisites:
  pip install groq

Usage:
  set GROQ_API_KEY=your_key_here
  python scripts/proof_of_concept.py
"""

import os
import json
from groq import Groq

# ──────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
MODEL = "llama-3.3-70b-versatile"

# ──────────────────────────────────────────────
# SYSTEM PROMPT — The core of the parsing engine
# ──────────────────────────────────────────────
SYSTEM_PROMPT = """You are a NEET exam question parser. Your ONLY job is to convert messy, raw text extracted from a PDF into a clean, structured JSON object.

RULES:
1. Extract the question number, question text, all options, the correct answer, and an explanation if provided.
2. Options MUST have ids "A", "B", "C", "D" — regardless of how they appear in the raw text (a/b/c/d, 1/2/3/4, (i)/(ii)/(iii)/(iv), etc.).
3. The correctOptionId MUST be one of "A", "B", "C", "D".
4. Clean up OCR artifacts: fix broken words, remove stray characters, normalize whitespace.
5. If an explanation is visible in the text, include it. Otherwise set explanation to null.
6. If there is an image reference like [Image: URL], extract the URL into imageUrl and remove the tag from the question text.

OUTPUT FORMAT — Return ONLY this JSON, nothing else:
{
  "questionNumber": <integer>,
  "text": "<clean question text>",
  "options": [
    {"id": "A", "text": "<option text>"},
    {"id": "B", "text": "<option text>"},
    {"id": "C", "text": "<option text>"},
    {"id": "D", "text": "<option text>"}
  ],
  "correctOptionId": "<A|B|C|D>",
  "explanation": "<explanation or null>",
  "imageUrl": null
}

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text."""


# ──────────────────────────────────────────────
# SAMPLE RAW INPUT — Copy-pasted from a real PDF
# Replace this with actual extracted text to test
# ──────────────────────────────────────────────
SAMPLE_RAW_QUESTION = """
### 72)

Which of the following is the correct sequence of events in the cardiac cycle?

(a) Atrial systole → Ventricular systole → Joint diastole
(b) Joint diastole → Atrial systole → Ventricular systole
(c) Ventricular systole → Joint diastole → Atrial systole
(d) Atrial systole → Joint diastole → Ventricular systole

Answer: (a)
Explanation: The cardiac cycle begins with atrial systole (contraction of atria), followed by ventricular systole (contraction of ventricles), and then joint diastole (relaxation of both atria and ventricles).
"""


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def parse_question(raw_text: str) -> dict:
    """Send raw question text to Groq/Llama and return structured JSON."""
    if not GROQ_API_KEY:
        raise ValueError(
            "GROQ_API_KEY not set!\n"
            "Get a free key from https://console.groq.com\n"
            "Then run:  set GROQ_API_KEY=your_key_here"
        )

    client = Groq(api_key=GROQ_API_KEY)

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
        temperature=0.0,  # Deterministic output for parsing
        max_tokens=1024,
    )

    raw_response = response.choices[0].message.content.strip()

    # Try to parse JSON — handle cases where model wraps in code fences
    if raw_response.startswith("```"):
        # Strip markdown code fences
        lines = raw_response.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        raw_response = "\n".join(lines)

    return json.loads(raw_response)


def validate_output(parsed: dict) -> list[str]:
    """Validate that the parsed output matches the optimized_json schema."""
    errors = []

    required_fields = ["questionNumber", "text", "options", "correctOptionId"]
    for field in required_fields:
        if field not in parsed:
            errors.append(f"Missing required field: {field}")

    if "options" in parsed:
        if len(parsed["options"]) != 4:
            errors.append(f"Expected 4 options, got {len(parsed['options'])}")
        expected_ids = {"A", "B", "C", "D"}
        actual_ids = {opt.get("id") for opt in parsed["options"]}
        if actual_ids != expected_ids:
            errors.append(f"Option IDs must be A/B/C/D, got {actual_ids}")

    if "correctOptionId" in parsed:
        if parsed["correctOptionId"] not in {"A", "B", "C", "D"}:
            errors.append(f"correctOptionId must be A/B/C/D, got '{parsed['correctOptionId']}'")

    return errors


if __name__ == "__main__":
    print("=" * 60)
    print("  Neetarded Golden Dataset — Proof of Concept")
    print("  Model: Groq / Llama 3.3 70B")
    print("=" * 60)
    print()

    print("[INPUT] RAW INPUT:")
    print("-" * 40)
    print(SAMPLE_RAW_QUESTION.strip())
    print("-" * 40)
    print()

    print("[AI] Sending to Groq API...")
    try:
        result = parse_question(SAMPLE_RAW_QUESTION)
    except json.JSONDecodeError as e:
        print(f"[FAIL] Failed to parse JSON from AI response: {e}")
        exit(1)
    except Exception as e:
        print(f"[FAIL] API Error: {e}")
        exit(1)

    print("[OK] Got response!\n")

    print("[OUTPUT] PARSED OUTPUT (optimized_json):")
    print("-" * 40)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("-" * 40)
    print()

    # Validate
    errors = validate_output(result)
    if errors:
        print("[WARN] VALIDATION ISSUES:")
        for err in errors:
            print(f"   • {err}")
    else:
        print("[PASS] VALIDATION PASSED -- Output matches the optimized_json schema!")
        print()
        print("Next steps:")
        print("  1. Replace SAMPLE_RAW_QUESTION with real PDF-extracted text")
        print("  2. Build ingest_paper.py with PyMuPDF + Firestore push")

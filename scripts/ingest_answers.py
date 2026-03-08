import os
import sys
import json
import time
import argparse
import base64
import re
import fitz

from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, firestore, storage as fb_storage

# CONFIG
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
MODEL = "gpt-4.1-mini"
VISION_MODEL = "gpt-4.1-mini"
RATE_LIMIT_DELAY = 0.5  # seconds

SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
FIREBASE_STORAGE_BUCKET = (
    os.environ.get("FIREBASE_STORAGE_BUCKET")
    or os.environ.get("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "")
)

db = None

def init_firestore():
    global db
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        raise FileNotFoundError(f"Firebase service account key not found at: {SERVICE_ACCOUNT_PATH}")

    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred, {
            'storageBucket': FIREBASE_STORAGE_BUCKET
        })
    if db is None:
        db = firestore.client()

ANSWERS_VISION_PROMPT = """You are a NEET exam solutions parser. You will receive an IMAGE of a scanned 'Hints & Solutions' or 'Answer Key' page.

RULES:
1. Read ALL answers/explanations on this page. Each entry starts with a question number (e.g. "1.", "1)", "Q1", etc.), followed usually by the correct answer option like (1), (2), (A), (C), and then the explanation text.
2. For each question, extract: questionNumber, correctOptionLetter, and explanation.
3. Map the correct answer to A, B, C, or D. (e.g., 1 -> A, 2 -> B, 3 -> C, 4 -> D).
4. Extract the full explanation text. If there is no explanation (just the answer key without text), set explanation to an empty string "".
5. Format all mathematical powers and exponents using true Unicode superscripts instead of caret notation (e.g., "x²" instead of "x^2", "10⁻³"). Let variables be italicized if you wish but ALWAYS use standard superscript characters for exponents. Wait to convert roots too (e.g. use √). Do NOT use caret notation.
6. Format Chemistry ions, formulas with proper Unicode superscripts and subscripts (e.g., "Ca²⁺", "H₂O", "PO₄³⁻"). DO NOT use formats like Co2+.
7. Format scientific units with proper Unicode superscripts (e.g., "mol L⁻¹").
8. Do NOT use LaTeX commands for fractions, roots, etc., use Unicode (e.g., "√2", "i₀/6").
9. If an explanation contains or references a drawn figure/diagram/graph, set hasImage to true AND provide figureTopPercent and figureBottomPercent indicating where the figure is located on the page as a percentage from top (0) to bottom (100).
10. If an explanation spans across pages, include whatever is visible here.
11. If the page is just a dense grid of answers without explanations, still parse them all.

OUTPUT FORMAT -- Return ONLY a JSON array of objects, nothing else:
[
  {
    "questionNumber": <integer>,
    "correctOptionLetter": "A" | "B" | "C" | "D",
    "explanation": "<clean explanation text or empty string>",
    "hasImage": false,
    "figureTopPercent": null,
    "figureBottomPercent": null
  }
]

Parse EVERY solution on the page. Return [] if no valid answers are found.
CRITICAL: Return ONLY the JSON array. No markdown, no HTML, no extra text."""

def parse_answers_pdf(client: OpenAI, pdf_path: str, dry_run: bool = False) -> list[dict]:
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    all_answers = []
    page_images: dict[int, bytes] = {}

    print(f"  [VISION] Parsing {page_count} pages of solutions with GPT-4 Vision...")

    for page_num in range(page_count):
        page = doc[page_num]

        # Render page at 200 DPI
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pixmap = page.get_pixmap(matrix=mat)
        img_bytes = pixmap.tobytes("png")
        page_images[page_num] = img_bytes

        # Encode as base64 for API
        b64_image = base64.b64encode(img_bytes).decode("utf-8")

        print(f"  [VISION] Parsing page {page_num + 1}/{page_count}...", end=" ", flush=True)

        try:
            response = client.chat.completions.create(
                model=VISION_MODEL,
                messages=[
                    {"role": "system", "content": ANSWERS_VISION_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Parse all solutions from this exam page image."},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_image}", "detail": "high"}}
                        ]
                    }
                ],
                temperature=0.0,
                max_tokens=8192,
            )

            raw_response = response.choices[0].message.content.strip()

            if raw_response.startswith("```"):
                lines = raw_response.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw_response = "\n".join(lines)

            raw_response = re.sub(r',\s*]', ']', raw_response)
            raw_response = re.sub(r',\s*}', '}', raw_response)

            parsed = json.loads(raw_response)
            
            # Handle if AI returns a dictionary {"solutions": [...]}
            if isinstance(parsed, dict):
                for key in ["solutions", "answers", "questions"]:
                    if key in parsed:
                        parsed = parsed[key]
                        break

            for a in parsed:
                a["_source_page"] = page_num

            all_answers.extend(parsed)
            print(f"OK ({len(parsed)} solutions)")

        except json.JSONDecodeError as e:
            print(f"PARSE ERROR: {e}")
        except Exception as e:
            print(f"API ERROR: {e}")

        if page_num < page_count - 1:
            time.sleep(RATE_LIMIT_DELAY)

    doc.close()

    # Cross-page merge for explanations that span pages
    if all_answers:
        merged: list[dict] = []
        for a in all_answers:
            q_num = a.get("questionNumber")
            
            if len(merged) > 0 and merged[-1].get("questionNumber") == q_num:
                existing = merged[-1]
                existing_page = existing.get("_source_page", -1)
                new_page = a.get("_source_page", -1)
                
                if (new_page - existing_page) <= 1:
                    existing_text = existing.get("explanation", "")
                    new_text = a.get("explanation", "")
                    
                    if new_text and new_text not in existing_text:
                        existing["explanation"] = existing_text.rstrip() + "\n\n" + new_text.lstrip()
                    
                    if not existing.get("correctOptionLetter") and a.get("correctOptionLetter"):
                        existing["correctOptionLetter"] = a.get("correctOptionLetter")
                        
                    if a.get("hasImage"):
                        existing["hasImage"] = True
                        existing["figureTopPercent"] = a.get("figureTopPercent")
                        existing["figureBottomPercent"] = a.get("figureBottomPercent")
                        existing["_source_page"] = a.get("_source_page") # Update source page for figure cropping
                        
                    print(f"  [MERGE] Q{q_num}: merged cross-page split")
                    continue
            merged.append(a)
        
        all_answers = merged

    # Process Explanation Figures
    answers_with_images = [a for a in all_answers if a.get("hasImage")]
    if answers_with_images:
        from PIL import Image
        import io

        print(f"  [VISION] {len(answers_with_images)} explanations reference figures")
        print(f"  [VISION] Extracting precise figure bounding boxes...")

        FIGURE_BBOX_PROMPT = """You are looking at a scanned exam solutions page. I need you to find the figure/diagram/graph associated with the explanation for Question {q_num}.

Return the EXACT bounding box of JUST the figure/diagram.

Return a JSON object with these 4 values as percentages of the page dimensions:
- leftPercent: distance from left edge (0-100)
- topPercent: distance from top edge (0-100)  
- rightPercent: distance from left edge to the right side of figure (0-100)
- bottomPercent: distance from top edge to the bottom of figure (0-100)

Example: {{"leftPercent": 5, "topPercent": 35, "rightPercent": 45, "bottomPercent": 60}}

CRITICAL: Return ONLY the JSON object. No markdown, no HTML, no extra text. If no figure is found, return {{"error": true}}."""

        safe_source = re.sub(r'[^\w\-]', '_', os.path.basename(pdf_path))
        if not dry_run and FIREBASE_STORAGE_BUCKET:
            init_firestore()
            bucket = fb_storage.bucket()

        for idx, a in enumerate(answers_with_images):
            source_page = a.get("_source_page", 0)
            q_num = a["questionNumber"]

            if source_page not in page_images:
                continue

            b64_img = base64.b64encode(page_images[source_page]).decode("utf-8")
            print(f"    Q{q_num} figure (page {source_page + 1})...", end=" ", flush=True)

            try:
                resp = client.chat.completions.create(
                    model=VISION_MODEL,
                    messages=[
                        {"role": "system", "content": FIGURE_BBOX_PROMPT.format(q_num=q_num)},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Find the explanation figure for Question {q_num} on this page."},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_img}", "detail": "high"}}
                            ]
                        }
                    ],
                    temperature=0.0,
                    max_tokens=256,
                )

                raw = resp.choices[0].message.content.strip()
                if raw.startswith("```"):
                    lines = raw.split("\n")
                    lines = [l for l in lines if not l.strip().startswith("```")]
                    raw = "\n".join(lines)

                bbox = json.loads(raw)

                if bbox.get("error"):
                    print("no figure found")
                    continue

                pil_img = Image.open(io.BytesIO(page_images[source_page]))
                w, h = pil_img.size

                left = max(0, int(w * bbox["leftPercent"] / 100) - 10)
                top = max(0, int(h * bbox["topPercent"] / 100) - 10)
                right = min(w, int(w * bbox["rightPercent"] / 100) + 10)
                bottom = min(h, int(h * bbox["bottomPercent"] / 100) + 10)

                cropped = pil_img.crop((left, top, right, bottom))
                buf = io.BytesIO()
                cropped.save(buf, format="PNG")
                img_to_upload = buf.getvalue()

                print(f"cropped ({right-left}x{bottom-top}px)", end=" ")

                if not dry_run and FIREBASE_STORAGE_BUCKET:
                    try:
                        blob_path = f"explanation-images/{safe_source}/q{q_num}_fig.png"
                        blob = bucket.blob(blob_path)
                        blob.upload_from_string(img_to_upload, content_type="image/png")
                        blob.make_public()
                        a["explanationImageUrl"] = blob.public_url
                        print("-> uploaded")
                    except Exception as e:
                        print(f"UPLOAD FAILED: {e}")
                elif dry_run:
                    img_dir = pdf_path.rsplit(".", 1)[0] + "_explanation_images"
                    os.makedirs(img_dir, exist_ok=True)
                    local_path = os.path.join(img_dir, f"q{q_num}_fig.png")
                    with open(local_path, "wb") as f:
                        f.write(img_to_upload)
                    a["explanationImageUrl"] = local_path
                    print("-> saved locally")

            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(RATE_LIMIT_DELAY)

    # Clean up internal fields
    for a in all_answers:
        a.pop("_source_page", None)
        a.pop("hasImage", None)
        a.pop("figureTopPercent", None)
        a.pop("figureBottomPercent", None)

    return all_answers

def push_answers_to_firestore(source_paper: str, answers: list[dict]):
    """Update existing QuestionBank documents with parsed answers and explanations."""
    if not answers:
        print("  [FIRESTORE] No answers to push.")
        return 0

    init_firestore()
    collection_ref = db.collection("QuestionBank")
    
    print(f"  [FIRESTORE] Fetching existing questions for source: '{source_paper}'...")
    existing_docs = collection_ref.where("source_paper", "==", source_paper).stream()
    
    # Track existing doc details: q_num -> list of doc_ids
    existing_map: dict[int, list[str]] = {}
    for doc in existing_docs:
        doc_data = doc.to_dict()
        if "optimized_json" in doc_data and "questionNumber" in doc_data["optimized_json"]:
            q_num = doc_data["optimized_json"]["questionNumber"]
            if q_num not in existing_map:
                existing_map[q_num] = []
            existing_map[q_num].append(doc.id)
            
    print(f"  [FIRESTORE] Found {sum(len(v) for v in existing_map.values())} existing documents for this paper.")

    count_updated = 0
    count_missing = 0

    for a in answers:
        q_num = a["questionNumber"]
        doc_ids = existing_map.get(q_num)
        
        if not doc_ids:
            print(f"    Q{q_num}: [WARN] Not found in DB. Skipping.")
            count_missing += 1
            continue

        for doc_id in doc_ids:
            update_data = {}
            if a.get("correctOptionLetter"):
                update_data["optimized_json.correctOptionId"] = a["correctOptionLetter"]
            if a.get("explanation"):
                update_data["optimized_json.explanation"] = a["explanation"]
            if a.get("explanationImageUrl"):
                update_data["optimized_json.explanationImageUrl"] = a["explanationImageUrl"]
                
            if update_data:
                update_data["updated_at"] = firestore.SERVER_TIMESTAMP
                try:
                    collection_ref.document(doc_id).update(update_data)
                    count_updated += 1
                except Exception as e:
                    print(f"    Q{q_num}: [ERROR] Failed to update {doc_id}: {e}")

    print(f"  [FIRESTORE] Pushed {count_updated} explanation updates (Missing: {count_missing})")
    return count_updated

def main():
    parser = argparse.ArgumentParser(description="Ingest Answer Keys & Explanations PDF")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--source", "-s", required=True, help="Exact Source paper name (e.g. 'NEET 2024 Phase 1')")
    parser.add_argument("--dry-run", "-d", action="store_true", help="Parse and print without pushing to Firestore")
    args = parser.parse_args()

    if not OPENAI_API_KEY:
        print("[FAIL] OPENAI_API_KEY not set!")
        sys.exit(1)

    print("=" * 60)
    print("  Neetarded Answer Keys & Explanations Ingestion Pipeline")
    print(f"  PDF: {args.pdf_path}")
    print(f"  Source: {args.source}")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)
    print()

    client = OpenAI(api_key=OPENAI_API_KEY)

    print("[1/2] Parsing Answer Keys & Explanations with GPT-4 Vision...")
    answers = parse_answers_pdf(client, args.pdf_path, dry_run=args.dry_run)
    
    print(f"\n  Total explanations parsed: {len(answers)}")
    
    if args.dry_run:
        output_file = f"dry_run_{int(time.time())}.json"
        with open(output_file, "w") as f:
            json.dump(answers, f, indent=2)
        print(f"\n[2/2] Saved full output to: {output_file}")
    else:
        print("\n[2/2] Merging explanations to existing Firestore documents...")
        updates_made = push_answers_to_firestore(args.source, answers)
        print(f"Pushed {updates_made} documents")

    print("\n[DONE]")

if __name__ == "__main__":
    main()

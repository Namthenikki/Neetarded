"""
Neetarded Golden Dataset -- Vision Data Backfill
=================================================
Re-processes already-ingested PDFs and backfills ONLY the vision fields
(page_image_url, extracted_page_text) for existing Firestore questions.

This script does NOT modify training_status, optimized_json, or any other fields.
It only ADDS the missing vision data needed for the golden dataset vision_parsing task.

Prerequisites:
  pip install pymupdf firebase-admin Pillow

Usage:
  python scripts/backfill_vision_data.py scripts/papers/NEET_2025.pdf --source "NEET 2025"
  python scripts/backfill_vision_data.py scripts/papers/LEADER_UT4.pdf --source "LEADER UNIT TEST 4" --dry-run
"""

import os
import sys
import re
import io
import json
import argparse

import fitz  # PyMuPDF
from PIL import Image

import firebase_admin
from firebase_admin import credentials, firestore
from firebase_admin import storage as fb_storage

# Firebase service account key path
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")

# Firebase Storage bucket
FIREBASE_STORAGE_BUCKET = None
env_local_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
if os.path.exists(env_local_path):
    with open(env_local_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("FIREBASE_STORAGE_BUCKET="):
                FIREBASE_STORAGE_BUCKET = line.split("=", 1)[1].strip().strip("\"'")


def init_firestore() -> firestore.Client:
    """Initialize Firebase Admin SDK and return Firestore client."""
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"[FAIL] Firebase service account key not found: {SERVICE_ACCOUNT_PATH}")
        sys.exit(1)

    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred, {
            'storageBucket': FIREBASE_STORAGE_BUCKET
        })
    return firestore.client()


def extract_page_data(pdf_path: str) -> tuple[dict[int, bytes], dict[int, str]]:
    """
    Extract page images (200 DPI PNG) and text from each page of the PDF.
    Returns (page_images, page_texts) dicts keyed by page number.
    """
    doc = fitz.open(pdf_path)
    page_images: dict[int, bytes] = {}
    page_texts: dict[int, str] = {}

    for page_num in range(len(doc)):
        page = doc[page_num]

        # Render at 200 DPI
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pixmap = page.get_pixmap(matrix=mat)
        page_images[page_num] = pixmap.tobytes("png")

        # Extract text
        page_texts[page_num] = page.get_text("text")

    doc.close()
    return page_images, page_texts


def find_question_pages(page_texts: dict[int, str]) -> list[int]:
    """Identify which pages contain questions."""
    q_pattern = re.compile(r'(?:^|\n)\s*(?:#{1,3}\s*)?(?:Q\.?\s*)?\d{1,3}\s*[.)\]:\s]', re.MULTILINE)
    answer_key_patterns = [
        re.compile(r'(?:^|\n)\s*ANSWER\s+KEYS?\s*(?:\n|$)', re.IGNORECASE),
        re.compile(r'(?:^|\n)\s*CORRECT\s+ANSWERS?\s*(?:\n|$)', re.IGNORECASE),
    ]

    question_pages = []
    for page_num, text in sorted(page_texts.items()):
        # Skip answer key pages
        is_answer_key = any(p.search(text) for p in answer_key_patterns)
        if is_answer_key:
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            ak_line_pattern = re.compile(r'^\d{1,3}\.?\s*\(?[1-4ABCD]\)?\s*$')
            ak_answer_only = re.compile(r'^\(?[1-4ABCD]\)$')
            ak_qnum_only = re.compile(r'^\d{1,3}\.\s*$')
            ak_lines = sum(1 for l in lines if ak_line_pattern.match(l) or ak_answer_only.match(l) or ak_qnum_only.match(l))
            if len(lines) > 0 and ak_lines / len(lines) > 0.3:
                continue

        if q_pattern.search(text) and len(text.strip()) > 100:
            question_pages.append(page_num)

    return question_pages


def upload_page_images(
    page_images: dict[int, bytes],
    question_pages: list[int],
    source_paper: str,
) -> dict[int, str]:
    """Upload question page images to Firebase Storage. Returns {page_num: public_url}."""
    safe_source = re.sub(r'[^\w\-]', '_', source_paper)
    uploaded_urls = {}

    bucket = fb_storage.bucket()
    for pg in question_pages:
        if pg not in page_images:
            continue

        try:
            pil_img = Image.open(io.BytesIO(page_images[pg]))
            if pil_img.mode in ("RGBA", "P"):
                pil_img = pil_img.convert("RGB")

            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=70, optimize=True)

            blob_path = f"question-images/{safe_source}/page_{pg + 1}_full.jpg"
            blob = bucket.blob(blob_path)
            blob.upload_from_string(buf.getvalue(), content_type="image/jpeg")
            blob.make_public()
            uploaded_urls[pg] = blob.public_url
            print(f"    Uploaded page {pg + 1}")
        except Exception as e:
            print(f"    Failed page {pg + 1}: {e}")

    return uploaded_urls


def match_question_to_page(
    q_text: str,
    page_texts: dict[int, str],
    question_pages: list[int],
) -> int | None:
    """Find which page a question is on by matching text content."""
    if not q_text:
        return None

    # Use first 60 chars of question text (cleaned)
    search_text = q_text[:60].strip().lower()
    search_words = search_text.split()[:6]

    if not search_words:
        return None

    # Try exact substring match first
    for pg in question_pages:
        page_text_lower = page_texts.get(pg, "").lower()
        if search_text[:40] in page_text_lower:
            return pg

    # Fallback: word overlap matching
    best_pg = None
    best_score = 0
    for pg in question_pages:
        page_text_lower = page_texts.get(pg, "").lower()
        score = sum(1 for w in search_words if w in page_text_lower)
        if score > best_score:
            best_score = score
            best_pg = pg

    # Need at least 3 word matches to be confident
    if best_score >= 3:
        return best_pg
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Backfill vision data for existing Firestore questions"
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--source", "-s",
        required=True,
        help="Source paper name (must match exactly, e.g. 'NEET 2025')"
    )
    parser.add_argument(
        "--dry-run", "-d",
        action="store_true",
        help="Show what would be updated without actually writing to Firestore"
    )
    args = parser.parse_args()

    if not os.path.exists(args.pdf_path):
        print(f"[FAIL] PDF not found: {args.pdf_path}")
        sys.exit(1)

    print("=" * 60)
    print("  Neetarded -- Vision Data Backfill")
    print(f"  PDF: {args.pdf_path}")
    print(f"  Source: {args.source}")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)
    print()

    # Step 1: Extract page data from PDF
    print("[1/4] Extracting page images and text from PDF...")
    page_images, page_texts = extract_page_data(args.pdf_path)
    print(f"  Extracted {len(page_images)} pages")

    # Step 2: Find question pages
    print("[2/4] Identifying question pages...")
    question_pages = find_question_pages(page_texts)
    print(f"  Found {len(question_pages)} question pages")

    if not question_pages:
        print("[ABORT] No question pages found in PDF")
        sys.exit(1)

    # Step 3: Upload page images
    uploaded_urls = {}
    if not args.dry_run:
        print("[3/4] Uploading page images to Firebase Storage...")
        db = init_firestore()
        uploaded_urls = upload_page_images(page_images, question_pages, args.source)
        print(f"  Uploaded {len(uploaded_urls)} page images")
    else:
        print("[3/4] Skipping upload (dry run)")
        # Simulate URLs for dry run
        for pg in question_pages:
            uploaded_urls[pg] = f"<dry-run-url-page-{pg + 1}>"

    # Step 4: Update Firestore documents
    print(f"[4/4] {'Checking' if args.dry_run else 'Updating'} Firestore questions for '{args.source}'...")
    db = init_firestore()
    collection_ref = db.collection("QuestionBank")

    # Fetch all questions for this source
    docs = collection_ref.where("source_paper", "==", args.source).stream()

    updated = 0
    skipped = 0
    no_match = 0

    for doc in docs:
        data = doc.to_dict()
        q_text = data.get("optimized_json", {}).get("text", "")
        q_num = data.get("optimized_json", {}).get("questionNumber", "?")

        # Check if vision data is already present
        has_page_url = bool(data.get("page_image_url"))
        has_page_text = bool(data.get("extracted_page_text"))

        if has_page_url and has_page_text:
            skipped += 1
            continue

        # Find the matching page
        matched_page = match_question_to_page(q_text, page_texts, question_pages)

        if matched_page is None:
            print(f"    Q{q_num}: Could not match to a page")
            no_match += 1
            continue

        # Build update
        update_data = {}
        if not has_page_url and matched_page in uploaded_urls:
            update_data["page_image_url"] = uploaded_urls[matched_page]
        if not has_page_text and matched_page in page_texts:
            update_data["extracted_page_text"] = page_texts[matched_page].strip()

        if not update_data:
            skipped += 1
            continue

        if args.dry_run:
            print(f"    Q{q_num}: Would backfill {', '.join(update_data.keys())} (page {matched_page + 1})")
        else:
            collection_ref.document(doc.id).update(update_data)
            print(f"    Q{q_num}: Backfilled {', '.join(update_data.keys())} (page {matched_page + 1})")

        updated += 1

    print()
    print("=" * 50)
    print("  BACKFILL SUMMARY")
    print("=" * 50)
    print(f"  Updated:    {updated}")
    print(f"  Skipped:    {skipped} (already had vision data)")
    print(f"  No match:   {no_match} (could not find page)")
    print("=" * 50)

    if args.dry_run:
        print("\n  [DRY RUN] No changes were made. Run without --dry-run to apply.")
    else:
        print(f"\n  [DONE] Backfilled vision data for {updated} questions.")
        print("  Run export_golden_dataset.py to verify vision_parsing entries appear.")


if __name__ == "__main__":
    main()

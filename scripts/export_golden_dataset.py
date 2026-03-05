"""
Neetarded Golden Dataset Export
================================
Queries Firestore for all approved questions and exports a comprehensive
multi-task JSONL training dataset for fine-tuning a local AI model.

Tasks covered:
  1. question_parsing — raw OCR text → structured question JSON
  2. chapter_classification — question text → chapter/section assignment
  3. image_association — question text → image metadata

Prerequisites:
  pip install firebase-admin

Setup:
  Place your Firebase service account key at: scripts/serviceAccountKey.json

Usage:
  python scripts/export_golden_dataset.py
  python scripts/export_golden_dataset.py --min-approved 10 --output ./my_dataset
"""

import os
import sys
import json
import argparse
from collections import defaultdict
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore


# Firebase service account key path
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")

# Subject name lookup
SUBJECT_NAMES = {"1B0": "Biology", "2P0": "Physics", "3C0": "Chemistry"}


def init_firestore() -> firestore.Client:
    """Initialize Firebase Admin and return a Firestore client."""
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"[FAIL] Firebase service account key not found: {SERVICE_ACCOUNT_PATH}")
        sys.exit(1)

    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_approved_questions(db: firestore.Client) -> list[dict]:
    """Fetch all approved questions from QuestionBank."""
    print("[1/3] Fetching approved questions from Firestore...")
    snapshot = db.collection("QuestionBank") \
        .where("training_status", "==", "approved") \
        .stream()

    docs = []
    for doc in snapshot:
        data = doc.to_dict()
        data["_id"] = doc.id
        docs.append(data)

    print(f"  Found {len(docs)} approved questions")
    return docs


def build_dataset(docs: list[dict]) -> tuple[list[dict], dict]:
    """
    Build multi-task JSONL entries from approved docs.
    Returns (entries, stats).
    """
    print("[2/3] Building training dataset...")
    entries = []
    stats = {
        "total_entries": 0,
        "tasks": defaultdict(int),
        "subjects": defaultdict(int),
        "chapters": defaultdict(int),
        "questions_with_option_images": 0,
        "export_timestamp": datetime.now().isoformat(),
    }

    for doc in docs:
        optimized = doc.get("optimized_json", {})
        section_id = doc.get("section_id")
        chapter_binary = doc.get("chapter_binary_code")
        chapter_name = doc.get("chapter_name")
        chapter_code = doc.get("chapter_code")
        raw_ocr = doc.get("raw_ocr_input", "")
        image_url = doc.get("image_url") or optimized.get("imageUrl")
        subject_name = SUBJECT_NAMES.get(section_id, "Unknown") if section_id else "Unknown"

        # ─── Task 1: Question Parsing ───
        # Input: raw OCR text from the batch snippet, Output: the structured question
        if raw_ocr and optimized.get("text"):
            entry = {
                "task": "question_parsing",
                "input": {
                    "raw_text_snippet": raw_ocr[:2000],  # Truncate to keep manageable
                    "question_number": optimized.get("questionNumber"),
                },
                "output": {
                    "questionNumber": optimized.get("questionNumber"),
                    "text": optimized.get("text"),
                    "options": optimized.get("options", []),
                    "correctOptionId": optimized.get("correctOptionId"),
                    "explanation": optimized.get("explanation"),
                },
                "metadata": {
                    "source_id": doc["_id"],
                    "source_paper": doc.get("source_paper"),
                    "subject": subject_name,
                },
            }
            entries.append(entry)
            stats["tasks"]["question_parsing"] += 1

        # ─── Task 2: Chapter Classification ───
        # Input: question text + options, Output: chapter assignment
        if optimized.get("text") and section_id and chapter_binary and chapter_name:
            entry = {
                "task": "chapter_classification",
                "input": {
                    "text": optimized.get("text"),
                    "options": [
                        {"id": opt.get("id"), "text": opt.get("text")}
                        for opt in optimized.get("options", [])
                    ],
                },
                "output": {
                    "sectionId": section_id,
                    "sectionName": subject_name,
                    "chapterBinaryCode": chapter_binary,
                    "chapterName": chapter_name,
                    "chapterCode": chapter_code,
                },
                "metadata": {
                    "source_id": doc["_id"],
                    "source_paper": doc.get("source_paper"),
                    "confidence": "human_reviewed",
                },
            }
            entries.append(entry)
            stats["tasks"]["chapter_classification"] += 1
            stats["subjects"][subject_name] += 1
            stats["chapters"][f"{subject_name} > {chapter_name}"] += 1

        # ─── Task 3: Vision Parsing (New in v2) ───
        # Input: page image + extracted page text, Output: structured question
        page_image_url = doc.get("page_image_url")
        extracted_page_text = doc.get("extracted_page_text")
        
        if page_image_url and extracted_page_text and optimized.get("text"):
            entry = {
                "task": "vision_parsing",
                "input": {
                    "page_image_url": page_image_url,
                    "extracted_page_text": extracted_page_text[:4000], # Keep it reasonable
                    "question_number": optimized.get("questionNumber"),
                },
                "output": {
                    "questionNumber": optimized.get("questionNumber"),
                    "text": optimized.get("text"),
                    "options": optimized.get("options", []),
                    "correctOptionId": optimized.get("correctOptionId"),
                    "explanation": optimized.get("explanation"),
                },
                "metadata": {
                    "source_id": doc["_id"],
                    "source_paper": doc.get("source_paper"),
                },
            }
            entries.append(entry)
            stats["tasks"]["vision_parsing"] += 1

        # ─── Task 4: Figure Crop (New in v2) ───
        # Input: page image + question number, Output: crop bounding box
        figure_training = doc.get("figure_training")
        if page_image_url and figure_training:
            entry = {
                "task": "figure_crop",
                "input": {
                    "page_image_url": page_image_url,
                    "question_number": optimized.get("questionNumber"),
                },
                "output": {
                    "crop_bbox": figure_training
                },
                "metadata": {
                    "source_id": doc["_id"],
                    "source_paper": doc.get("source_paper"),
                },
            }
            entries.append(entry)
            stats["tasks"]["figure_crop"] += 1

        # ─── Task 5: Option Image Detection (Replaces Image Association) ───
        # Input: question text + options, Output: hasOptionImages boolean
        has_option_images = doc.get("has_option_images", False)
        if optimized.get("text"):
            entry = {
                "task": "option_image_detection",
                "input": {
                    "text": optimized.get("text"),
                    "options": [
                        {"id": opt.get("id"), "text": opt.get("text")}
                        for opt in optimized.get("options", [])
                    ],
                },
                "output": {
                    "hasOptionImages": has_option_images,
                },
                "metadata": {
                    "source_id": doc["_id"],
                    "source_paper": doc.get("source_paper"),
                },
            }
            entries.append(entry)
            stats["tasks"]["option_image_detection"] += 1
            if has_option_images:
                stats["questions_with_option_images"] += 1

    stats["total_entries"] = len(entries)
    # Convert defaultdicts to regular dicts for JSON serialization
    stats["tasks"] = dict(stats["tasks"])
    stats["subjects"] = dict(stats["subjects"])
    stats["chapters"] = dict(stats["chapters"])

    print(f"  Built {len(entries)} training entries across {len(stats['tasks'])} tasks")
    return entries, stats


def save_dataset(entries: list[dict], stats: dict, output_dir: str):
    """Save the dataset as JSONL + stats JSON."""
    print(f"[3/3] Saving dataset to {output_dir}...")
    os.makedirs(output_dir, exist_ok=True)

    # JSONL - one entry per line
    jsonl_path = os.path.join(output_dir, "dataset.jsonl")
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"  Saved {len(entries)} entries to {jsonl_path}")

    # Also save per-task files for convenience
    task_files = defaultdict(list)
    for entry in entries:
        task_files[entry["task"]].append(entry)

    for task_name, task_entries in task_files.items():
        task_path = os.path.join(output_dir, f"{task_name}.jsonl")
        with open(task_path, "w", encoding="utf-8") as f:
            for entry in task_entries:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"  Saved {len(task_entries)} entries to {task_path}")

    # Stats
    stats_path = os.path.join(output_dir, "stats.json")
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    print(f"  Saved stats to {stats_path}")

    # Summary
    print()
    print("=" * 50)
    print("  GOLDEN DATASET SUMMARY")
    print("=" * 50)
    print(f"  Total entries:      {stats['total_entries']}")
    for task, count in stats["tasks"].items():
        print(f"    {task}: {count}")
    print(f"  Subjects covered:   {len(stats['subjects'])}")
    for subject, count in sorted(stats["subjects"].items()):
        print(f"    {subject}: {count}")
    print(f"  Chapters covered:   {len(stats['chapters'])}")
    print(f"  Questions w/ option images: {stats['questions_with_option_images']}")
    print("=" * 50)


def main():
    parser = argparse.ArgumentParser(
        description="Export the Neetarded Golden Dataset from Firestore"
    )
    parser.add_argument(
        "--output", "-o",
        default=os.path.join(os.path.dirname(__file__), "golden_dataset"),
        help="Output directory (default: scripts/golden_dataset/)"
    )
    parser.add_argument(
        "--min-approved",
        type=int,
        default=1,
        help="Minimum approved questions required to proceed"
    )
    args = parser.parse_args()

    # Init Firestore
    db = init_firestore()

    # Fetch approved questions
    docs = fetch_approved_questions(db)

    if len(docs) < args.min_approved:
        print(f"\n[ABORT] Only {len(docs)} approved questions found.")
        print(f"  Need at least {args.min_approved}. Review more questions at /review first.")
        sys.exit(1)

    # Build the dataset
    entries, stats = build_dataset(docs)

    if not entries:
        print("\n[ABORT] No training entries could be generated.")
        sys.exit(1)

    # Save
    save_dataset(entries, stats, args.output)

    print(f"\n[DONE] Golden dataset exported to: {args.output}")
    print("  Use this dataset to fine-tune your local AI model.")
    print("  Recommended: Start with the chapter_classification task.")


if __name__ == "__main__":
    main()

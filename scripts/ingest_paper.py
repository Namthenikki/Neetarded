"""
Neetarded Golden Dataset -- Full Ingestion Pipeline
=====================================================
Takes a NEET PDF, extracts questions, parses them with Groq/Llama 3.3,
and pushes clean structured data to Firestore.

Prerequisites:
  pip install pymupdf groq firebase-admin

Setup:
  1. Set GROQ_API_KEY environment variable
  2. Download your Firebase service account JSON key:
     Firebase Console > Project Settings > Service Accounts > Generate New Private Key
  3. Place it as: scripts/serviceAccountKey.json
  4. Drop your PDF into: scripts/papers/

Usage:
  python scripts/ingest_paper.py scripts/papers/neet_2024.pdf --source "NEET 2024 Phase 1"
"""

import os
import sys
import json
import re
import time
import argparse
import fitz  # PyMuPDF

from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, firestore, storage as fb_storage

# ──────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
MODEL = "gpt-4.1-mini"
VISION_MODEL = "gpt-4.1-mini"  # Model for scanned PDF page parsing (supports vision)
BATCH_SIZE = 15  # Questions per API call
RATE_LIMIT_DELAY = 0.5  # Seconds between API calls (OpenAI has generous limits)

# Firebase service account key path
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
# Firebase Storage bucket (for image uploads)
# Uses FIREBASE_STORAGE_BUCKET from .env.local
FIREBASE_STORAGE_BUCKET = (
    os.environ.get("FIREBASE_STORAGE_BUCKET")
    or os.environ.get("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "")
)

# ──────────────────────────────────────────────
# CHAPTER CODE LOOKUP (mirrors quiz-data.ts)
# ──────────────────────────────────────────────
SUBJECTS = {
    "1B0": "Biology",  "BIO": "1B0",
    "2P0": "Physics",  "PHY": "2P0",
    "3C0": "Chemistry", "CHE": "3C0",
}

# Map subject aliases to canonical IDs
SECTION_ALIASES = {
    "PHY": "2P0", "BIO": "1B0", "CHE": "3C0",
    "2P0": "2P0", "1B0": "1B0", "3C0": "3C0",
    "PHYSICS": "2P0", "BIOLOGY": "1B0", "CHEMISTRY": "3C0",
}

SUBJECT_NAMES = {"1B0": "Biology", "2P0": "Physics", "3C0": "Chemistry"}

# Full chapter lookup: (sectionId, binaryCode) -> chapterName
# Mirrors the QUIZ_SUBJECTS array in src/lib/quiz-data.ts
CHAPTER_LOOKUP = {
    # Biology (1B0)
    ("1B0", "000000"): "Structural Organisation in Animals",
    ("1B0", "000001"): "Biomolecules",
    ("1B0", "000010"): "Breathing and Exchange of Gases",
    ("1B0", "000011"): "Body Fluids and Circulation",
    ("1B0", "000100"): "Excretory Products and their Elimination",
    ("1B0", "000101"): "Locomotion and Movement",
    ("1B0", "000110"): "Neural Control and Coordination",
    ("1B0", "000111"): "Chemical Coordination and Integration",
    ("1B0", "001000"): "Animal Kingdom",
    ("1B0", "001001"): "Human Reproduction",
    ("1B0", "001010"): "Reproductive Health",
    ("1B0", "001011"): "Evolution",
    ("1B0", "001100"): "Human Health and Disease",
    ("1B0", "001101"): "Biotechnology – Principles and Processes",
    ("1B0", "001110"): "Biotechnology and its Applications",
    ("1B0", "001111"): "Animal Tissue",
    ("1B0", "010000"): "Cell – The Unit of Life",
    ("1B0", "010001"): "Cell Cycle and Cell Division",
    ("1B0", "010010"): "Principles of Inheritance and Variation",
    ("1B0", "010011"): "Molecular Basis of Inheritance",
    ("1B0", "010100"): "The Living World",
    ("1B0", "010101"): "Biological Classification",
    ("1B0", "010110"): "Microbes in Human Welfare",
    ("1B0", "010111"): "Plant Kingdom",
    ("1B0", "011000"): "Morphology of Flowering Plants",
    ("1B0", "011001"): "Anatomy of Flowering Plants",
    ("1B0", "011010"): "Sexual Reproduction in Flowering Plants",
    ("1B0", "011011"): "Respiration in Plants",
    ("1B0", "011100"): "Photosynthesis in Higher Plants",
    ("1B0", "011101"): "Plant Growth and Development",
    ("1B0", "011110"): "Organisms and Population",
    ("1B0", "011111"): "Ecosystem",
    ("1B0", "100000"): "Biodiversity and Conservation",
    # Physics (2P0)
    ("2P0", "000000"): "Units and Measurements",
    ("2P0", "000001"): "Mathematical Tools",
    ("2P0", "000010"): "Motion in a Straight Line",
    ("2P0", "000011"): "Motion in a Plane",
    ("2P0", "000100"): "Laws of Motion",
    ("2P0", "000101"): "Work, Energy and Power",
    ("2P0", "000110"): "Centre of Mass & System of Particles",
    ("2P0", "000111"): "Rotational Motion",
    ("2P0", "001000"): "Gravitation",
    ("2P0", "001001"): "Mechanical Properties of Solids",
    ("2P0", "001010"): "Mechanical Properties of Fluids",
    ("2P0", "001011"): "Thermal Properties of Matter",
    ("2P0", "001100"): "Kinetic Theory",
    ("2P0", "001101"): "Thermodynamics",
    ("2P0", "001110"): "Oscillations",
    ("2P0", "001111"): "Waves",
    ("2P0", "010000"): "Electric Charges and Fields",
    ("2P0", "010001"): "Electrostatic Potential and Capacitance",
    ("2P0", "010010"): "Current Electricity",
    ("2P0", "010011"): "Moving Charges and Magnetism",
    ("2P0", "010100"): "Magnetism and Matter",
    ("2P0", "010101"): "Electromagnetic Induction",
    ("2P0", "010110"): "Alternating Current",
    ("2P0", "010111"): "Electromagnetic Waves",
    ("2P0", "011000"): "Ray Optics and Optical Instruments",
    ("2P0", "011001"): "Wave Optics",
    ("2P0", "011010"): "Dual Nature of Radiation and Matter",
    ("2P0", "011011"): "Atoms",
    ("2P0", "011100"): "Nuclei",
    ("2P0", "011101"): "Semiconductor Electronics",
    # Chemistry (3C0)
    ("3C0", "000000"): "Some Basic Concepts of Chemistry",
    ("3C0", "000001"): "Redox Reactions",
    ("3C0", "000010"): "Structure of Atom",
    ("3C0", "000011"): "Classification of Elements and Periodicity",
    ("3C0", "000100"): "Chemical Bonding and Molecular Structure",
    ("3C0", "000101"): "Solutions",
    ("3C0", "000110"): "Thermodynamics",
    ("3C0", "000111"): "Equilibrium",
    ("3C0", "001000"): "Electrochemistry",
    ("3C0", "001001"): "Chemical Kinetics",
    ("3C0", "001010"): "Organic Chemistry – IUPAC Nomenclature",
    ("3C0", "001011"): "Organic Chemistry – Isomerism",
    ("3C0", "001100"): "Organic Chemistry – GOC",
    ("3C0", "001101"): "Hydrocarbons",
    ("3C0", "001110"): "Haloalkanes and Haloarenes",
    ("3C0", "001111"): "Alcohols, Phenols and Ethers",
    ("3C0", "010000"): "Aldehydes, Ketones and Carboxylic Acids",
    ("3C0", "010001"): "Amines",
    ("3C0", "010010"): "Biomolecules",
    ("3C0", "010011"): "Purification and Analysis of Organic Compounds",
    ("3C0", "010100"): "Coordination Compounds",
    ("3C0", "010101"): "The p-Block Elements",
    ("3C0", "010110"): "The d- and f-Block Elements",
    ("3C0", "010111"): "Salt Analysis",
    ("3C0", "011000"): "p-Block Elements (Group 13 & 14)",
    ("3C0", "011001"): "The p-Block Elements (XII)",
}

# ──────────────────────────────────────────────
# SYSTEM PROMPT FOR BATCH PARSING
# ──────────────────────────────────────────────
SYSTEM_PROMPT = """You are a NEET exam question parser. You receive a block of raw text containing MULTIPLE questions extracted from a PDF.

RULES:
1. Parse EVERY question in the text. Each question starts with a number (e.g. "1.", "1)", "Q1", "### 1)", etc.).
2. For each question, extract: question number, question text, and all 4 options.
3. Options MUST have ids "A", "B", "C", "D" -- regardless of how they appear in the raw text (a/b/c/d, 1/2/3/4, (i)/(ii), etc.). Map the FIRST option to "A", second to "B", third to "C", fourth to "D".
4. Set correctOptionId to "A" as a placeholder -- the correct answer will be injected separately from a pre-parsed answer key. Do NOT try to guess the answer.
5. Clean up OCR artifacts: fix broken words, remove stray characters, normalize whitespace.
6. If a chapter marker like #PHY #000001 or #3C0-001001 appears, record the sectionId and chapterBinaryCode. If no marker, set both to null.
7. Set explanation to null.
8. If there is an image reference like [Image: URL], extract the URL into imageUrl and remove the tag from question text.
9. Format all mathematical powers and exponents using true Unicode superscripts instead of caret notation (e.g., "x²" instead of "x^2", "10⁻³" instead of "10^-3", "m/s²" instead of "m/s^2"). Let variables like a, b, c, d be italicized if you wish but ALWAYS use standard superscript characters for exponents.
10. Format Chemistry ions, formulas, and coordination compounds using proper Unicode superscripts and subscripts (e.g., "Ca²⁺", "Cl⁻", "SO₄²⁻", "H₂O", "PO₄³⁻", "[Co(NH₃)₃Cl₃]"). DO NOT use formats like Co2+, SO42-, or [Co(NH3)3Cl3].
11. Format scientific units with proper Unicode superscripts (e.g., "mol L⁻¹", "S cm² mol⁻¹", "J K⁻¹ mol⁻¹"). DO NOT use formats like "mol L-1" or "cm2 mol-1".
12. Ensure Greek letters have proper subscripts/superscripts if needed (e.g., use "Λₘ" instead of "Λm", "Λ₊°" instead of "Λ+°", "Λ₋°" instead of "Λ-°").
13. EXTREMELY IMPORTANT for "Match List..." or "Match the Column" questions: You MUST manually insert double newlines (`\n\n`) before AND after `List I` and `List II` headings to force paragraph breaks. Do NOT dump them inline. Example format strictly required: "Match List I with List II\n\n**List I:**\nA. Humidity\nB. Alloys\n\n**List II:**\nI. Solid in gas\nII. Liquid in solid\n\nChoose the correct answer..."
14. Format mathematical and physical variables with subscripts using Unicode subscripts. Do NOT write them inline. For example, write "Eₙ" instead of "En" or "E_n", write "rₙ" instead of "rn", write "v₀" instead of "v0", and write "Kₐ₁", "Kₐ₂", "Kₐ₃" instead of "Ka1", "Ka2", "Ka3", and "pKₐ" instead of "pKa".
15. CAUTION for "Multiple Statement" or "Choose the correct answer" type questions: If a question has statements labeled A, B, C, D, E, F, you MUST extract and include the full text of those statements in the `text` field. DO NOT skip or omit the statements. The `options` array MUST contain only the final 4 choices (e.g., "A and C only", "B, D, F only"). The statements themselves (A, B, C, D, E, F) should be kept clearly formatted within the `text` field.
16. EXTREMELY IMPORTANT for "Statement I / Statement II", "Assertion / Reason": You MUST manually insert double newlines (`\n\n`) to force paragraph spacing between each and every statement. NEVER let them run together. Example format strictly required: "Given below are two statements:\n\n**Statement I:** In a floral formula...\n\n**Statement II:** In a floral formula...\n\nIn the light of the above..."
17. EXTREMELY IMPORTANT for statements labeled sequentially like A., B., C., D., E.: Just like Statement I/II, you MUST manually insert double newlines (`\n\n`) before AND after EACH statement to force paragraph spacing. NEVER let them run together inline. Example format strictly required: "Read the statements carefully:\n\n**A.** The first statement...\n\n**B.** The second statement...\n\n**C.** The third statement...\n\nChoose the correct answer from the options..."
18. NEVER split a single numbered question into multiple questions. All text, statements, formulas, and tables that appear between one question number (e.g., "53.") and the next question number (e.g., "54.") belong to the SAME single question object. If a question has 5 statements and 4 options, it is still ONLY ONE question.
19. FIGURE-BASED OPTIONS: Set `hasOptionImages` to true ONLY when the options are PURELY graphical with ZERO readable text — for example, graphs with plotted curves, circuit diagrams, chemical structure drawings, or molecular orbital diagrams. In ALL other cases, set `hasOptionImages` to false and PARSE the option text:
   - If options contain text like "Helix on +ve side of z-axis" → parse as text, hasOptionImages=false
   - If options contain math formulas like "2πm/qB" → parse using Unicode (2πm/qB), hasOptionImages=false
   - If options contain short labels like "circle in xy plane" → parse as text, hasOptionImages=false
   - If options have text + a small diagram beside it → parse the text, hasOptionImages=false
   - ONLY if the option IS a graph/circuit/compound structure with no text at all → hasOptionImages=true, set each option text to ""

OUTPUT FORMAT -- Return ONLY a JSON array of objects, nothing else:
[
  {
    "questionNumber": <integer>,
    "text": "<clean question text>",
    "options": [
      {"id": "A", "text": "<option text or empty string if figure>"},
      {"id": "B", "text": "<option text or empty string if figure>"},
      {"id": "C", "text": "<option text or empty string if figure>"},
      {"id": "D", "text": "<option text or empty string if figure>"}
    ],
    "correctOptionId": "A",
    "explanation": null,
    "imageUrl": null,
    "hasOptionImages": false,
    "sectionId": "<e.g. PHY, BIO, CHE, 1B0, 2P0, 3C0, or null>",
    "chapterBinaryCode": "<6-digit binary or null>"
  }
]

CRITICAL: Return ONLY the JSON array. No markdown, no code fences, no extra text."""


# ──────────────────────────────────────────────
# HYBRID VISION+TEXT PROMPT (for normal PDFs with inline formula images)
# ──────────────────────────────────────────────
HYBRID_VISION_PROMPT = """You are a NEET exam question parser. You receive BOTH a page image AND extracted text from the same PDF page.

CRITICAL CONTEXT: The extracted text was obtained via PDF text extraction, which CANNOT read inline images. Many NEET PDFs embed mathematical formulas, vector notation (î, ĵ, k̂), chemical equations, Greek symbols, and special characters as INLINE IMAGES within the text. These appear as GAPS or missing content in the extracted text.

YOUR JOB: Cross-reference the extracted text with the page image. Wherever the text has gaps or seems incomplete (e.g., "...field is a, then..." when the image shows "B̄ = 2î + aĵ + k̂ is -5î + 3ĵ + a²k̂"), use the page image to fill in the complete content.

RULES:
1. Parse EVERY question visible on this page. Each question starts with a number (e.g. "1.", "1)", "Q1", etc.).
   BILINGUAL PAPERS: If this page contains questions in MULTIPLE LANGUAGES (e.g., English + Hindi side-by-side, or English on left and Hindi on right), parse ONLY the ENGLISH version of each question. Completely IGNORE the Hindi/other language translation. Each question number should appear exactly ONCE in your output. Identify the English version by the language of the question text — English uses Latin script, Hindi uses Devanagari (हिंदी) script.
2. For each question, extract: question number, question text, and all 4 options.
3. Options MUST have ids "A", "B", "C", "D" -- map the FIRST option to "A", second to "B", third to "C", fourth to "D".
4. Set correctOptionId to "A" as a placeholder -- the correct answer will be injected separately.
5. ALWAYS prefer the PAGE IMAGE over the extracted text for mathematical content. The image is the ground truth.
6. Clean up OCR artifacts: fix broken words, remove stray characters, normalize whitespace.
7. If a chapter marker like #PHY #000001 or #3C0-001001 appears, record the sectionId and chapterBinaryCode. If no marker, set both to null.
8. Set explanation to null.
9. Format all mathematical powers and exponents using true Unicode superscripts (e.g., "x²" not "x^2", "10⁻³" not "10^-3", "m/s²" not "m/s^2").
10. NEVER USE LaTeX COMMANDS. Do NOT output \\frac, \\sqrt, \\text, \\left, \\right, \\cdot, \\times, \\vec, \\hat, \\cos, \\sin, or ANY LaTeX syntax. Instead:
   - Fractions: use "/" → "i₀/6" NOT "\\frac{i_0}{6}", "3T/2" NOT "\\frac{3T}{2}"
   - Square roots: use "√" → "√2" NOT "\\sqrt{2}", "2√3" NOT "2\\sqrt{3}"
   - Subscripts: use Unicode → "i₀" NOT "i_0", "μ₀" NOT "\\mu_0"
   - Greek letters: use actual Unicode → "μ₀" NOT "\\mu_0", "π" NOT "\\pi", "ε₀" NOT "\\epsilon_0"
   - Multiplication: use "×" or "·" → NOT "\\times" or "\\cdot"
   - Vectors/Hats: use "Ē" NOT "\\vec{E}", "î" NOT "\\hat{i}", "k̂" NOT "\\hat{k}"
   - Functions/Text: use standard text "cos" NOT "\\cos", " N/C" NOT "\\text{N/C}"
11. NEVER INCLUDE OPTIONS IN THE QUESTION TEXT. The `text` field MUST END exactly BEFORE the first option begins. Do NOT include the numbered choices (e.g., "(1) ... (2) ...") inside the `text`. They belong ONLY in the `options` array.
12. Format Chemistry ions, formulas with proper Unicode sub/superscripts (e.g., "Ca²⁺", "SO₄²⁻", "H₂O", "[Co(NH₃)₃Cl₃]").
13. Format scientific units with proper Unicode superscripts (e.g., "mol L⁻¹", "S cm² mol⁻¹").
14. Format vector notation properly: use proper symbols like B̄, î, ĵ, k̂, →, etc. from the image.
15. EXTREMELY IMPORTANT for "Match List..." or "Match the Column" questions: Insert double newlines between List I and List II headings.
16. Format mathematical and physical variables with subscripts using Unicode subscripts (e.g., "Eₙ" not "En", "rₙ" not "rn").
15. CAUTION for "Multiple Statement" questions: Include ALL statement text in the `text` field. Options should be the final 4 choices only.
16. EXTREMELY IMPORTANT for "Statement I / Statement II" and sequential statements (A., B., C.): Insert double newlines between each statement.
17. NEVER split a single numbered question into multiple questions.
18. CROSS-PAGE QUESTIONS: If a question clearly continues from a previous page (e.g., the page starts with continuation text, a figure, or options without a new question number), include it as a question entry with the SAME question number it belongs to. Use the question number visible in the continuation or the last question number from context. The text should contain ONLY the continuation part from THIS page.
19. QUESTION FIGURES: Set `hasImage` to true when a question has an associated figure, diagram, or drawing ON THE PAGE that is essential to understanding the question. This includes:
   - Circuit diagrams (resistors, batteries, capacitors, etc.)
   - Physics diagrams (ray diagrams, force diagrams, motion paths, etc.)
   - Graphs and plots (V-I curves, displacement-time, etc.)
   - Chemical structures shown IN the question area (not in options)
   - Biological diagrams (cell structures, anatomical diagrams, etc.)
   - Any drawn figure referenced by "as shown in the figure" or "shown in the diagram"
   Set `hasImage` to false ONLY if the question is purely textual with no associated figure.
20. FIGURE-BASED OPTIONS: Set `hasOptionImages` to true when the options are primarily DRAWN/GRAPHICAL content that cannot be meaningfully represented as text. This includes:
   - Chemical structure drawings (benzene rings, molecular structures, even if they have labels like OH, CH₃, COCH₃)
   - Graphs with plotted curves or data
   - Circuit diagrams as options
   - Molecular orbital diagrams
   - Any drawn/sketched figures as answer choices
   When `hasOptionImages` is true, set each option text to a brief description like "Structure A" or "".
   Set `hasOptionImages` to false and PARSE option text when:
   - Options are text like "Helix on +ve side of z-axis"
   - Options are math formulas like "2πm/qB" → parse using Unicode
   - Options are short text labels like "circle in xy plane"
   - Options have text + a small icon/symbol beside it → parse the text

OUTPUT FORMAT -- Return ONLY a JSON array of objects, nothing else:
[
  {
    "questionNumber": <integer>,
    "text": "<complete question text with all formulas from the image>",
    "options": [
      {"id": "A", "text": "<option text or empty string if figure>"},
      {"id": "B", "text": "<option text or empty string if figure>"},
      {"id": "C", "text": "<option text or empty string if figure>"},
      {"id": "D", "text": "<option text or empty string if figure>"}
    ],
    "correctOptionId": "A",
    "explanation": null,
    "imageUrl": null,
    "hasImage": false,
    "hasOptionImages": false,
    "sectionId": "<e.g. PHY, BIO, CHE, 1B0, 2P0, 3C0, or null>",
    "chapterBinaryCode": "<6-digit binary or null>"
  }
]

CRITICAL: Return ONLY the JSON array. No markdown, no code fences, no extra text."""


# ──────────────────────────────────────────────
# PDF EXTRACTION
# ──────────────────────────────────────────────
# Google Cloud Vision OCR key path (for scanned PDFs)
VISION_KEY_PATH = os.path.join(os.path.dirname(__file__), "vision_key.json")

# Threshold: if we get fewer than this many chars per page, it's likely scanned
MIN_CHARS_PER_PAGE = 500


def ocr_pdf_with_vision(pdf_path: str) -> str:
    """
    OCR a scanned PDF using Google Cloud Vision API.
    Uses document_text_detection for better structured text from documents.
    """
    try:
        from google.cloud import vision
        from google.oauth2 import service_account
    except ImportError:
        print("  [ERROR] google-cloud-vision not installed. Run: pip install google-cloud-vision")
        return ""

    if not os.path.exists(VISION_KEY_PATH):
        print(f"  [ERROR] Vision key not found at: {VISION_KEY_PATH}")
        return ""

    print("  [OCR] Initializing Google Cloud Vision client...")
    creds = service_account.Credentials.from_service_account_file(VISION_KEY_PATH)
    client = vision.ImageAnnotatorClient(credentials=creds)

    doc = fitz.open(pdf_path)
    full_text = []
    page_count = len(doc)

    for page_num in range(page_count):
        page = doc[page_num]
        # Render page to a high-res image (300 DPI for good OCR quality)
        mat = fitz.Matrix(300 / 72, 300 / 72)  # 300 DPI
        pixmap = page.get_pixmap(matrix=mat)
        img_bytes = pixmap.tobytes("png")

        print(f"  [OCR] Extracting text from page {page_num + 1}/{page_count}...", flush=True)

        # Send to Google Cloud Vision -- use document_text_detection for better results
        image = vision.Image(content=img_bytes)
        response = client.document_text_detection(image=image)

        if response.error.message:
            print(f"  [OCR] Error on page {page_num + 1}: {response.error.message}")
            continue

        if response.full_text_annotation:
            page_text = response.full_text_annotation.text
            full_text.append(f"--- PAGE {page_num + 1} ---\n{page_text}")

    doc.close()
    combined = "\n".join(full_text)
    print(f"  [OCR] Done! Extracted {len(combined)} characters from {page_count} pages via Vision OCR")
    return combined


def extract_text_from_pdf(pdf_path: str) -> tuple[str, bool]:
    """
    Extract text from a PDF.
    First tries PyMuPDF's native text extraction.
    If the result is too sparse (scanned PDF), automatically falls back
    to Google Cloud Vision OCR.

    Returns (text, is_scanned) where is_scanned=True means we had to use OCR.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    full_text = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        if text.strip():
            full_text.append(f"--- PAGE {page_num + 1} ---\n{text}")

    combined = "\n".join(full_text)
    page_count = len(doc)
    doc.close()

    chars_per_page = len(combined) / max(page_count, 1)
    print(f"  Extracted {page_count} pages, {len(combined)} characters ({chars_per_page:.0f} chars/page)")

    # Detect scanned PDF: very low text output relative to page count
    if chars_per_page < MIN_CHARS_PER_PAGE and page_count > 0:
        print(f"  [AUTO-DETECT] Low text density ({chars_per_page:.0f} chars/page < {MIN_CHARS_PER_PAGE})")
        print(f"  [AUTO-DETECT] This appears to be a SCANNED PDF -> will use GPT-4 Vision page parser")
        return combined, True

    return combined, False


# ──────────────────────────────────────────────
# IMAGE EXTRACTION & MAPPING
# ──────────────────────────────────────────────
def extract_images_from_pdf(pdf_path: str, min_size: int = 30, min_bytes: int = 500) -> list[dict]:
    """
    Extract all images from the PDF with spatial data.
    Returns a list of dicts with: page, bbox, image_bytes, ext, width, height.
    Filters out:
      - Tiny images (< min_size px) — bullets, icons
      - Very small files (< min_bytes) — black squares, formula artifacts
      - Repeated watermarks (same image appearing on 3+ pages)
    """
    import hashlib

    doc = fitz.open(pdf_path)
    raw_images = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        image_list = page.get_images(full=True)

        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]
            try:
                base_image = doc.extract_image(xref)
                if not base_image:
                    continue

                width = base_image["width"]
                height = base_image["height"]
                img_bytes = base_image["image"]

                # Filter 1: Tiny pixel dimensions (icons, bullets)
                if width < min_size or height < min_size:
                    continue

                # Filter 2: Very small file size (black squares, solid color artifacts)
                if len(img_bytes) < min_bytes:
                    continue

                # Get the image bounding box on the page
                rects = page.get_image_rects(xref)
                if not rects:
                    continue
                rect = rects[0]  # Use first occurrence

                img_hash = hashlib.md5(img_bytes).hexdigest()

                raw_images.append({
                    "page": page_num,
                    "bbox": (rect.x0, rect.y0, rect.x1, rect.y1),
                    "image_bytes": img_bytes,
                    "ext": base_image.get("ext", "png"),
                    "width": width,
                    "height": height,
                    "y_center": (rect.y0 + rect.y1) / 2,
                    "_hash": img_hash,
                })
            except Exception as e:
                print(f"    [WARN] Failed to extract image {img_index} on page {page_num + 1}: {e}")

    doc.close()

    # Filter 3: Remove watermarks — images that appear on 3+ different pages
    from collections import Counter
    hash_page_count: dict[str, set] = {}
    for img in raw_images:
        h = img["_hash"]
        if h not in hash_page_count:
            hash_page_count[h] = set()
        hash_page_count[h].add(img["page"])

    watermark_hashes = {h for h, pages in hash_page_count.items() if len(pages) >= 3}
    if watermark_hashes:
        print(f"  Detected {len(watermark_hashes)} watermark/repeated images (appear on 3+ pages), removing")

    images = [img for img in raw_images if img["_hash"] not in watermark_hashes]

    print(f"  Extracted {len(images)} images from PDF (filtered from {len(raw_images)} raw)")
    return images


def get_question_positions(pdf_path: str) -> list[dict]:
    """
    Find where each question number appears on the page using text positions.
    Returns a list of dicts: {question_number, page, y_position, x_position}.
    """
    doc = fitz.open(pdf_path)
    positions = []

    # Pattern: "1." or "1)" or "Q.1" or "Q1." at the start of a span
    q_pattern = re.compile(r'^(?:Q\.?\s?)?(\d{1,3})[\.\)]\s')

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")

        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:  # Only text blocks
                continue
            for line in block.get("lines", []):
                # Concatenate spans to get the full line text
                line_text = "".join(span["text"] for span in line.get("spans", []))
                match = q_pattern.match(line_text.strip())
                if match:
                    q_num = int(match.group(1))
                    # Use the bbox of the first span for position
                    if line.get("spans"):
                        bbox = line["spans"][0]["bbox"]
                        positions.append({
                            "question_number": q_num,
                            "page": page_num,
                            "y_position": bbox[1],  # Top of text
                            "x_position": bbox[0],
                        })

    doc.close()

    # Deduplicate: keep the first occurrence of each question number
    seen = set()
    unique = []
    for p in positions:
        if p["question_number"] not in seen:
            seen.add(p["question_number"])
            unique.append(p)

    print(f"  Found {len(unique)} question positions in PDF")
    return unique


def map_images_to_questions(
    images: list[dict],
    question_positions: list[dict],
) -> dict[int, list[dict]]:
    """
    Map each image to the nearest question number that appears before/above it.
    Returns {question_number: [image_dicts]}.
    """
    if not images or not question_positions:
        return {}

    # Sort question positions by page, then y
    q_sorted = sorted(question_positions, key=lambda p: (p["page"], p["y_position"]))

    mapping: dict[int, list[dict]] = {}

    for img in images:
        img_page = img["page"]
        img_y = img["y_center"]

        # Find the closest question that appears BEFORE this image
        # (same page and above, or any question on a previous page)
        best_q = None
        best_distance = float("inf")

        for qp in q_sorted:
            if qp["page"] > img_page:
                break  # No point checking later pages

            if qp["page"] == img_page:
                # Same page: question must be above the image
                if qp["y_position"] <= img_y:
                    distance = img_y - qp["y_position"]
                    if distance < best_distance:
                        best_distance = distance
                        best_q = qp["question_number"]
            else:
                # Previous page: this question is before the image
                # Use a large base distance + the y offset
                distance = (img_page - qp["page"]) * 10000 + (800 - qp["y_position"])
                if distance < best_distance:
                    best_distance = distance
                    best_q = qp["question_number"]

        if best_q is not None:
            if best_q not in mapping:
                mapping[best_q] = []
            mapping[best_q].append(img)

    # Stats
    total_mapped = sum(len(v) for v in mapping.values())
    print(f"  Mapped {total_mapped} images to {len(mapping)} questions")
    return mapping


def upload_images_to_firebase(
    image_map: dict[int, list[dict]],
    source_paper: str,
) -> dict[int, str]:
    """
    Upload images to Firebase Storage.
    Returns {question_number: public_url}.
    If multiple images map to a question, they are stitched vertically.
    """
    if not FIREBASE_STORAGE_BUCKET:
        print("  [WARN] FIREBASE_STORAGE_BUCKET not set, skipping image upload")
        print("  Set FIREBASE_STORAGE_BUCKET in .env.local to your bucket name")
        # Still return local paths for dry-run
        return {}

    # Initialize Firebase if not already initialized
    init_firestore()
    bucket = fb_storage.bucket()

    urls: dict[int, str] = {}
    safe_source = re.sub(r'[^\w\-]', '_', source_paper)

    for q_num, img_list in image_map.items():
        try:
            # Use the first (usually only) image for the question
            img = img_list[0]
            ext = img["ext"]
            if ext == "jpeg":
                ext = "jpg"

            blob_path = f"question-images/{safe_source}/q{q_num}.{ext}"
            blob = bucket.blob(blob_path)

            # Upload
            content_type = f"image/{ext}" if ext != "jpg" else "image/jpeg"
            blob.upload_from_string(img["image_bytes"], content_type=content_type)

            # Make publicly readable
            blob.make_public()
            urls[q_num] = blob.public_url

        except Exception as e:
            print(f"    [WARN] Failed to upload image for Q{q_num}: {e}")

    print(f"  Uploaded {len(urls)} images to Firebase Storage")
    return urls


def save_images_locally(
    image_map: dict[int, list[dict]],
    output_dir: str,
) -> dict[int, str]:
    """
    Save images to local disk (for dry-run mode).
    Returns {question_number: local_path}.
    """
    os.makedirs(output_dir, exist_ok=True)
    paths: dict[int, str] = {}

    for q_num, img_list in image_map.items():
        img = img_list[0]
        ext = img["ext"]
        if ext == "jpeg":
            ext = "jpg"
        filename = f"q{q_num}.{ext}"
        filepath = os.path.join(output_dir, filename)

        with open(filepath, "wb") as f:
            f.write(img["image_bytes"])
        paths[q_num] = filepath

    print(f"  Saved {len(paths)} images to {output_dir}")
    return paths


# ──────────────────────────────────────────────
# ANSWER KEY AUTO-DETECTION & DETERMINISTIC PARSING
# ──────────────────────────────────────────────
def extract_answer_key_section(full_text: str) -> tuple[str, str]:
    """
    Auto-detect and separate the answer key from the question text.
    Returns (questions_text, answer_key_text).
    """
    answer_key_patterns = [
        r'(?i)(?:^|\n)\s*-*\s*(?:PAGE\s+\d+\s*-*\s*\n)?\s*ANSWER\s+KEYS?\s*\n',
        r'(?i)(?:^|\n)\s*ANSWER\s+KEYS?\s*\n',
        r'(?i)(?:^|\n)\s*ANSWER\s*S?\s*(?:AND|&)\s*SOLUTIONS?\s*\n',
        r'(?i)(?:^|\n)\s*CORRECT\s+ANSWERS?\s*\n',
        r'(?i)(?:^|\n)\s*ANSWERS?\s*\n',
        r'(?i)(?:^|\n)\s*(?:NEET|NTA).*ANSWER\s*KEY',
        # Dense answer grid: "1. (A) 2. (B) 3. (C)" repeated
        r'(?i)(?:^|\n)\s*1\.?\s*\(?[ABCD1-4]\)?\s+2\.?\s*\(?[ABCD1-4]\)?\s+3\.?\s*\(?[ABCD1-4]\)',
    ]

    for pattern in answer_key_patterns:
        match = re.search(pattern, full_text)
        if match:
            split_pos = match.start()
            questions_text = full_text[:split_pos].strip()
            answer_key_text = full_text[split_pos:].strip()
            print(f"  [AUTO-DETECT] Found answer key section at position {split_pos}")
            print(f"  Questions: {len(questions_text)} chars | Answer key: {len(answer_key_text)} chars")
            return questions_text, answer_key_text

    # Fallback: look for a dense block of "Q->Answer" patterns (e.g. "1-A 2-B 3-C...")
    # This catches answer keys that don't have a clear heading
    dense_pattern = re.compile(
        r'((?:\d{1,3}\s*[.\-):>]\s*\(?[ABCD1-4]\)?\s*[,;\s]*){10,})',
        re.IGNORECASE
    )
    dense_match = dense_pattern.search(full_text)
    if dense_match:
        # Check if this block is near the end of the text (answer keys are usually at the end)
        if dense_match.start() > len(full_text) * 0.5:  # In the second half
            split_pos = dense_match.start()
            questions_text = full_text[:split_pos].strip()
            answer_key_text = full_text[split_pos:].strip()
            print(f"  [AUTO-DETECT] Found dense answer block at position {split_pos}")
            print(f"  Questions: {len(questions_text)} chars | Answer key: {len(answer_key_text)} chars")
            return questions_text, answer_key_text

    print("  [AUTO-DETECT] No answer key section found in PDF")
    return full_text, ""


def parse_answer_key_deterministic(answer_key_text: str) -> dict[int, str]:
    """
    Deterministically parse the tabular answer key from the PDF.

    The PDF answer key format (after PyMuPDF extraction) looks like:
      ANSWER KEYS
      PHYSICS
      Q.
      1\n2\n3\n...\n20
      A.
      2\n4\n4\n...\n4
      Q.
      21\n22\n...\n40
      A.
      3\n2\n...\n1
      ...
      CHEMISTRY
      Q.\n46\n47\n...
      A.\n3\n2\n...
      ...
      BIOLOGY
      Q.\n91\n92\n...
      A.\n4\n4\n...

    Returns a dict mapping question_number -> correct_option_letter (A/B/C/D).
    The answer key uses 1=A, 2=B, 3=C, 4=D.
    """
    num_to_letter = {1: "A", 2: "B", 3: "C", 4: "D"}
    answers: dict[int, str] = {}

    # Split into lines and process Q./A. blocks
    lines = answer_key_text.split("\n")
    i = 0
    current_q_numbers: list[int] = []

    # --- Format 1a: "N. (X)" inline format (e.g., "1. (2)", "136. (1)") ---
    # Common in PW/coaching institute PDFs
    inline_pattern = re.compile(r'^\s*(\d{1,3})\.\s*\(([1-4])\)\s*$')
    for line in lines:
        m = inline_pattern.match(line.strip())
        if m:
            q_num = int(m.group(1))
            ans_num = int(m.group(2))
            answers[q_num] = num_to_letter.get(ans_num, "A")

    # --- Format 1b: Split-line format where number and answer are on separate lines ---
    # PyMuPDF extracts two-column answer key pages as: "1.\n(2)\n2.\n(1)\n..."
    qnum_pattern = re.compile(r'^\s*(\d{1,3})\.\s*$')
    ans_pattern = re.compile(r'^\s*\(([1-4])\)\s*$')
    for j in range(len(lines) - 1):
        qm = qnum_pattern.match(lines[j].strip())
        am = ans_pattern.match(lines[j + 1].strip())
        if qm and am:
            q_num = int(qm.group(1))
            ans_num = int(am.group(1))
            if q_num not in answers:  # Don't overwrite inline matches
                answers[q_num] = num_to_letter.get(ans_num, "A")

    if answers:
        print(f"  [DETERMINISTIC] Parsed {len(answers)} answers (inline + split-line format)")
        return answers

    # --- Format 2: Q./A. block format (original NTA-style) ---
    while i < len(lines):
        line = lines[i].strip()

        # Detect Q. line — start collecting question numbers
        if line == "Q.":
            current_q_numbers = []
            i += 1
            # Collect question numbers until we hit "A."
            while i < len(lines) and lines[i].strip() != "A.":
                num_str = lines[i].strip()
                if num_str.isdigit():
                    current_q_numbers.append(int(num_str))
                i += 1
            continue

        # Detect A. line — collect answers and pair with question numbers
        if line == "A.":
            answer_values: list[int] = []
            i += 1
            # Collect answer values until we hit next Q., a section header, or end
            while i < len(lines):
                val_str = lines[i].strip()
                if val_str == "Q." or val_str == "A.":
                    break
                # Stop at section headers like CHEMISTRY, BIOLOGY
                if val_str.upper() in ("PHYSICS", "CHEMISTRY", "BIOLOGY", "BOTANY", "ZOOLOGY"):
                    break
                if val_str.isdigit() and int(val_str) in (1, 2, 3, 4):
                    answer_values.append(int(val_str))
                elif val_str == "":
                    pass  # skip blank lines
                i += 1

            # Pair question numbers with answer values
            if len(current_q_numbers) == len(answer_values):
                for qn, ans in zip(current_q_numbers, answer_values):
                    answers[qn] = num_to_letter.get(ans, "A")
            else:
                print(f"  [WARN] Q/A count mismatch: {len(current_q_numbers)} questions, {len(answer_values)} answers")
                # Still pair what we can
                for j in range(min(len(current_q_numbers), len(answer_values))):
                    answers[current_q_numbers[j]] = num_to_letter.get(answer_values[j], "A")

            current_q_numbers = []
            continue

        i += 1

    return answers


# ──────────────────────────────────────────────
# TEXT SPLITTING INTO BATCHES
# ──────────────────────────────────────────────
def split_into_batches(full_text: str, batch_size: int = BATCH_SIZE) -> list[str]:
    """
    Split extracted text into batches for Groq API calls.

    Strategy: Find question number patterns and group them into batches.
    If we can't find clear question patterns, split by character count.
    """
    # Try to find question boundaries using common patterns
    # Matches: "1.", "1)", "Q1.", "### 1)", "72.", etc.
    question_pattern = re.compile(
        r'(?:^|\n)\s*(?:#{1,3}\s*)?(?:Q\.?\s*)?(\d{1,3})\s*[.)\]]\s',
        re.MULTILINE
    )

    matches = list(question_pattern.finditer(full_text))

    if len(matches) >= 2:
        # We found question boundaries -- split by them
        print(f"  Found {len(matches)} question markers in text")

        batches = []
        for i in range(0, len(matches), batch_size):
            start_idx = matches[i].start()
            end_idx = matches[min(i + batch_size, len(matches)) - 1].start() if i + batch_size < len(matches) else len(full_text)

            # If not the last batch, extend to the start of the next batch
            if i + batch_size < len(matches):
                end_idx = matches[i + batch_size].start()

            batch_text = full_text[start_idx:end_idx].strip()
            if batch_text:
                batches.append(batch_text)

        return batches
    else:
        # Fallback: split by character count (roughly 4000 chars per batch)
        print("  No clear question patterns found, splitting by size")
        chunk_size = 4000
        batches = []
        for i in range(0, len(full_text), chunk_size):
            batch = full_text[i:i + chunk_size].strip()
            if batch:
                batches.append(batch)
        return batches


# ──────────────────────────────────────────────
# SECTION DETECTION & RENUMBERING
# ──────────────────────────────────────────────
def renumber_questions_globally(
    all_questions: list[dict],
    questions_text: str
) -> list[dict]:
    """
    Renumber questions from per-section numbering (1-45, 1-45, 1-90)
    to global sequential numbering (1-180).

    Strategy: Detect section boundaries by looking for question number
    resets in the sequential output (e.g., Q45 followed by Q1 means a
    new section started). Uses NEET standard layout:
      - Section 1 (Physics):   local 1-45  → global 1-45
      - Section 2 (Chemistry): local 1-45  → global 46-90
      - Section 3 (Biology):   local 1-90  → global 91-180
    """
    if not all_questions:
        return all_questions

    # Standard NEET section layout
    SECTION_CONFIG = [
        {"name": "Physics",   "id": "2P0", "offset": 0},
        {"name": "Chemistry", "id": "3C0", "offset": 45},
        {"name": "Biology",   "id": "1B0", "offset": 90},
    ]

    # Detect section boundaries by finding where question numbers reset
    section_starts = [0]  # First section always starts at index 0
    for i in range(1, len(all_questions)):
        prev_num = all_questions[i - 1]["questionNumber"]
        curr_num = all_questions[i]["questionNumber"]
        # A reset: current number is much smaller than previous
        # (e.g., going from 45 to 1, or from 90 to 1)
        if curr_num < prev_num and (prev_num - curr_num) > 10:
            section_starts.append(i)

    num_sections = len(section_starts)
    print(f"  [RENUMBER] Detected {num_sections} section(s) via number resets at indices {section_starts}")

    if num_sections == 1:
        # No resets found — questions might already be globally numbered
        # Check if max question number > 90 (already global)
        max_qn = max(q["questionNumber"] for q in all_questions)
        if max_qn > 90:
            print(f"  [RENUMBER] Max question number is {max_qn}, appears already global")
            return all_questions
        else:
            print(f"  [RENUMBER] Only 1 section detected, no renumbering needed")
            return all_questions

    # Apply offsets to each section
    for sec_idx in range(num_sections):
        start = section_starts[sec_idx]
        end = section_starts[sec_idx + 1] if sec_idx + 1 < num_sections else len(all_questions)

        if sec_idx < len(SECTION_CONFIG):
            config = SECTION_CONFIG[sec_idx]
        else:
            config = {"name": f"Section {sec_idx + 1}", "id": "GEN", "offset": 0}

        offset = config["offset"]
        section_id = config["id"]
        section_name = config["name"]
        count = end - start

        print(f"  [RENUMBER] Section {sec_idx + 1} ({section_name}): questions[{start}:{end}] ({count} questions), offset={offset}")

        for i in range(start, end):
            q = all_questions[i]
            original_num = q["questionNumber"]
            q["questionNumber"] = original_num + offset
            q["sectionId"] = section_id

    return all_questions


# ──────────────────────────────────────────────
# OPENAI API PARSING
# ──────────────────────────────────────────────
def parse_batch_with_ai(client: OpenAI, batch_text: str) -> list[dict]:
    """Send a batch of raw questions to OpenAI and get structured JSON back.
    No answer key is sent — answers are injected post-parsing."""

    user_content = f"RAW QUESTIONS:\n{batch_text}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.0,
        max_tokens=8192,
    )

    raw_response = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw_response.startswith("```"):
        lines = raw_response.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        raw_response = "\n".join(lines)

    parsed = json.loads(raw_response)

    # Handle case where AI returns {"questions": [...]} instead of [...]
    if isinstance(parsed, dict) and "questions" in parsed:
        parsed = parsed["questions"]

    return parsed


def parse_pages_with_hybrid_vision(
    client: OpenAI,
    pdf_path: str,
    questions_text: str,
    dry_run: bool = False,
) -> list[dict]:
    """
    Parse a normal (non-scanned) PDF using hybrid vision+text mode.
    For each page that contains questions, sends BOTH the rendered page image
    AND the extracted text to GPT-4.1-mini. This allows the model to read
    inline formula images (vectors, equations, etc.) that PyMuPDF misses.
    """
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    all_questions = []
    page_images: dict[int, bytes] = {}  # Store page images for option-figure cropping

    # Detect which pages have question content by checking for question numbers
    # Broadened pattern: matches "1.", "1)", "Q1", "Q.1", "1]", "1:", or just standalone numbers at line start
    q_pattern = re.compile(r'(?:^|\n)\s*(?:#{1,3}\s*)?(?:Q\.?\s*)?\d{1,3}\s*[.)\]:\s]', re.MULTILINE)

    # Also detect answer key pages to skip them
    # IMPORTANT: These patterns must be STRICT (standalone headings only)
    # to avoid false positives on question text like "Choose the correct answer"
    answer_key_patterns = [
        re.compile(r'(?:^|\n)\s*ANSWER\s+KEYS?\s*(?:\n|$)', re.IGNORECASE),
        re.compile(r'(?:^|\n)\s*CORRECT\s+ANSWERS?\s*(?:\n|$)', re.IGNORECASE),
        re.compile(r'(?:^|\n)\s*ANSWERS?\s+AND\s+SOLUTIONS?\s*(?:\n|$)', re.IGNORECASE),
    ]

    # Extract per-page text for filtering and as context
    page_texts: dict[int, str] = {}
    question_pages: list[int] = []

    for page_num in range(page_count):
        page = doc[page_num]
        text = page.get_text("text")
        page_texts[page_num] = text

        # Skip pages that are ONLY answer keys:
        # Must match a heading pattern AND page must be mostly answer-key-like
        # (short lines with number-answer pairs, not full question text)
        is_answer_key = any(p.search(text) for p in answer_key_patterns)
        if is_answer_key:
            # Verify it's a real answer key page, not a question page with
            # "Choose the correct answer" in the question text.
            # Real answer key pages have many short lines like "1. (2)" or "Q. / A." blocks
            # or split-line format: "46.\n(2)\n47.\n(2)" where number and answer are separate
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            ak_line_pattern = re.compile(r'^\d{1,3}\.?\s*\(?[1-4ABCD]\)?\s*$')
            # Also match standalone answer values like "(2)" or "(A)" on their own line
            ak_answer_only = re.compile(r'^\(?[1-4ABCD]\)$')
            # And standalone question numbers like "46." on their own line
            ak_qnum_only = re.compile(r'^\d{1,3}\.\s*$')
            ak_lines = sum(1 for l in lines if ak_line_pattern.match(l) or ak_answer_only.match(l) or ak_qnum_only.match(l))
            # If >30% of non-empty lines are answer-key lines, it's truly an AK page
            if len(lines) > 0 and ak_lines / len(lines) > 0.3:
                continue

        # Check if this page has question markers
        if q_pattern.search(text) and len(text.strip()) > 100:
            question_pages.append(page_num)

    print(f"  [HYBRID] {len(question_pages)} pages contain questions (out of {page_count} total)")

    if not question_pages:
        print("  [HYBRID] No question pages detected, falling back to text-only batch parsing")
        doc.close()
        return None  # Signal caller to fall back

    for idx, page_num in enumerate(question_pages):
        page = doc[page_num]

        # Render page at 200 DPI
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pixmap = page.get_pixmap(matrix=mat)
        img_bytes = pixmap.tobytes("png")
        page_images[page_num] = img_bytes  # Store for option-figure cropping
        b64_image = base64.b64encode(img_bytes).decode("utf-8")

        page_text = page_texts.get(page_num, "")

        print(f"  [HYBRID] Page {page_num + 1} ({idx + 1}/{len(question_pages)})...", end=" ", flush=True)

        try:
            response = client.chat.completions.create(
                model=VISION_MODEL,
                messages=[
                    {"role": "system", "content": HYBRID_VISION_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"Parse all questions from this exam page. Here is the extracted text (may have missing formulas):\n\n{page_text}"
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64_image}",
                                    "detail": "high"
                                }
                            }
                        ]
                    }
                ],
                temperature=0.0,
                max_tokens=16384,
            )

            raw_response = response.choices[0].message.content.strip()

            # Strip markdown code fences if present
            if raw_response.startswith("```"):
                lines = raw_response.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw_response = "\n".join(lines)

            parsed = json.loads(raw_response)
            if isinstance(parsed, dict) and "questions" in parsed:
                parsed = parsed["questions"]

            # Tag questions with source page (for image extraction later)
            for q in parsed:
                q["_source_page"] = page_num

            all_questions.extend(parsed)
            print(f"OK ({len(parsed)} questions)")

        except json.JSONDecodeError as e:
            print(f"PARSE ERROR: {e}")
        except Exception as e:
            print(f"API ERROR: {e}")

        if idx < len(question_pages) - 1:
            time.sleep(RATE_LIMIT_DELAY)

    doc.close()

    # ── CROSS-PAGE MERGE: Stitch questions that span page breaks ──
    # When a question spans two pages, the AI produces two entries with the
    # same questionNumber. Merge them: combine text, keep options from the
    # LATER entry (which typically has the actual answer choices).
    if all_questions:
        merged: list[dict] = []

        for q in all_questions:
            q_num = q.get("questionNumber")
            
            # Cross-page merge only if:
            # 1. It's a CONSECUTIVE question with the same number
            # 2. The pages are adjacent (true cross-page split) or same page
            # 3. The new entry looks like a continuation, NOT a completely new question
            #    (e.g., the new entry has NO options or very short text — it's a continuation)
            if len(merged) > 0 and merged[-1].get("questionNumber") == q_num:
                existing = merged[-1]
                existing_text = existing.get("text", "")
                new_text = q.get("text", "")
                
                # Check if pages are adjacent (true cross-page split)
                existing_page = existing.get("_source_page", -1)
                new_page = q.get("_source_page", -1)
                pages_adjacent = (new_page - existing_page) <= 1
                
                # Check if this looks like a CONTINUATION vs a NEW question from a different section
                # A continuation typically has:
                # - Adjacent pages
                # - The new entry has incomplete options OR very short text
                # - The first few words overlap (same question)
                # A NEW question from a different section typically has:
                # - Completely different text
                # - Full 4 options with different content
                existing_first_words = " ".join(existing_text.split()[:5]).lower()
                new_first_words = " ".join(new_text.split()[:5]).lower()
                
                new_options = q.get("options", [])
                new_has_full_options = len(new_options) == 4 and all(o.get("text", "").strip() for o in new_options)
                
                # If pages are NOT adjacent, do NOT merge (different sections)
                if not pages_adjacent:
                    merged.append(q)
                    continue
                
                # If both have full 4 options with completely different text, it MIGHT be
                # two different questions from different sections (e.g., Physics Q4 and Chemistry Q4).
                # BUT: section boundaries only happen when numbering RESTARTS (Q1, Q2, etc.)
                # If we see Q20 → Q20 on adjacent pages, that's a cross-page split, not a section boundary.
                existing_options = existing.get("options", [])
                existing_has_full_options = len(existing_options) == 4 and all(o.get("text", "").strip() for o in existing_options)
                
                # Only consider skipping if q_num is low enough to be a section restart (≤5)
                # AND both entries are completely different questions
                is_possible_section_restart = q_num <= 5
                
                if is_possible_section_restart and existing_has_full_options and new_has_full_options and existing_first_words != new_first_words:
                    # Low question number + full options + different text → likely section boundary
                    merged.append(q)
                    print(f"  [MERGE] Q{q_num}: SKIPPED merge (different question, likely new section)")
                    continue

                # Genuine cross-page split — merge them
                if new_text and new_text not in existing_text:
                    existing["text"] = existing_text.rstrip() + "\n\n" + new_text.lstrip()

                # Use options from whichever entry has actual answer options
                if new_options and len(new_options) == 4:
                    existing_opt_text = " ".join(o.get("text", "") for o in existing_options)
                    new_opt_text = " ".join(o.get("text", "") for o in new_options)
                    if not existing_options or len(existing_options) != 4 or new_opt_text != existing_opt_text:
                        existing["options"] = new_options

                # Keep imageUrl from whichever has one
                if q.get("imageUrl") and not existing.get("imageUrl"):
                    existing["imageUrl"] = q["imageUrl"]

                print(f"  [MERGE] Q{q_num}: merged cross-page split")
            else:
                merged.append(q)

        if len(merged) < len(all_questions):
            print(f"  [MERGE] Merged {len(all_questions) - len(merged)} cross-page splits ({len(all_questions)} -> {len(merged)} questions)")
        all_questions = merged

    # ── GAP DETECTION + RETRY: Find missing question numbers and re-parse ──
    # After initial parsing and merging, detect which question numbers are missing
    # within each section. For each missing question, find the page it should be on
    # and re-parse that page with a focused prompt for ONLY the missing questions.
    if all_questions and page_images:
        # 1. Detect sections by finding question number resets
        sections: list[list[dict]] = [[]]
        for i, q in enumerate(all_questions):
            if i > 0:
                prev_num = all_questions[i - 1].get("questionNumber", 0)
                curr_num = q.get("questionNumber", 0)
                if curr_num < prev_num and (prev_num - curr_num) > 10:
                    sections.append([])
            sections[-1].append(q)

        total_missing = []
        for sec_idx, section_qs in enumerate(sections):
            if not section_qs:
                continue
            nums = [q["questionNumber"] for q in section_qs]
            max_num = max(nums)
            present = set(nums)
            missing = [n for n in range(1, max_num + 1) if n not in present]

            if not missing:
                continue

            sec_name = f"Section {sec_idx + 1}"
            print(f"  [GAP] {sec_name}: Found {len(missing)} missing question(s): {missing}")

            # 2. For each missing question, find the page where it should be
            #    by looking at which pages surround the missing number
            for mq_num in missing:
                # Find the questions that bracket this missing number
                before_page = None
                after_page = None
                for q in section_qs:
                    if q["questionNumber"] < mq_num:
                        before_page = q.get("_source_page")
                    elif q["questionNumber"] > mq_num and after_page is None:
                        after_page = q.get("_source_page")

                # The missing question is likely on the page of the question before it,
                # or between before_page and after_page
                candidate_pages = set()
                if before_page is not None:
                    candidate_pages.add(before_page)
                if after_page is not None:
                    candidate_pages.add(after_page)
                # Also check the page between them
                if before_page is not None and after_page is not None:
                    for p in range(before_page, after_page + 1):
                        if p in page_images:
                            candidate_pages.add(p)

                total_missing.append((mq_num, candidate_pages))

        if total_missing:
            print(f"\n  [GAP] Total missing: {len(total_missing)} questions. Retrying targeted parsing...")

            # Group missing questions by candidate pages to minimize API calls
            pages_to_retry: dict[int, list[int]] = {}
            for mq_num, cand_pages in total_missing:
                for p in cand_pages:
                    if p not in pages_to_retry:
                        pages_to_retry[p] = []
                    pages_to_retry[p].append(mq_num)

            RETRY_PROMPT = """You are a NEET exam question parser. You are re-examining a page to find SPECIFIC questions that were missed in the first pass.

I need you to find ONLY the following question numbers on this page: {missing_nums}

For each question you find, extract:
- questionNumber (integer)
- text (complete question text, use the page image for any formulas/symbols)
- options (array of 4 options with ids A, B, C, D)
- correctOptionId: set to "A" as placeholder
- explanation: null
- imageUrl: null
- hasOptionImages: true if options are figures/images, false otherwise
- sectionId: null
- chapterBinaryCode: null

FORMAT RULES:
- Use Unicode superscripts for powers (x², 10⁻³)
- Use Unicode subscripts for chemistry (H₂O, Ca²⁺)
- Insert \\n\\n between statements in multi-statement questions
- If options are figures/diagrams, set hasOptionImages=true and option text to ""

Return ONLY a JSON array. No markdown, no code fences.
If a question number is NOT on this page, simply don't include it."""

            retry_found = 0
            already_found_nums = set()

            for page_num in sorted(pages_to_retry.keys()):
                missing_on_page = [n for n in pages_to_retry[page_num] if n not in already_found_nums]
                if not missing_on_page:
                    continue

                if page_num not in page_images:
                    continue

                b64_img = base64.b64encode(page_images[page_num]).decode("utf-8")
                page_text = page_texts.get(page_num, "")
                missing_str = ", ".join(str(n) for n in missing_on_page)

                print(f"    [RETRY] Page {page_num + 1} looking for Q{missing_str}...", end=" ", flush=True)

                try:
                    response = client.chat.completions.create(
                        model=VISION_MODEL,
                        messages=[
                            {"role": "system", "content": RETRY_PROMPT.format(missing_nums=missing_str)},
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": f"Find questions {missing_str} on this page. Here is extracted text:\n\n{page_text}"
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/png;base64,{b64_img}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        temperature=0.0,
                        max_tokens=16384,
                    )

                    raw_resp = response.choices[0].message.content.strip()
                    if raw_resp.startswith("```"):
                        lines = raw_resp.split("\n")
                        lines = [l for l in lines if not l.strip().startswith("```")]
                        raw_resp = "\n".join(lines)

                    parsed = json.loads(raw_resp)
                    if isinstance(parsed, dict) and "questions" in parsed:
                        parsed = parsed["questions"]

                    # Only add questions that were actually missing
                    for q in parsed:
                        q["_source_page"] = page_num
                        q_num = q.get("questionNumber")
                        if q_num in [m for m, _ in total_missing] and q_num not in already_found_nums:
                            all_questions.append(q)
                            already_found_nums.add(q_num)
                            retry_found += 1

                    found_on_page = [q["questionNumber"] for q in parsed if q.get("questionNumber") in [m for m, _ in total_missing]]
                    print(f"Found {len(found_on_page)}: {found_on_page if found_on_page else 'none'}")

                except json.JSONDecodeError as e:
                    print(f"PARSE ERROR: {e}")
                except Exception as e:
                    print(f"API ERROR: {e}")

                time.sleep(RATE_LIMIT_DELAY)

            print(f"  [GAP] Retry recovered {retry_found} missing questions. Total now: {len(all_questions)}")
        else:
            print(f"  [GAP] No missing questions detected. All question numbers are sequential.")

    # ── VALIDATE hasOptionImages: Auto-correct false positives ──
    # The AI sometimes incorrectly sets hasOptionImages=true when options are clearly text.
    # If any option has meaningful text (>3 chars), it's NOT a figure-based option.
    corrected_count = 0
    for q in all_questions:
        if q.get("hasOptionImages"):
            options = q.get("options", [])
            text_options = [o for o in options if len(o.get("text", "").strip()) > 3]
            if text_options:
                # Options have real text — this is NOT a figure-based question
                q["hasOptionImages"] = False
                corrected_count += 1
    if corrected_count:
        print(f"  [VALIDATE] Corrected {corrected_count} questions falsely flagged as hasOptionImages=true")

    # ── OPTION-FIGURE CROPPING (hybrid): Crop per-option images for figure-based options ──
    questions_with_option_images = [q for q in all_questions if q.get("hasOptionImages")]
    if questions_with_option_images and page_images:
        from PIL import Image
        import io

        print(f"  [HYBRID-OPT] {len(questions_with_option_images)} questions have figure-based options")
        print(f"  [HYBRID-OPT] Extracting per-option figure bounding boxes...")

        OPTION_FIGURES_BBOX_PROMPT_HV = """You are looking at an exam page. Question {q_num} has 4 options that are FIGURES/DIAGRAMS/GRAPHS (not text). Find the bounding box of EACH option figure separately.

The options are typically labeled (1), (2), (3), (4) or (A), (B), (C), (D) and each has its own separate diagram/graph/figure.

Return a JSON object with bounding boxes for all 4 options as percentages of page dimensions (0-100):
{{
  "A": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "B": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "C": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "D": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}}
}}

Include JUST the drawn figure/diagram for each option, including any labels directly below/beside the figure. Do NOT include the option number label itself.

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text. If you cannot find all 4 option figures, return {{"error": true}}."""

        for idx, q in enumerate(questions_with_option_images):
            source_page = q.get("_source_page", 0)
            q_num = q["questionNumber"]

            if source_page not in page_images:
                print(f"    Q{q_num}: no page image available, skipping")
                continue

            b64_img = base64.b64encode(page_images[source_page]).decode("utf-8")
            print(f"    Q{q_num} option figures (page {source_page + 1})...", end=" ", flush=True)

            try:
                resp = client.chat.completions.create(
                    model=VISION_MODEL,
                    messages=[
                        {"role": "system", "content": OPTION_FIGURES_BBOX_PROMPT_HV.format(q_num=q_num)},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Find all 4 option figures for Question {q_num} on this page."},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_img}", "detail": "high"}}
                            ]
                        }
                    ],
                    temperature=0.0,
                    max_tokens=512,
                )

                raw = resp.choices[0].message.content.strip()
                if raw.startswith("```"):
                    lines = raw.split("\n")
                    lines = [l for l in lines if not l.strip().startswith("```")]
                    raw = "\n".join(lines)

                bboxes = json.loads(raw)

                if bboxes.get("error"):
                    print("could not find option figures")
                    continue

                pil_img = Image.open(io.BytesIO(page_images[source_page]))
                w, h = pil_img.size
                cropped_count = 0

                for opt_id in ["A", "B", "C", "D"]:
                    if opt_id not in bboxes:
                        continue

                    bbox = bboxes[opt_id]
                    left = max(0, int(w * bbox["leftPercent"] / 100) - 5)
                    top = max(0, int(h * bbox["topPercent"] / 100) - 5)
                    right = min(w, int(w * bbox["rightPercent"] / 100) + 5)
                    bottom = min(h, int(h * bbox["bottomPercent"] / 100) + 5)

                    cropped = pil_img.crop((left, top, right, bottom))
                    buf = io.BytesIO()
                    cropped.save(buf, format="PNG")
                    opt_img_bytes = buf.getvalue()

                    opt_obj = next((o for o in q.get("options", []) if o["id"] == opt_id), None)
                    if not opt_obj:
                        continue

                    # For hybrid mode, save locally (images are uploaded later by map_images_to_questions flow)
                    img_dir = pdf_path.rsplit(".", 1)[0] + "_option_images"
                    os.makedirs(img_dir, exist_ok=True)
                    local_path = os.path.join(img_dir, f"q{q_num}_opt{opt_id}.png")
                    with open(local_path, "wb") as f:
                        f.write(opt_img_bytes)
                    opt_obj["_local_image_path"] = local_path
                    cropped_count += 1

                print(f"OK ({cropped_count}/4 options cropped)")

            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(RATE_LIMIT_DELAY)

        opt_img_count = sum(1 for q in all_questions if q.get("hasOptionImages"))
        print(f"  [HYBRID-OPT] {opt_img_count} questions flagged with figure-based options")

    # Upload full page images for dataset training
    uploaded_page_urls = {}
    if not dry_run and FIREBASE_STORAGE_BUCKET:
        from PIL import Image
        import io
        print("  [HYBRID] Uploading full page images for Golden Dataset...")
        safe_source = re.sub(r'[^\w\-]', '_', pdf_path.split('/')[-1])
        try:
            init_firestore()
            bucket = fb_storage.bucket()
            for pg in question_pages:
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
                    uploaded_page_urls[pg] = blob.public_url
                    print(f"    Uploaded page {pg + 1}")
                except Exception as e:
                    print(f"    Failed to upload page {pg + 1}: {e}")
        except Exception as e:
            print(f"    Failed to access bucket: {e}")

    # ── FIGURE CROPPING: Use GPT to detect and crop figures for questions with hasImage ──
    questions_with_images = [q for q in all_questions if q.get("hasImage")]
    if questions_with_images:
        from PIL import Image
        import io

        print(f"  [FIGURE] {len(questions_with_images)} questions have figures, cropping...")

        FIGURE_BBOX_PROMPT = """You are looking at an exam page. I need you to find the figure/diagram/graph associated with Question {q_num}.

Return the EXACT bounding box of JUST the figure/diagram (NOT the question text, NOT the options, ONLY the drawn figure/graph/diagram itself).

Return a JSON object with these 4 values as percentages of the page dimensions:
- leftPercent: distance from left edge (0-100)
- topPercent: distance from top edge (0-100)  
- rightPercent: distance from left edge to the right side of figure (0-100)
- bottomPercent: distance from top edge to the bottom of figure (0-100)

Example: {{"leftPercent": 5, "topPercent": 35, "rightPercent": 45, "bottomPercent": 60}}

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text. If no figure is found, return {{"error": true}}."""

        safe_source = re.sub(r'[^\w\-]', '_', os.path.splitext(os.path.basename(pdf_path))[0])

        for idx, q in enumerate(questions_with_images):
            source_page = q.get("_source_page", 0)
            q_num = q["questionNumber"]

            if source_page not in page_images:
                continue

            b64_img = base64.b64encode(page_images[source_page]).decode("utf-8")
            print(f"    Q{q_num} (page {source_page + 1})...", end=" ", flush=True)

            try:
                resp = client.chat.completions.create(
                    model=VISION_MODEL,
                    messages=[
                        {"role": "system", "content": FIGURE_BBOX_PROMPT.format(q_num=q_num)},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Find the figure for Question {q_num} on this page."},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_img}", "detail": "high"}}
                            ]
                        }
                    ],
                    temperature=0.0,
                    max_tokens=256,
                )

                raw = resp.choices[0].message.content.strip()
                if raw.startswith("```"):
                    lines_raw = raw.split("\n")
                    lines_raw = [l for l in lines_raw if not l.strip().startswith("```")]
                    raw = "\n".join(lines_raw)

                bbox = json.loads(raw)

                if bbox.get("error"):
                    print("no figure found")
                    continue

                # Crop the page image to the bounding box
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

                # Upload or save
                if not dry_run and FIREBASE_STORAGE_BUCKET:
                    try:
                        init_firestore()
                        bucket = fb_storage.bucket()
                        blob_path = f"question-images/{safe_source}/q{q_num}_fig.png"
                        blob = bucket.blob(blob_path)
                        blob.upload_from_string(img_to_upload, content_type="image/png")
                        blob.make_public()
                        q["imageUrl"] = blob.public_url
                        print("-> uploaded")
                    except Exception as e:
                        # Fallback: save locally if Firebase fails
                        img_dir = pdf_path.rsplit(".", 1)[0] + "_images"
                        os.makedirs(img_dir, exist_ok=True)
                        local_path = os.path.join(img_dir, f"q{q_num}_fig.png")
                        with open(local_path, "wb") as f_img:
                            f_img.write(img_to_upload)
                        q["imageUrl"] = local_path
                        print(f"-> saved locally (Firebase: {e})")
                else:
                    img_dir = pdf_path.rsplit(".", 1)[0] + "_images"
                    os.makedirs(img_dir, exist_ok=True)
                    local_path = os.path.join(img_dir, f"q{q_num}_fig.png")
                    with open(local_path, "wb") as f_img:
                        f_img.write(img_to_upload)
                    q["imageUrl"] = local_path
                    print("-> saved locally")

                # Store figure training metadata on the question
                q["_figure_training"] = {
                    "source_page_url": uploaded_page_urls.get(source_page),
                    "source_page_number": source_page + 1,
                    "ai_crop_bbox": {"left": left, "top": top, "right": right, "bottom": bottom},
                    "page_width": w,
                    "page_height": h,
                    "ai_figure_url": q.get("imageUrl"),
                    "human_crop_bbox": None,
                    "human_figure_url": None,
                    "correction_type": "none",
                }

            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(RATE_LIMIT_DELAY)

        img_count = sum(1 for q in all_questions if q.get("imageUrl"))
        print(f"  [FIGURE] {img_count} questions now have cropped figure images")

    # Attach page data and clean up internal fields
    for q in all_questions:
        pg = q.get("_source_page")
        if pg is not None:
            if pg in uploaded_page_urls:
                q["_page_image_url"] = uploaded_page_urls[pg]
            if pg in page_texts:
                q["_extracted_page_text"] = page_texts[pg].strip()
        
        q.pop("_source_page", None)
        q.pop("hasImage", None)
        # We KEEP hasOptionImages for the golden dataset

    return all_questions


# ──────────────────────────────────────────────
# GPT-4V ANSWER KEY EXTRACTION (for scanned PDFs)
# ──────────────────────────────────────────────
import base64

ANSWER_KEY_VISION_PROMPT = """You are looking at pages from a NEET exam paper that contain the ANSWER KEY.
The answer key may be in a table, grid, or list format showing question numbers with their correct answers.

Extract ALL question-answer mappings from this image.
Answers are typically: (1), (2), (3), (4) or (A), (B), (C), (D) or just 1, 2, 3, 4.
Map them: 1 or A = "A", 2 or B = "B", 3 or C = "C", 4 or D = "D".

Return ONLY a JSON object mapping question number to answer letter:
{"1": "A", "2": "B", "3": "C", ...}

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text."""


def extract_answer_key_with_vision(client: OpenAI, pdf_path: str) -> dict[int, str]:
    """
    Extract answer key from a scanned PDF using GPT-4 Vision.
    Sends the last few pages (where answer keys typically are) to GPT-4V.
    Returns {question_number: answer_letter}.
    """
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    all_answers: dict[int, str] = {}

    # Answer keys are usually in the last 1-3 pages
    # Send last 3 pages to GPT-4V
    start_page = max(0, page_count - 3)

    print(f"  [VISION-AK] Scanning last {page_count - start_page} pages for answer key...")

    for page_num in range(start_page, page_count):
        page = doc[page_num]
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        b64_image = base64.b64encode(img_bytes).decode("utf-8")

        print(f"  [VISION-AK] Reading page {page_num + 1}...", end=" ", flush=True)

        try:
            response = client.chat.completions.create(
                model=VISION_MODEL,
                messages=[
                    {"role": "system", "content": ANSWER_KEY_VISION_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Extract all question-answer mappings from this answer key page."},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_image}", "detail": "high"}}
                        ]
                    }
                ],
                temperature=0.0,
                max_tokens=4096,
            )

            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                lines = raw.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw = "\n".join(lines)

            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    try:
                        q_num = int(k)
                        answer = str(v).upper().strip()
                        # Normalize: 1->A, 2->B, 3->C, 4->D
                        num_to_letter = {"1": "A", "2": "B", "3": "C", "4": "D"}
                        answer = num_to_letter.get(answer, answer)
                        if answer in ("A", "B", "C", "D"):
                            all_answers[q_num] = answer
                    except ValueError:
                        pass
                print(f"OK ({len(parsed)} answers)")
            else:
                print(f"unexpected format")

        except json.JSONDecodeError as e:
            print(f"PARSE ERROR: {e}")
        except Exception as e:
            print(f"API ERROR: {e}")

        time.sleep(RATE_LIMIT_DELAY)

    doc.close()
    print(f"  [VISION-AK] Total: {len(all_answers)} answers extracted")
    return all_answers


# ──────────────────────────────────────────────
# SCANNED PDF VISION PARSER
# ──────────────────────────────────────────────
import base64

VISION_SYSTEM_PROMPT = """You are a NEET exam question parser. You will receive an IMAGE of a scanned exam page.

RULES:
1. Read ALL questions visible on this page. Each question starts with a number (e.g. "1.", "1)", "Q1", etc.).
2. For each question, extract: question number, question text, and all 4 options.
3. Options MUST have ids "A", "B", "C", "D" -- map the FIRST option to "A", second to "B", third to "C", fourth to "D".
4. Set correctOptionId to "A" as a placeholder.
5. Clean up any OCR artifacts or formatting issues.
6. If a question contains or references a figure/diagram/graph/image, set hasImage to true AND provide figureTopPercent and figureBottomPercent indicating where the figure is located on the page as a percentage from top (0) to bottom (100). For example, if the figure starts at 30% from the top and ends at 50%, set figureTopPercent=30 and figureBottomPercent=50.
7. If a question spans across pages (i.e., it starts on this page but is clearly cut off), still include it with whatever text is visible.
8. Set explanation to null, sectionId to null, chapterBinaryCode to null.
9. If this page shows ONLY an answer key (table of question numbers and answers), return an empty array [].
10. Format all mathematical powers and exponents using true Unicode superscripts instead of caret notation (e.g., "a³ b²" instead of "a^3 b^2", "10⁻³" instead of "10^-3"). Wait to convert roots too (e.g. use √). Do NOT use caret notation.
11. Format Chemistry ions, formulas, and coordination compounds using proper Unicode superscripts and subscripts (e.g., "Ca²⁺", "Cl⁻", "SO₄²⁻", "H₂O", "PO₄³⁻", "[Co(NH₃)₃Cl₃]"). DO NOT use formats like Co2+, SO42-, or [Co(NH3)3Cl3].
12. Format scientific units with proper Unicode superscripts (e.g., "mol L⁻¹", "S cm² mol⁻¹", "J K⁻¹ mol⁻¹"). DO NOT use formats like "mol L-1" or "cm2 mol-1".
13. Ensure Greek letters have proper subscripts/superscripts if needed (e.g., use "Λₘ" instead of "Λm", "Λ₊°" instead of "Λ+°", "Λ₋°" instead of "Λ-°").
14. EXTREMELY IMPORTANT for "Match List..." or "Match the Column" questions: You MUST manually insert double newlines (`\n\n`) before AND after `List I` and `List II` headings to force paragraph breaks. Do NOT dump them inline. Example format strictly required: "Match List I with List II\n\n**List I:**\nA. Humidity\nB. Alloys\n\n**List II:**\nI. Solid in gas\nII. Liquid in solid\n\nChoose the correct answer..."
15. Format mathematical and physical variables with subscripts using Unicode subscripts. Do NOT write them inline. For example, write "Eₙ" instead of "En" or "E_n", write "rₙ" instead of "rn", write "v₀" instead of "v0", and write "Kₐ₁", "Kₐ₂", "Kₐ₃" instead of "Ka1", "Ka2", "Ka3", and "pKₐ" instead of "pKa".
16. CAUTION for "Multiple Statement" or "Choose the correct answer" type questions: If a question has statements labeled A, B, C, D, E, F, you MUST extract and include the full text of those statements in the `text` field. DO NOT skip or omit the statements. The `options` array MUST contain only the final 4 choices (e.g., "A and C only", "B, D, F only"). The statements themselves (A, B, C, D, E, F) should be kept clearly formatted within the `text` field.
17. EXTREMELY IMPORTANT for "Statement I / Statement II", "Assertion / Reason", or lists of statements labeled A., B., C., D., E.: You MUST manually insert double newlines (`\n\n`) to force paragraph spacing between each and every statement. NEVER let them run together. Example format strictly required: "Given below are two statements:\n\n**Statement I:** In a floral formula...\n\n**Statement II:** In a floral formula...\n\nIn the light of the above..."
18. NEVER split a single numbered question into multiple questions. All text, statements, formulas, and tables that appear between one question number (e.g., "53.") and the next question number (e.g., "54.") belong to the SAME single question object. If a question has 5 statements and 4 options, it is still ONLY ONE question.
19. FIGURE-BASED OPTIONS: If the options for a question are FIGURES, DIAGRAMS, GRAPHS, CIRCUITS, or IMAGES instead of text, set `hasOptionImages` to true and set each option's `text` to an empty string "". Do NOT write descriptions like "image not provided" or "Option 1 (image)". Just set text to "".

OUTPUT FORMAT -- Return ONLY a JSON array of objects, nothing else:
[
  {
    "questionNumber": <integer>,
    "text": "<clean question text>",
    "options": [
      {"id": "A", "text": "<option text or empty string if figure>"},
      {"id": "B", "text": "<option text or empty string if figure>"},
      {"id": "C", "text": "<option text or empty string if figure>"},
      {"id": "D", "text": "<option text or empty string if figure>"}
    ],
    "correctOptionId": "A",
    "explanation": null,
    "hasImage": false,
    "hasOptionImages": false,
    "figureTopPercent": null,
    "figureBottomPercent": null,
    "imageUrl": null,
    "sectionId": null,
    "chapterBinaryCode": null
  }
]

Parse EVERY question on the page. Return [] if no valid questions are found or if this is an answer key page.
CRITICAL: Return ONLY the JSON array. No markdown, no code fences, no extra text."""


def parse_scanned_pages_with_vision(
    client: OpenAI,
    pdf_path: str,
    source_paper: str,
    dry_run: bool = False,
) -> list[dict]:
    """
    Parse a scanned PDF by sending page images directly to GPT-4 Vision.
    GPT-4V can both read the text AND see figures/diagrams.
    For questions with figures, cropped page regions are uploaded as question images.
    """
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    all_questions = []

    # Also prepare for image uploads
    page_images: dict[int, bytes] = {}  # page_num -> png bytes

    print(f"  [VISION] Parsing {page_count} pages with GPT-4 Vision...")

    for page_num in range(page_count):
        page = doc[page_num]

        # Render page at 200 DPI (good balance of quality vs size)
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
                    {"role": "system", "content": VISION_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Parse all questions from this exam page image."
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64_image}",
                                    "detail": "high"
                                }
                            }
                        ]
                    }
                ],
                temperature=0.0,
                max_tokens=8192,
            )

            raw_response = response.choices[0].message.content.strip()

            # Strip markdown code fences if present
            if raw_response.startswith("```"):
                lines = raw_response.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw_response = "\n".join(lines)

            parsed = json.loads(raw_response)
            if isinstance(parsed, dict) and "questions" in parsed:
                parsed = parsed["questions"]

            # Tag questions with which page they came from (for image cropping later)
            for q in parsed:
                q["_source_page"] = page_num

            all_questions.extend(parsed)
            print(f"OK ({len(parsed)} questions)")

        except json.JSONDecodeError as e:
            print(f"PARSE ERROR: {e}")
        except Exception as e:
            print(f"API ERROR: {e}")

        if page_num < page_count - 1:
            time.sleep(RATE_LIMIT_DELAY)

    doc.close()

    # Now handle images for questions that reference figures
    # 2nd-pass: dedicated GPT-4V call per figure for precise bounding box
    questions_with_images = [q for q in all_questions if q.get("hasImage")]
    if questions_with_images:
        from PIL import Image
        import io

        print(f"  [VISION] {len(questions_with_images)} questions reference figures")
        print(f"  [VISION] Extracting precise figure bounding boxes (2nd pass)...")

        safe_source = re.sub(r'[^\w\-]', '_', source_paper)

        # Upload full page images (for future re-cropping in Review UI)
        # Track which pages we've already uploaded
        uploaded_page_urls = {}  # page_num -> public_url
        if not dry_run and FIREBASE_STORAGE_BUCKET:
            pages_needed = set(q.get("_source_page", 0) for q in questions_with_images)
            init_firestore()
            bucket = fb_storage.bucket()
            for pg in pages_needed:
                if pg in page_images:
                    try:
                        # Compress the full page image so it loads quickly in the Review UI crop editor
                        pil_img = Image.open(io.BytesIO(page_images[pg]))
                        if pil_img.mode in ("RGBA", "P"):
                            pil_img = pil_img.convert("RGB")
                        
                        buf = io.BytesIO()
                        # Save as JPEG with 70% quality to massively reduce size from ~5MB to ~200KB
                        pil_img.save(buf, format="JPEG", quality=70, optimize=True)
                        compressed_bytes = buf.getvalue()

                        blob_path = f"question-images/{safe_source}/page_{pg + 1}_full.jpg"
                        blob = bucket.blob(blob_path)
                        blob.upload_from_string(compressed_bytes, content_type="image/jpeg")
                        blob.make_public()
                        uploaded_page_urls[pg] = blob.public_url
                        print(f"    [PAGE] Uploaded page {pg + 1} full image (compressed JPEG)")
                    except Exception as e:
                        print(f"    [PAGE] Failed to upload page {pg + 1}: {e}")

        FIGURE_BBOX_PROMPT = """You are looking at a scanned exam page. I need you to find the figure/diagram/graph associated with Question {q_num}.

Return the EXACT bounding box of JUST the figure/diagram (NOT the question text, NOT the options, ONLY the drawn figure/graph/diagram itself).

Return a JSON object with these 4 values as percentages of the page dimensions:
- leftPercent: distance from left edge (0-100)
- topPercent: distance from top edge (0-100)  
- rightPercent: distance from left edge to the right side of figure (0-100)
- bottomPercent: distance from top edge to the bottom of figure (0-100)

Example: {{"leftPercent": 5, "topPercent": 35, "rightPercent": 45, "bottomPercent": 60}}

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text. If no figure is found, return {{"error": true}}."""

        for idx, q in enumerate(questions_with_images):
            source_page = q.get("_source_page", 0)
            q_num = q["questionNumber"]

            if source_page not in page_images:
                continue

            b64_img = base64.b64encode(page_images[source_page]).decode("utf-8")

            print(f"    Q{q_num} (page {source_page + 1})...", end=" ", flush=True)

            try:
                resp = client.chat.completions.create(
                    model=VISION_MODEL,
                    messages=[
                        {"role": "system", "content": FIGURE_BBOX_PROMPT.format(q_num=q_num)},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Find the figure for Question {q_num} on this page."},
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

                # Crop the page image to the bounding box
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

                # Upload or save
                if not dry_run and FIREBASE_STORAGE_BUCKET:
                    try:
                        blob_path = f"question-images/{safe_source}/q{q_num}_fig.png"
                        blob = bucket.blob(blob_path)
                        blob.upload_from_string(img_to_upload, content_type="image/png")
                        blob.make_public()
                        q["imageUrl"] = blob.public_url
                        print("-> uploaded")
                    except Exception as e:
                        print(f"UPLOAD FAILED: {e}")
                elif dry_run:
                    img_dir = pdf_path.rsplit(".", 1)[0] + "_images"
                    os.makedirs(img_dir, exist_ok=True)
                    local_path = os.path.join(img_dir, f"q{q_num}_fig.png")
                    with open(local_path, "wb") as f:
                        f.write(img_to_upload)
                    q["imageUrl"] = local_path
                    print("-> saved locally")

                # Store figure training metadata on the question
                q["_figure_training"] = {
                    "source_page_url": uploaded_page_urls.get(source_page),
                    "source_page_number": source_page + 1,
                    "ai_crop_bbox": {"left": left, "top": top, "right": right, "bottom": bottom},
                    "page_width": w,
                    "page_height": h,
                    "ai_figure_url": q.get("imageUrl"),
                    "human_crop_bbox": None,
                    "human_figure_url": None,
                    "correction_type": "none",
                }

            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(RATE_LIMIT_DELAY)

        img_count = sum(1 for q in all_questions if q.get("imageUrl"))
        print(f"  [VISION] {img_count} questions now have cropped figure images")

    # ── OPTION-FIGURE CROPPING: Crop per-option images for figure-based options ──
    questions_with_option_images = [q for q in all_questions if q.get("hasOptionImages")]
    if questions_with_option_images:
        from PIL import Image
        import io

        print(f"  [OPTION-IMG] {len(questions_with_option_images)} questions have figure-based options")
        print(f"  [OPTION-IMG] Extracting per-option figure bounding boxes...")

        safe_source = re.sub(r'[^\w\-]', '_', source_paper)

        OPTION_FIGURES_BBOX_PROMPT = """You are looking at a scanned exam page. Question {q_num} has 4 options that are FIGURES/DIAGRAMS/GRAPHS (not text). Find the bounding box of EACH option figure separately.

The options are typically labeled (1), (2), (3), (4) or (A), (B), (C), (D) and each has its own separate diagram/graph/figure.

Return a JSON object with bounding boxes for all 4 options as percentages of page dimensions (0-100):
{{
  "A": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "B": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "C": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}},
  "D": {{"leftPercent": ..., "topPercent": ..., "rightPercent": ..., "bottomPercent": ...}}
}}

Include JUST the drawn figure/diagram for each option, including any labels directly below/beside the figure (like "Helix on +ve side of z-axis" or "circle in xy plane"). Do NOT include the option number label itself.

CRITICAL: Return ONLY the JSON object. No markdown, no code fences, no extra text. If you cannot find all 4 option figures, return {{"error": true}}."""

        if not dry_run and FIREBASE_STORAGE_BUCKET:
            init_firestore()
            bucket = fb_storage.bucket()

        for idx, q in enumerate(questions_with_option_images):
            source_page = q.get("_source_page", 0)
            q_num = q["questionNumber"]

            if source_page not in page_images:
                print(f"    Q{q_num}: no page image available, skipping")
                continue

            b64_img = base64.b64encode(page_images[source_page]).decode("utf-8")
            print(f"    Q{q_num} option figures (page {source_page + 1})...", end=" ", flush=True)

            try:
                resp = client.chat.completions.create(
                    model=VISION_MODEL,
                    messages=[
                        {"role": "system", "content": OPTION_FIGURES_BBOX_PROMPT.format(q_num=q_num)},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Find all 4 option figures for Question {q_num} on this page."},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_img}", "detail": "high"}}
                            ]
                        }
                    ],
                    temperature=0.0,
                    max_tokens=512,
                )

                raw = resp.choices[0].message.content.strip()
                if raw.startswith("```"):
                    lines = raw.split("\n")
                    lines = [l for l in lines if not l.strip().startswith("```")]
                    raw = "\n".join(lines)

                bboxes = json.loads(raw)

                if bboxes.get("error"):
                    print("could not find option figures")
                    continue

                pil_img = Image.open(io.BytesIO(page_images[source_page]))
                w, h = pil_img.size
                cropped_count = 0

                for opt_id in ["A", "B", "C", "D"]:
                    if opt_id not in bboxes:
                        continue

                    bbox = bboxes[opt_id]
                    left = max(0, int(w * bbox["leftPercent"] / 100) - 5)
                    top = max(0, int(h * bbox["topPercent"] / 100) - 5)
                    right = min(w, int(w * bbox["rightPercent"] / 100) + 5)
                    bottom = min(h, int(h * bbox["bottomPercent"] / 100) + 5)

                    cropped = pil_img.crop((left, top, right, bottom))
                    buf = io.BytesIO()
                    cropped.save(buf, format="PNG")
                    opt_img_bytes = buf.getvalue()

                    # Find the option in the question and set its imageUrl
                    opt_obj = next((o for o in q.get("options", []) if o["id"] == opt_id), None)
                    if not opt_obj:
                        continue

                    if not dry_run and FIREBASE_STORAGE_BUCKET:
                        try:
                            blob_path = f"question-images/{safe_source}/q{q_num}_opt{opt_id}.png"
                            blob = bucket.blob(blob_path)
                            blob.upload_from_string(opt_img_bytes, content_type="image/png")
                            blob.make_public()
                            opt_obj["imageUrl"] = blob.public_url
                            cropped_count += 1
                        except Exception as e:
                            print(f"opt{opt_id} upload failed: {e}", end=" ")
                    elif dry_run:
                        img_dir = pdf_path.rsplit(".", 1)[0] + "_images"
                        os.makedirs(img_dir, exist_ok=True)
                        local_path = os.path.join(img_dir, f"q{q_num}_opt{opt_id}.png")
                        with open(local_path, "wb") as f:
                            f.write(opt_img_bytes)
                        opt_obj["imageUrl"] = local_path
                        cropped_count += 1

                print(f"OK ({cropped_count}/4 options cropped)")

            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(RATE_LIMIT_DELAY)

        opt_img_count = sum(1 for q in all_questions if q.get("hasOptionImages") and any(o.get("imageUrl") for o in q.get("options", [])))
        print(f"  [OPTION-IMG] {opt_img_count} questions now have per-option figure images")

    # Clean up internal fields AND attach page data for golden dataset
    for q in all_questions:
        pg = q.get("_source_page")
        if pg is not None and pg in uploaded_page_urls:
            q["_page_image_url"] = uploaded_page_urls[pg]

        q.pop("_source_page", None)
        q.pop("hasImage", None)
        # We KEEP hasOptionImages for the golden dataset
        q.pop("figureTopPercent", None)
        q.pop("figureBottomPercent", None)

    return all_questions


def inject_answer_keys(
    questions: list[dict],
    answer_key: dict[int, str]
) -> list[dict]:
    """
    Override the correctOptionId for each question using the
    deterministically parsed answer key. This guarantees 100% accuracy.
    """
    matched = 0
    unmatched = []

    for q in questions:
        qn = q["questionNumber"]
        if qn in answer_key:
            q["correctOptionId"] = answer_key[qn]
            matched += 1
        else:
            unmatched.append(qn)

    print(f"  [INJECT] Matched {matched}/{len(questions)} answers")
    if unmatched:
        print(f"  [INJECT] No answer for questions: {unmatched}")

    return questions


# ──────────────────────────────────────────────
# CHAPTER CODE DETECTION
# ──────────────────────────────────────────────
def detect_chapter_code(raw_text: str) -> tuple[str | None, str | None]:
    """
    Try to find chapter markers in the raw text.
    Formats: #PHY #000001, #3C0-001001, etc.
    """
    # Format: #3C0-010011
    match = re.search(r'#(\w{3})-(\d{6})', raw_text)
    if match:
        section_id = match.group(1)
        binary_code = match.group(2)
        # Normalize section ID
        canonical_id = SECTION_ALIASES.get(section_id.upper(), section_id)
        return canonical_id, binary_code

    # Format: #PHY #000001
    match = re.search(r'#(\w{3})\s+#(\d{6})', raw_text)
    if match:
        section_id = match.group(1)
        binary_code = match.group(2)
        canonical_id = SECTION_ALIASES.get(section_id.upper(), section_id)
        return canonical_id, binary_code

    return None, None


def get_chapter_name(section_id: str | None, binary_code: str | None) -> str | None:
    """Look up the chapter name from the CHAPTER_LOOKUP table."""
    if not section_id or not binary_code:
        return None
    return CHAPTER_LOOKUP.get((section_id, binary_code))


# ──────────────────────────────────────────────
# AI CHAPTER CLASSIFICATION
# ──────────────────────────────────────────────
CLASSIFICATION_PROMPT = """You are a NEET exam chapter classifier. Given a question, classify it into the correct chapter.

The NEET syllabus has 3 subjects. Each subject has chapters with a unique binary code.
You MUST return ONLY valid JSON — no markdown, no text.

SUBJECTS AND CHAPTERS:
{chapters_json}

For each question below, return its sectionId and chapterBinaryCode.
Use the question content and subject context (if known) to determine the chapter.

QUESTIONS:
{questions_json}

Return a JSON array of objects, one per question, in the same order:
[
  {{"questionNumber": <int>, "sectionId": "<3-char ID>", "chapterBinaryCode": "<6-digit binary>"}}
]

CRITICAL: Return ONLY the JSON array. No markdown code fences, no explanations."""


def classify_chapters_with_ai(
    client: OpenAI,
    questions: list[dict],
    batch_size: int = 20
) -> list[dict]:
    """
    Classify questions into chapters using AI.
    Only processes questions that don't already have a chapterBinaryCode.
    """
    # Build the chapters reference JSON
    chapters_ref = []
    for (sid, bcode), name in CHAPTER_LOOKUP.items():
        chapters_ref.append({
            "sectionId": sid,
            "sectionName": SUBJECT_NAMES.get(sid, sid),
            "binaryCode": bcode,
            "chapterName": name
        })

    # Find questions needing classification
    needs_classification = [
        (i, q) for i, q in enumerate(questions)
        if not q.get("chapterBinaryCode") or q.get("chapterBinaryCode") == "null"
    ]

    if not needs_classification:
        print("  [CLASSIFY] All questions already have chapter codes, skipping.")
        return questions

    print(f"  [CLASSIFY] {len(needs_classification)} questions need chapter classification")

    # Process in batches
    for batch_start in range(0, len(needs_classification), batch_size):
        batch = needs_classification[batch_start:batch_start + batch_size]
        batch_questions = []
        for idx, q in batch:
            q_text = q.get("text") or ""
            batch_questions.append({
                "questionNumber": q["questionNumber"],
                "text": q_text[:300],  # Truncate to save tokens
                "sectionId": q.get("sectionId"),  # May help if subject is known
                "options": [opt.get("text", "")[:80] for opt in q.get("options", [])]
            })

        prompt = CLASSIFICATION_PROMPT.format(
            chapters_json=json.dumps(chapters_ref, indent=2),
            questions_json=json.dumps(batch_questions, indent=2)
        )

        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=4096,
            )

            raw = response.choices[0].message.content.strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                lines = raw.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw = "\n".join(lines)

            classifications = json.loads(raw)

            # Apply classifications back to the questions
            class_map = {c["questionNumber"]: c for c in classifications}
            for original_idx, q in batch:
                qn = q["questionNumber"]
                if qn in class_map:
                    c = class_map[qn]
                    sid = SECTION_ALIASES.get(c["sectionId"].upper(), c["sectionId"])
                    bcode = c["chapterBinaryCode"]
                    # Validate that this is a real chapter
                    if (sid, bcode) in CHAPTER_LOOKUP:
                        questions[original_idx]["sectionId"] = sid
                        questions[original_idx]["chapterBinaryCode"] = bcode
                    else:
                        print(f"    [WARN] Q{qn}: AI returned unknown chapter {sid}-{bcode}, keeping unclassified")

            classified_count = sum(1 for _, q in batch if q.get("chapterBinaryCode") and q["chapterBinaryCode"] != "null")
            print(f"  [CLASSIFY] Batch {batch_start // batch_size + 1}: classified {classified_count}/{len(batch)} questions")

        except (json.JSONDecodeError, Exception) as e:
            print(f"  [CLASSIFY] Batch {batch_start // batch_size + 1} failed: {e}")

        if batch_start + batch_size < len(needs_classification):
            time.sleep(RATE_LIMIT_DELAY)

    # Summary
    final_classified = sum(1 for q in questions if q.get("chapterBinaryCode") and q["chapterBinaryCode"] != "null")
    print(f"  [CLASSIFY] Final: {final_classified}/{len(questions)} questions have chapter codes")

    return questions


# ──────────────────────────────────────────────
# FIRESTORE PUSH
# ──────────────────────────────────────────────
def extract_question_snippet(q_num: int, full_text: str) -> str:
    """Extract a snippet of raw text roughly corresponding to this question."""
    # Matches "1." or "1)" or "Q1" or "Q.1"
    q_pattern = re.compile(rf'(?:^|\n)\s*(?:#{{1,3}}\s*)?(?:Q\.?\s*)?{q_num}\s*[.)\]:\s]')
    match = q_pattern.search(full_text)
    if not match:
        return full_text[:4000] # fallback
    
    start_pos = match.start()
    
    # Try to find the next question
    next_pattern = re.compile(rf'(?:^|\n)\s*(?:#{{1,3}}\s*)?(?:Q\.?\s*)?{q_num + 1}\s*[.)\]:\s]')
    next_match = next_pattern.search(full_text[start_pos + 10:])
    
    if next_match:
        end_pos = start_pos + 10 + next_match.start()
    else:
        # Just grab the next 2500 chars if no next question is found
        end_pos = start_pos + 4000
        
    return full_text[start_pos:end_pos].strip()

def init_firestore() -> firestore.Client:
    """Initialize Firebase Admin SDK and return Firestore client. Safe to call multiple times."""
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        raise FileNotFoundError(
            f"Firebase service account key not found at:\n"
            f"  {SERVICE_ACCOUNT_PATH}\n\n"
            f"To get it:\n"
            f"  1. Go to Firebase Console > Project Settings > Service Accounts\n"
            f"  2. Click 'Generate New Private Key'\n"
            f"  3. Save the JSON file as: scripts/serviceAccountKey.json"
        )

    # Only initialize if not already done
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        # Pass storageBucket so fb_storage.bucket() works
        firebase_admin.initialize_app(cred, {
            'storageBucket': FIREBASE_STORAGE_BUCKET
        })
    return firestore.client()


import datetime

def push_to_firestore(
    db: firestore.Client,
    questions: list[dict],
    raw_text: str,
    source_paper: str,
):
    """Push parsed questions to the QuestionBank collection with text-matching deduplication."""
    collection_ref = db.collection("QuestionBank")
    recycle_bin_ref = db.collection("QuestionBankRecycleBin")
    
    # 1. Fetch existing questions for this source_paper
    print(f"  Fetching existing questions for source: '{source_paper}'...")
    existing_docs = collection_ref.where("source_paper", "==", source_paper).stream()
    
    # Map of questionNumber -> list of (doc_id, status, full_doc_data)
    # (Using a list because multiple subjects might share the same questionNumber)
    existing_map: dict[int, list[tuple[str, str, dict]]] = {}
    for doc in existing_docs:
        data = doc.to_dict()
        if "optimized_json" in data and "questionNumber" in data["optimized_json"]:
            q_num = data["optimized_json"]["questionNumber"]
            status = data.get("training_status", "pending_review")
            if q_num not in existing_map:
                existing_map[q_num] = []
            existing_map[q_num].append((doc.id, status, data))
            
    print(f"  Found {sum(len(v) for v in existing_map.values())} existing questions for this paper.")

    # Helper function for text-matching heuristic
    def is_true_duplicate(new_q: dict, old_q_data: dict) -> bool:
        old_opts = old_q_data.get("optimized_json", {}).get("options", [])
        new_opts = new_q.get("options", [])
        
        # 1. Compare first 5 words
        old_text = old_q_data.get("optimized_json", {}).get("text", "")
        new_text = new_q.get("text", "")
        old_words = " ".join(old_text.split()[:5]).lower()
        new_words = " ".join(new_text.split()[:5]).lower()
        
        # If words differ, it's NOT a duplicate (e.g. Bio Q1 vs Physics Q1)
        if not old_words or not new_words or old_words != new_words:
            return False

        # 2. Compare the last two options (usually Options C and D)
        if len(old_opts) >= 2 and len(new_opts) >= 2:
            old_last = " ".join(o.get("text", "") for o in old_opts[-2:]).strip().lower()
            new_last = " ".join(o.get("text", "") for o in new_opts[-2:]).strip().lower()
            if old_last != new_last:
                return False

        # 3. Fallback to full text match if heuristics match exactly, or treat it as duplicate if we reached here
        return True

    count_added = 0
    count_updated = 0
    count_skipped = 0

    for q in questions:
        q_num = q["questionNumber"]
        
        # Determine section/chapter from the AI output or text detection
        section_id = q.get("sectionId")
        chapter_binary = q.get("chapterBinaryCode")

        # Normalize section IDs
        if section_id:
            section_id = SECTION_ALIASES.get(section_id.upper(), section_id)

        # Build the chapter_code tracker string
        chapter_code = None
        if section_id and chapter_binary:
            chapter_code = f"#{section_id}-{chapter_binary}"

        # Build the optimized_json (matches Question interface exactly)
        optimized_json = {
            "questionNumber": q_num,
            "text": q["text"],
            "options": q["options"],
            "correctOptionId": q["correctOptionId"],
        }
        if q.get("explanation"):
            optimized_json["explanation"] = q["explanation"]
        if q.get("imageUrl"):
            optimized_json["imageUrl"] = q["imageUrl"]

        # Build the full QuestionBank document
        doc_data = {
            "chapter_code": chapter_code,
            "section_id": section_id,
            "section_name": SUBJECT_NAMES.get(section_id, None) if section_id else None,
            "chapter_binary_code": chapter_binary,
            "chapter_name": get_chapter_name(section_id, chapter_binary),
            "source_paper": source_paper,
            "raw_ocr_input": extract_question_snippet(q_num, raw_text) if raw_text else "",
            "optimized_json": optimized_json,
            "image_url": q.get("imageUrl"),
            "training_status": "pending_review", # Overwritten if replacing flagged
        }

        # Add vision parsing and option images data (for Golden Dataset v2)
        if "_page_image_url" in q:
            doc_data["page_image_url"] = q["_page_image_url"]
        if "_extracted_page_text" in q:
            doc_data["extracted_page_text"] = q["_extracted_page_text"]
        if "hasOptionImages" in q:
            doc_data["has_option_images"] = q["hasOptionImages"]

        # Add figure training data if present (for crop correction training)
        figure_training = q.pop("_figure_training", None)
        if figure_training:
            doc_data["figure_training"] = figure_training

        # Deduplication Logic
        duplicate_doc_id = None
        duplicate_status = None
        duplicate_old_data = None

        if q_num in existing_map:
            # Check all candidates with this question number
            for old_id, old_status, old_data in existing_map[q_num]:
                if is_true_duplicate(q, old_data):
                    duplicate_doc_id = old_id
                    duplicate_status = old_status
                    duplicate_old_data = old_data
                    break

        if duplicate_doc_id and duplicate_old_data:
            if duplicate_status == "approved":
                print(f"    Q{q_num}: Skipping (already approved)")
                count_skipped += 1
                continue
            else:
                # pending_review or flagged -> Send old to Recycle Bin, overwrite current
                # 1. Prepare old data for Recycle Bin
                now = datetime.datetime.now(datetime.timezone.utc)
                duplicate_old_data["deleted_at"] = now
                duplicate_old_data["expires_at"] = now + datetime.timedelta(days=7)
                duplicate_old_data["original_doc_id"] = duplicate_doc_id
                
                # Strip out server timestamps that cause firebase serialization issues if raw
                duplicate_old_data.pop("created_at", None)
                duplicate_old_data.pop("updated_at", None)

                try:
                    recycle_bin_ref.add(duplicate_old_data)
                    print(f"    Q{q_num}: Backed up to Recycle Bin")
                except Exception as e:
                    print(f"    Q{q_num} ERROR: Could not backup to Recycle Bin: {e}")

                # 2. Overwrite main document
                doc_data["training_status"] = "pending_review"  # Reset status back to pending
                doc_data["updated_at"] = firestore.SERVER_TIMESTAMP
                collection_ref.document(duplicate_doc_id).set(doc_data, merge=True)
                print(f"    Q{q_num}: Overwriting existing ({duplicate_status})")
                count_updated += 1
        else:
            # Does not exist (or no true duplicate match) -> add new
            doc_data["created_at"] = firestore.SERVER_TIMESTAMP
            collection_ref.add(doc_data)
            count_added += 1

    print(f"  Summary: {count_added} added, {count_updated} updated, {count_skipped} skipped.")
    return count_added + count_updated


# ──────────────────────────────────────────────
# MAIN PIPELINE
# ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Ingest a NEET PDF into the Neetarded QuestionBank"
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--source", "-s",
        default="Unknown Paper",
        help="Source paper name (e.g. 'NEET 2024 Phase 1')"
    )
    parser.add_argument(
        "--answers", "-a",
        default="",
        help="Path to a text file containing the answer key (optional)"
    )
    parser.add_argument(
        "--dry-run", "-d",
        action="store_true",
        help="Parse and print results without pushing to Firestore"
    )
    parser.add_argument(
        "--no-images",
        action="store_true",
        help="Skip image extraction (faster, text-only mode)"
    )
    parser.add_argument(
        "--text-only",
        action="store_true",
        help="Use text-only batch parsing (no vision). Faster/cheaper but misses inline formula images."
    )
    args = parser.parse_args()

    # Validate
    if not OPENAI_API_KEY:
        print("[FAIL] OPENAI_API_KEY not set!")
        print("  Run: set OPENAI_API_KEY=your_key_here")
        sys.exit(1)

    print("=" * 60)
    print("  Neetarded Golden Dataset -- Ingestion Pipeline")
    print(f"  PDF: {args.pdf_path}")
    print(f"  Source: {args.source}")
    print(f"  Mode: {'DRY RUN (no Firestore push)' if args.dry_run else 'LIVE (pushing to Firestore)'}")
    print("=" * 60)
    print()

    # Step 1: Extract text from PDF
    print("[1/5] Extracting text from PDF...")
    full_text, is_scanned = extract_text_from_pdf(args.pdf_path)
    print()

    client = OpenAI(api_key=OPENAI_API_KEY)
    ocr_text = None  # Will be set for scanned PDFs

    # ── SCANNED PDF PATH: Use GPT-4 Vision to parse pages directly ──
    if is_scanned:
        print("[SCANNED PDF] Using GPT-4 Vision to parse pages directly (text + images)...")
        print("  This sends each page image to GPT-4V which can read text AND see diagrams.")
        print()

        # Extract answer key using GPT-4 Vision (reads table directly from images)
        print("[2/5] Extracting answer key with GPT-4 Vision...")
        parsed_answers: dict[int, str] = {}
        if args.answers and os.path.exists(args.answers):
            with open(args.answers, "r", encoding="utf-8") as f:
                answer_key_text = f.read()
            print(f"  Using external answer key from: {args.answers}")
            parsed_answers = parse_answer_key_deterministic(answer_key_text)
        else:
            parsed_answers = extract_answer_key_with_vision(client, args.pdf_path)
        print(f"  Extracted {len(parsed_answers)} answers")
        if parsed_answers:
            sample = dict(list(parsed_answers.items())[:5])
            print(f"  Sample: {sample}")

        # Also run OCR to get raw text for training dataset
        print("  Running OCR for training data (raw_ocr_input)...")
        ocr_text = ocr_pdf_with_vision(args.pdf_path)
        print()

        # Initialize Firebase early for image uploads (needed by vision parser)
        if not args.dry_run:
            print("  Initializing Firebase for image uploads...")
            init_firestore()

        # Parse all pages with GPT-4 Vision
        print("[3/5] Parsing pages with GPT-4 Vision...")
        all_questions = parse_scanned_pages_with_vision(
            client, args.pdf_path, args.source, dry_run=args.dry_run
        )
        print(f"\n  Total questions parsed: {len(all_questions)}")
        print()

        # Renumber
        print("[4/5] Renumbering questions globally...")
        all_questions = renumber_questions_globally(all_questions, ocr_text or full_text)
        print()

        # Inject answer keys
        print("[4.5/5] Injecting answer keys...")
        if parsed_answers:
            all_questions = inject_answer_keys(all_questions, parsed_answers)
        print()

    # ── NORMAL PDF PATH: Text-based parsing ──
    else:
        # Step 2: Auto-detect and PARSE answer key deterministically
        print("[2/5] Detecting & parsing answer key...")
        questions_text, auto_answer_key_text = extract_answer_key_section(full_text)

        # Parse the answer key deterministically (no LLM needed)
        answer_key_text = auto_answer_key_text
        if args.answers:
            if os.path.exists(args.answers):
                with open(args.answers, "r", encoding="utf-8") as f:
                    answer_key_text = f.read()
                print(f"  Using external answer key from: {args.answers}")
            else:
                print(f"  [WARN] Answer key file not found: {args.answers}, using auto-detected")

        parsed_answers: dict[int, str] = {}
        if answer_key_text:
            parsed_answers = parse_answer_key_deterministic(answer_key_text)
            print(f"  [DETERMINISTIC] Parsed {len(parsed_answers)} answers from answer key")
            # Show a sample
            sample = dict(list(parsed_answers.items())[:5])
            print(f"  Sample: {sample}")
        else:
            print("  [WARN] No answer key found -- answers will be missing")
        print()

        # Step 3+4: Parse questions
        all_questions = []

        if args.text_only:
            # ── TEXT-ONLY MODE: Old batch-based parsing (faster, but misses inline images) ──
            print("[3/5] Splitting questions into batches (text-only mode)...")
            batches = split_into_batches(questions_text)
            print(f"  Created {len(batches)} batches of ~{BATCH_SIZE} questions each")
            print()

            print("[4/5] Parsing questions with OpenAI text-only (no answer key sent to LLM)...")

            for i, batch in enumerate(batches):
                print(f"  Batch {i + 1}/{len(batches)}...", end=" ", flush=True)
                try:
                    parsed = parse_batch_with_ai(client, batch)
                    all_questions.extend(parsed)
                    print(f"OK ({len(parsed)} questions)")
                except json.JSONDecodeError as e:
                    print(f"PARSE ERROR: {e}")
                    print(f"  Skipping batch {i + 1}")
                except Exception as e:
                    print(f"API ERROR: {e}")
                    print(f"  Skipping batch {i + 1}")

                if i < len(batches) - 1:
                    time.sleep(RATE_LIMIT_DELAY)

            print(f"\n  Total questions parsed: {len(all_questions)}")
            print()
        else:
            # ── HYBRID VISION+TEXT MODE: Page-by-page with image (catches inline formulas) ──
            print("[3/5] Using hybrid vision+text parsing (catches inline formula images)...")
            print("  Each page image + extracted text is sent to GPT-4.1-mini together.")
            print("  Use --text-only flag to skip this and use faster text-only batch parsing.")
            print()

            print("[4/5] Parsing pages with hybrid vision+text...")
            hybrid_result = parse_pages_with_hybrid_vision(client, args.pdf_path, questions_text, dry_run=args.dry_run)

            if hybrid_result is None:
                # Fallback: no question pages detected, use text-only
                print("  Falling back to text-only batch parsing...")
                batches = split_into_batches(questions_text)
                for i, batch in enumerate(batches):
                    print(f"  Batch {i + 1}/{len(batches)}...", end=" ", flush=True)
                    try:
                        parsed = parse_batch_with_ai(client, batch)
                        all_questions.extend(parsed)
                        print(f"OK ({len(parsed)} questions)")
                    except json.JSONDecodeError as e:
                        print(f"PARSE ERROR: {e}")
                    except Exception as e:
                        print(f"API ERROR: {e}")
                    if i < len(batches) - 1:
                        time.sleep(RATE_LIMIT_DELAY)
            else:
                all_questions = hybrid_result

            print(f"\n  Total questions parsed: {len(all_questions)}")
            print()

        # Step 4.5: Renumber questions globally (Biology 1-90 -> 91-180)
        print("[4.5/5] Renumbering questions globally...")
        all_questions = renumber_questions_globally(all_questions, questions_text)
        print()

        # Step 4.6: Inject deterministic answer keys
        print("[4.6/5] Injecting pre-parsed answer keys...")
        if parsed_answers:
            all_questions = inject_answer_keys(all_questions, parsed_answers)
        print()

        # Step 4.65: Image extraction and mapping (only for normal PDFs)
        image_urls: dict[int, str] = {}
        if not args.no_images:
            print("[4.65/5] Extracting images from PDF...")
            pdf_images = extract_images_from_pdf(args.pdf_path)
            if pdf_images:
                question_positions = get_question_positions(args.pdf_path)
                image_map = map_images_to_questions(pdf_images, question_positions)

                if args.dry_run:
                    # Save locally for inspection
                    img_output_dir = args.pdf_path.rsplit(".", 1)[0] + "_images"
                    image_urls = save_images_locally(image_map, img_output_dir)
                elif FIREBASE_STORAGE_BUCKET:
                    image_urls = upload_images_to_firebase(image_map, args.source)
                else:
                    print("  [WARN] FIREBASE_STORAGE_BUCKET not set, skipping upload")
                    img_output_dir = args.pdf_path.rsplit(".", 1)[0] + "_images"
                    image_urls = save_images_locally(image_map, img_output_dir)

                # Apply image URLs to questions
                for q in all_questions:
                    q_num = q["questionNumber"]
                    if q_num in image_urls:
                        q["imageUrl"] = image_urls[q_num]

                img_count = sum(1 for q in all_questions if q.get("imageUrl"))
                print(f"  {img_count} questions now have images attached")
            else:
                print("  No images found in PDF")
            print()
        else:
            print("[4.65/5] Skipping image extraction (--no-images)")
            print()

        # Step 4.66: Upload option figure images (from hybrid vision cropping)
        option_img_questions = [q for q in all_questions if any(o.get("_local_image_path") for o in q.get("options", []))]
        if option_img_questions:
            print(f"[4.66/5] Uploading {len(option_img_questions)} questions' option figure images...")
            safe_source = re.sub(r'[^\w\-]', '_', args.source)

            if not args.dry_run and FIREBASE_STORAGE_BUCKET:
                init_firestore()
                bucket = fb_storage.bucket()
                uploaded_count = 0

                for q in option_img_questions:
                    q_num = q["questionNumber"]
                    for opt in q.get("options", []):
                        local_path = opt.pop("_local_image_path", None)
                        if local_path and os.path.exists(local_path):
                            try:
                                with open(local_path, "rb") as f:
                                    img_data = f.read()
                                blob_path = f"question-images/{safe_source}/q{q_num}_opt{opt['id']}.png"
                                blob = bucket.blob(blob_path)
                                blob.upload_from_string(img_data, content_type="image/png")
                                blob.make_public()
                                opt["imageUrl"] = blob.public_url
                                uploaded_count += 1
                            except Exception as e:
                                print(f"    Q{q_num} opt{opt['id']} upload failed: {e}")
                print(f"  Uploaded {uploaded_count} option figure images")
            elif args.dry_run:
                # In dry-run, convert _local_image_path to imageUrl for JSON output
                for q in option_img_questions:
                    for opt in q.get("options", []):
                        local_path = opt.pop("_local_image_path", None)
                        if local_path:
                            opt["imageUrl"] = local_path
                print(f"  [DRY RUN] {len(option_img_questions)} questions have local option images")
            print()

    # Step 4.7: AI Chapter Classification
    print("[4.7/5] Classifying questions into chapters with AI...")
    all_questions = classify_chapters_with_ai(client, all_questions)
    print()

    # Deduplicate by (questionNumber, first 80 chars of text)
    # This preserves Biology questions that share numbers with Physics
    # but have different text
    seen_keys = set()
    unique_questions = []
    for q in all_questions:
        dedup_key = (q["questionNumber"], q.get("text", "")[:80].strip().lower())
        if dedup_key not in seen_keys:
            seen_keys.add(dedup_key)
            unique_questions.append(q)
    all_questions = unique_questions
    print(f"  After dedup: {len(all_questions)} unique questions")
    print()

    # Sort by question number
    all_questions.sort(key=lambda q: q["questionNumber"])

    # Final sequential renumber: assign 1..N so there are NEVER duplicate numbers
    # This is the most reliable approach after renumbering + dedup
    for idx, q in enumerate(all_questions):
        q["questionNumber"] = idx + 1
    print(f"  Final renumber: {len(all_questions)} questions numbered 1-{len(all_questions)}")

    if args.dry_run:
        # Print results and exit
        print("[DRY RUN] Parsed questions:")
        print("-" * 40)
        for q in all_questions:
            print(f"  Q{q['questionNumber']}: {q['text'][:60]}... -> {q['correctOptionId']}")
        print("-" * 40)
        print()

        # Save to local JSON for inspection
        output_file = args.pdf_path.rsplit(".", 1)[0] + "_parsed.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(all_questions, f, indent=2, ensure_ascii=False)
        print(f"  Saved full output to: {output_file}")
        return

    # Step 4: Push to Firestore
    print("[4/4] Pushing to Firestore (QuestionBank collection)...")
    db = init_firestore()
    # For scanned PDFs, use the OCR text as raw_ocr_input (for training dataset)
    # For normal PDFs, use the original extracted text
    training_text = ocr_text if is_scanned and ocr_text else full_text
    count = push_to_firestore(db, all_questions, training_text, args.source)
    print(f"  Pushed {count} documents to QuestionBank!")
    print()
    print("[DONE] Ingestion complete.")
    print(f"  - {count} questions from '{args.source}' are now in Firestore")
    print(f"  - All marked as 'pending_review'")
    print(f"  - Review them in Firebase Console or build the admin review page")


if __name__ == "__main__":
    main()

import fitz, re

doc = fitz.open("scripts/papers/Dryrun.pdf")

print("Looking for Question 1...")
found = False
for page_num in range(min(5, len(doc))):
    page = doc[page_num]
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") == 0:
            for line in block.get("lines", []):
                lt = "".join(s["text"] for s in line.get("spans", []))
                # Print anything containing literal "1" (to see surrounding text)
                if "1" in lt and not "0999" in lt and not "2024" in lt:
                    print(f"Page {page_num+1}: {repr(lt)}")
                    found = True

doc.close()

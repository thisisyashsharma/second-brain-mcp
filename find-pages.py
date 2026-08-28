import fitz  # PyMuPDF
import sys

doc = fitz.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf')
targets = [
    "Revenue from operations",
    "Profit / (loss) for the year",
    "Total assets",
    "Total liabilities",
    "Borrowings",
    "Net cash generated from operating activities"
]

results = {t: [] for t in targets}

# Search all pages
for page_num in range(len(doc)):
    page = doc[page_num]
    text = page.get_text().lower()
    for t in targets:
        if t.lower() in text:
            results[t].append(page_num)

for t in targets:
    print(f"'{t}': {results[t][:5]}...") # print first 5 occurrences

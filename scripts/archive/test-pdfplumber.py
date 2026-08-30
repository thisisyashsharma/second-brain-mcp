import pdfplumber
import json
import time
import psutil
import os

start_time = time.time()
pages_to_test = [46, 184, 185, 303]

print("=== PDFPlumber Table Extraction ===")
with pdfplumber.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf') as pdf:
    for p_num in pages_to_test:
        print(f"\n--- PAGE {p_num} ---")
        page = pdf.pages[p_num]
        tables = page.extract_tables()
        if not tables:
            print("No tables found. Trying raw text extraction.")
            text = page.extract_text()
            print(text[:500] if text else "Empty page")
            continue
            
        for i, table in enumerate(tables):
            print(f"Table {i+1}:")
            # print first 5 rows and last row
            if len(table) > 6:
                for row in table[:5]:
                    print(row)
                print("...")
                print(table[-1])
            else:
                for row in table:
                    print(row)

end_time = time.time()
print(f"\nProcessing time for {len(pages_to_test)} pages: {end_time - start_time:.2f} seconds")
process = psutil.Process(os.getpid())
print(f"Memory used: {process.memory_info().rss / 1024 / 1024:.2f} MB")

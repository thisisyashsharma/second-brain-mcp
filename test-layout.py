import pdfplumber

with pdfplumber.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf') as pdf:
    for p in [46, 184]:
        print(f"\n--- PAGE {p} LAYOUT ---")
        print(pdf.pages[p].extract_text(layout=True)[:1500])

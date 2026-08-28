import fitz

doc = fitz.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf')
for p in [184, 185]:
    print(f"\n--- PAGE {p} PYMUPDF ---")
    text = doc[p].get_text()
    if 'Total liabilities' in text:
        idx = text.find('Total liabilities')
        print(text[idx:idx+500])
    if 'Total income' in text:
        idx = text.find('Total income')
        print(text[idx:idx+500])

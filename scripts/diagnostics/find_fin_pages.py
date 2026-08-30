import fitz
doc = fitz.open('test-brain/Finance/Eternals/Zomato_Annual_Report_2023-24.pdf')
for i in range(len(doc)):
    text = doc[i].get_text().lower()
    if 'consolidated balance sheet' in text or 'consolidated statement of profit' in text or 'cash flow statement' in text:
        print(f"Found financial terms on page {i+1}")

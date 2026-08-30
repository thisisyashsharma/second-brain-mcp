import pdfplumber

with pdfplumber.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf') as pdf:
    # Page 185 (Profit and Loss) which has a major heading
    p = pdf.pages[184]
    words = p.extract_words(extra_attrs=['size', 'fontname'])
    print("--- PAGE 185 WORDS ---")
    for w in words[:40]:
        print(f"{w['text']} | size: {w['size']:.2f} | font: {w['fontname']} | y0: {w['top']:.2f}")

    # Let's also check Page 46 (Board Report)
    p2 = pdf.pages[46]
    words2 = p2.extract_words(extra_attrs=['size', 'fontname'])
    print("\n--- PAGE 47 WORDS ---")
    for w in words2[:40]:
        print(f"{w['text']} | size: {w['size']:.2f} | font: {w['fontname']} | y0: {w['top']:.2f}")

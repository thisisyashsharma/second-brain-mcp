import pdfplumber

def line_from_words(words):
    if not words: return ""
    return " ".join(w['text'] for w in words)

with pdfplumber.open('test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf') as pdf:
    # Just scan first 50 pages for large text
    large_lines = []
    for i in range(50):
        p = pdf.pages[i]
        words = p.extract_words(extra_attrs=['size', 'fontname'])
        
        # group words by y0
        lines = {}
        for w in words:
            y = round(w['top'], 1) # group by roughly same y
            found = False
            for ky in lines.keys():
                if abs(ky - y) < 2.0: # within 2 points
                    lines[ky].append(w)
                    found = True
                    break
            if not found:
                lines[y] = [w]
                
        for y in sorted(lines.keys()):
            lw = lines[y]
            max_size = max(w['size'] for w in lw)
            if max_size >= 14.0:
                text = " ".join(w['text'] for w in sorted(lw, key=lambda x: x['x0']))
                large_lines.append(f"Page {i+1} | Size {max_size:.1f} | {text}")

    print("\n".join(large_lines[:50]))

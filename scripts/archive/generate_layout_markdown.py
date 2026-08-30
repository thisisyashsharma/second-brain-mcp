import pdfplumber
import os
import json
import re
from collections import Counter

INPUT_DIR = 'test-brain/Finance/Eternals'
OUTPUT_DIR = os.path.join(INPUT_DIR, 'structured')

TIER_1_KEYWORDS = [
    "financial statements", "balance sheet", "statement of profit", "cash flow", 
    "notes to the consolidated", "independent auditor's report"
]
TIER_2_KEYWORDS = [
    "food delivery", "quick commerce", "going out", "hyperpure", "segment performance", 
    "operating metrics", "business performance"
]
TIER_3_KEYWORDS = [
    "corporate overview", "company overview", "business overview", "strategy", 
    "board report", "management discussion", "directors' report"
]

def classify_tier(title):
    t = title.lower()
    for kw in TIER_1_KEYWORDS:
        if kw in t: return 1
    for kw in TIER_2_KEYWORDS:
        if kw in t: return 2
    for kw in TIER_3_KEYWORDS:
        if kw in t: return 3
    return 3 # Default

def is_page_header_footer(text, y, page_height, history):
    # Margin based
    if y < 60 or y > page_height - 60:
        return True
    
    # Repetition based
    text = text.strip()
    if not text or len(text) < 5: return False
    
    # Check if this exact text appeared in the last 2 pages
    count = 0
    for p_texts in history[-3:]:
        if text in p_texts:
            count += 1
    if count >= 2:
        return True
    return False

def is_table_row(words, line_text):
    # Multiple numeric columns?
    num_count = sum(1 for w in words if re.search(r'\d', w['text']))
    # Large horizontal whitespace spacing? words are separated by space already, but let's look at x distances
    # A simple proxy: if the string has multiple consecutive spaces
    if "   " in line_text and num_count >= 1:
        return True
    # If it's something like "Revenue EBITDA PAT"
    if "   " in line_text and len(words) > 2:
        return True
    return False

def get_dominant_font_size(pdf):
    # Sample first 20 pages
    sizes = []
    for p in pdf.pages[:20]:
        words = p.extract_words(extra_attrs=['size'])
        for w in words:
            sizes.append(round(w['size'], 1))
    if not sizes:
        return 11.0
    counter = Counter(sizes)
    # Get the most common size
    return counter.most_common(1)[0][0]

def group_words_into_lines(words):
    lines = {}
    for w in words:
        y = round(w['top'], 1)
        found = False
        for ky in lines.keys():
            if abs(ky - y) < 3.0:
                lines[ky].append(w)
                found = True
                break
        if not found:
            lines[y] = [w]
            
    sorted_y = sorted(lines.keys())
    result = []
    for y in sorted_y:
        lw = sorted(lines[y], key=lambda x: x['x0'])
        # Reconstruct text with approximate spaces
        text = ""
        last_x1 = -1
        for w in lw:
            if last_x1 != -1:
                spaces = max(1, int((w['x0'] - last_x1) / 4))
                text += " " * spaces
            text += w['text']
            last_x1 = w['x1']
            
        max_size = max(w['size'] for w in lw)
        is_bold = any("bold" in w['fontname'].lower() for w in lw)
        
        result.append({
            'y': y,
            'words': lw,
            'text': text.strip(),
            'raw_text': text,
            'max_size': max_size,
            'is_bold': is_bold
        })
    return result

def process_pdf(filename):
    print(f"Processing {filename}...")
    filepath = os.path.join(INPUT_DIR, filename)
    
    company = "Eternal" if "eternal" in filename.lower() else "Zomato"
    fy_match = re.search(r'20\d{2}-\d{2}|20\d{2}', filename)
    fy = fy_match.group(0) if fy_match else "Unknown"
    
    sections = []
    current_section = {"id": "introduction", "title": "Introduction", "tier": 3, "start_page": 1, "content": []}
    
    history = []
    
    with pdfplumber.open(filepath) as pdf:
        dom_size = get_dominant_font_size(pdf)
        print(f"  Dominant size: {dom_size}")
        
        for page_num, page in enumerate(pdf.pages, 1):
            # Also extract layout for verbatim rendering
            layout_text = page.extract_text(layout=True)
            if not layout_text:
                continue
                
            layout_lines = layout_text.split('\n')
            
            # Words for heuristic detection
            words = page.extract_words(extra_attrs=['size', 'fontname'])
            lines_data = group_words_into_lines(words)
            
            page_history = set()
            
            # We map layout_lines to lines_data roughly by text content
            # A layout line might match multiple lines_data if y grouping wasn't perfect, but we just want to flag headers
            
            for l_idx, layout_line in enumerate(layout_lines):
                stripped = layout_line.strip()
                if not stripped:
                    current_section["content"].append(layout_line)
                    continue
                
                # find corresponding line_data
                stripped_norm = re.sub(r'\s+', ' ', stripped)
                ld = next((ld for ld in lines_data 
                           if re.sub(r'\s+', ' ', ld['text']) in stripped_norm 
                           or stripped_norm in re.sub(r'\s+', ' ', ld['text'])), None)
                
                if ld:
                    page_history.add(ld['text'])
                    
                    if is_page_header_footer(ld['text'], ld['y'], page.height, history):
                        continue # Skip appending this line entirely
                        
                    if not (ld['max_size'] >= dom_size + 4.0) and is_table_row(ld['words'], layout_line):
                        current_section["content"].append(layout_line)
                        continue
                        
                    # Is it a major heading?
                    # Needs to be significantly larger (e.g. dom_size + 4) or strongly recognized as a major section
                    is_major = False
                    normalized_text = re.sub(r'\s+', ' ', ld['text']).strip()
                    if ld['max_size'] >= dom_size + 4.0:
                        if 4 <= len(normalized_text) < 100:
                            is_major = True
                            
                    # Fallback for some reports that use bold + slightly larger font for major sections
                    if not is_major and ld['max_size'] >= dom_size + 1.5 and ld['is_bold'] and len(ld['text']) < 60:
                        tlower = re.sub(r'\s+', ' ', ld['text'].lower())
                        if any(k in tlower for k in TIER_1_KEYWORDS + TIER_2_KEYWORDS + TIER_3_KEYWORDS):
                            is_major = True
                            
                    if is_major:
                        # Close current section
                        if current_section["content"]:
                            current_section["end_page"] = page_num
                            sections.append(current_section)
                        
                        clean_title = ld['text']
                        current_section = {
                            "id": re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-'),
                            "title": clean_title,
                            "tier": classify_tier(clean_title),
                            "start_page": page_num,
                            "content": [f"\n# {clean_title}\n"]
                        }
                        continue
                        
                # Just append
                current_section["content"].append(layout_line)
                
            history.append(page_history)
            
        current_section["end_page"] = len(pdf.pages)
        sections.append(current_section)
        
    valid_sections = [s for s in sections if "".join(s["content"]).strip()]
    
    # Generate MD
    md_content = f"""---
document: {filename.replace('.pdf', '')}
company: {company}
fiscal_year: {fy}
source_pdf: {filename}
---
"""
    for s in valid_sections:
        # Avoid redundant heading if content already has it
        content_str = "\n".join(s["content"])
        if not content_str.startswith(f"\n# {s['title']}"):
            md_content += f"\n# {s['title']}\ntier: {s['tier']}\n\n"
        else:
            # Inject tier tag
            content_str = content_str.replace(f"\n# {s['title']}\n", f"\n# {s['title']}\ntier: {s['tier']}\n\n", 1)
        md_content += content_str + "\n\n"
        
    md_filename = filename.replace('.pdf', '.md')
    with open(os.path.join(OUTPUT_DIR, md_filename), 'w', encoding='utf-8') as f:
        f.write(md_content)
        
    return {
        "document": filename.replace('.pdf', ''),
        "source_pdf": filename,
        "fiscal_year": fy,
        "sections": [{
            "section_id": s["id"],
            "section_title": s["title"],
            "tier": s["tier"],
            "start_page": s["start_page"],
            "end_page": s["end_page"],
            "markdown_file": md_filename
        } for s in valid_sections]
    }

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    pdfs = [f for f in os.listdir(INPUT_DIR) if f.endswith('.pdf')]
    
    manifest = {"documents": []}
    for pdf in pdfs:
        doc_manifest = process_pdf(pdf)
        manifest["documents"].append(doc_manifest)
        
    with open(os.path.join(OUTPUT_DIR, 'tier-manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        
    print("Done.")

if __name__ == "__main__":
    main()

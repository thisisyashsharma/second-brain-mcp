import json
import os
import re

OUTPUT_DIR = 'test-brain/Finance/Eternals/structured'

def validate():
    manifest_path = os.path.join(OUTPUT_DIR, 'tier-manifest.json')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
        
    print("=== OVERALL METRICS ===")
    for doc in manifest['documents']:
        sections = doc['sections']
        print(f"Doc: {doc['document']}")
        print(f"  Total sections: {len(sections)}")
        print(f"  Tier 1 count: {sum(1 for s in sections if s['tier'] == 1)}")
        print(f"  Tier 2 count: {sum(1 for s in sections if s['tier'] == 2)}")
        print(f"  Tier 3 count: {sum(1 for s in sections if s['tier'] == 3)}")
        
        # Financial statements pages
        fin_pages = sum((s['end_page'] - s['start_page']) for s in sections if s['tier'] == 1)
        print(f"  Detected financial-statement pages: ~{fin_pages}")
        
    # Analyze Eternal_Annual_Report_2024-25.md
    md_path = os.path.join(OUTPUT_DIR, 'Eternal_Annual_Report_2024-25.md')
    with open(md_path, 'r', encoding='utf-8') as f:
        md_text = f.read()
        
    targets = [
        "Revenue from operations",
        "Total income",
        "Profit / (loss) for the year",
        "Total assets",
        "Total liabilities",
        "Borrowings",
        "Net cash generated from operating activities"
    ]
    
    print("\n=== SPECIFIC VALIDATION ===")
    for target in targets:
        # Find where it occurs
        idx = md_text.lower().find(target.lower())
        if idx != -1:
            # find previous heading
            prev_heading = "Unknown"
            h_idx = md_text.rfind('\n# ', 0, idx)
            if h_idx != -1:
                end_h = md_text.find('\n', h_idx+1)
                prev_heading = md_text[h_idx:end_h].strip()
                
            # extract line
            start_l = md_text.rfind('\n', 0, idx)
            end_l = md_text.find('\n', idx)
            line = md_text[start_l:end_l].strip()
            
            print(f"[{target}]")
            print(f"  Parent section: {prev_heading}")
            print(f"  Line: {line}")
            print(f"  Aligned values: {len(line.split('  ')) > 2}")
            # check tier
            tier_idx = md_text.find('tier: ', h_idx)
            if tier_idx != -1 and tier_idx < idx:
                print(f"  Tier 1: {md_text[tier_idx+6:tier_idx+7] == '1'}")
        else:
            print(f"[{target}] NOT FOUND")

if __name__ == "__main__":
    validate()

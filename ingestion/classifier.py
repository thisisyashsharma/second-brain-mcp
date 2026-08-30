import json
import sys
import argparse

TIER1_KEYWORDS = [
    "financial statement", "balance sheet", "profit and loss",
    "cash flow", "notes to financial", "borrowings", "auditor's report",
    "independent auditor"
]

TIER3_KEYWORDS = [
    "board report", "corporate governance", "management discussion",
    "business responsibility", "sustainability report", "annexure"
]

def determine_tier(title):
    title_lower = title.lower()
    for kw in TIER1_KEYWORDS:
        if kw in title_lower:
            return 1, False
    for kw in TIER3_KEYWORDS:
        if kw in title_lower:
            return 3, False
    return 2, True  # Unknown -> Tier 2 (medium) + needs_review

def main():
    parser = argparse.ArgumentParser(description='Classify tiers for structured JSON.')
    parser.add_argument('--input', required=True, help='Input structured JSON file')
    parser.add_argument('--output', required=True, help='Output tiered JSON file')
    args = parser.parse_args()

    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sections = []
    
    current_sec = {
        "title": "General",
        "tier": 2,
        "needs_review": True,
        "start_page": 1,
        "end_page": 1,
        "elements": []
    }

    for el in data.get('elements', []):
        page = el.get('page', current_sec['end_page'])
        current_sec['end_page'] = max(current_sec['end_page'], page)
        
        if el['type'] == 'text':
            if el.get('label') in ['title', 'section_header']:
                has_content = len(current_sec['elements']) > 0
                if has_content:
                    sections.append(current_sec)
                
                title = el.get('content', 'Unknown')
                tier, review = determine_tier(title)
                
                # INHERITANCE LOGIC:
                # If there are consecutive headers (no elements between them), the new header is a sub-header.
                # If the sub-header is Tier 2 (Unknown), it should inherit the strong Tier (1 or 3) from its direct parent header.
                if not has_content and tier == 2:
                    tier = current_sec['tier']
                    review = current_sec['needs_review'] or True
                
                current_sec = {
                    "title": title,
                    "tier": tier,
                    "needs_review": review,
                    "start_page": page,
                    "end_page": page,
                    "elements": []
                }
            else:
                el_copy = dict(el)
                el_copy['tier'] = current_sec['tier']
                current_sec['elements'].append(el_copy)
        elif el['type'] == 'table':
            el_copy = dict(el)
            el_copy['tier'] = current_sec['tier']
            current_sec['elements'].append(el_copy)
            
    if current_sec['elements']:
        sections.append(current_sec)

    tiered_data = {
        "document": data.get('document', {}),
        "sections": sections
    }

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(tiered_data, f, indent=2)

    print(f"Classification complete. Wrote tiered JSON to {args.output}")
    print(f"Total sections classified: {len(sections)}")

if __name__ == '__main__':
    main()

import json
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_tiered.py <tiered_json_path>")
        sys.exit(1)
        
    json_path = sys.argv[1]
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sections = data.get('sections', [])
    
    tier_counts = {1: 0, 2: 0, 3: 0}
    table_tier_counts = {1: 0, 2: 0, 3: 0}
    
    search_terms = [
        "net cash generated from operating activities",
        "operating activities",
        "Total liabilities",
        "Borrowings",
        "segment performance"
    ]
    
    for sec in sections:
        tier_counts[sec.get('tier', 2)] += 1
        
        tables = [el for el in sec.get('elements', []) if el.get('type') == 'table']
        for t in tables:
            table_tier_counts[t.get('tier', 2)] += 1
            
            rows_str = json.dumps(t.get('rows', []))
            for term in search_terms:
                if term.lower() in rows_str.lower():
                    print(f"MATCH: '{term}' found in Section: '{sec.get('title')}' | Tier: {t.get('tier')} | Table: {t.get('table_id')}")

    print("\n--- VALIDATION SUMMARY ---")
    print(f"Total sections: {len(sections)}")
    print(f"Tier 1 sections: {tier_counts[1]}")
    print(f"Tier 2 sections: {tier_counts[2]}")
    print(f"Tier 3 sections: {tier_counts[3]}")
    print(f"Tier 1 tables: {table_tier_counts[1]}")
    print(f"Tier 2 tables: {table_tier_counts[2]}")
    print(f"Tier 3 tables: {table_tier_counts[3]}")

if __name__ == '__main__':
    main()

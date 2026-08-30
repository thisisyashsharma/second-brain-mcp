import sys
import json
from pathlib import Path

def main():
    json_path = sys.argv[1] if len(sys.argv) > 1 else "output/worldbank_tiered.json"
    p = Path(json_path)
    if not p.exists():
        print(f"Error: {json_path} does not exist.")
        sys.exit(1)
        
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sections = data.get("sections", [])
    csv_files = set()
    countries = set()
    indicators = set()
    total_data_rows = 0
    tier_counts = {1: 0, 2: 0, 3: 0}
    needs_review_count = 0
    table_count = 0

    for sec in sections:
        t = sec.get("tier", 2)
        tier_counts[t] = tier_counts.get(t, 0) + 1
        if sec.get("needs_review", False):
            needs_review_count += 1
            
        for el in sec.get("elements", []):
            if el.get("type") == "table":
                table_count += 1
                if el.get("needs_review", False):
                    needs_review_count += 1
                rows = el.get("rows", [])
                if len(rows) > 1:
                    # data rows are from index 1 onward
                    for r in rows[1:]:
                        total_data_rows += 1
                        if len(r) >= 8:
                            csv_files.add(r[0])   # Source Filename
                            countries.add(r[2])   # Country
                            indicators.add(r[4])  # Indicator

    print("="*55)
    print("       WORLDBANK DATA VALIDATION SUMMARY       ")
    print("="*55)
    print(f"Number of CSV files   : {len(csv_files)}")
    print(f"Number of Countries   : {len(countries)}")
    print(f"Number of Indicators  : {len(indicators)}")
    print(f"Number of Data Rows   : {total_data_rows}")
    print(f"Number of Sections    : {len(sections)}")
    print(f"Number of Tables      : {table_count}")
    print(f"Tier 1 Items (Debt/Mil/Pov) : {tier_counts.get(1, 0)}")
    print(f"Tier 2 Items (Jobs/Edu/Hlth): {tier_counts.get(2, 0)}")
    print(f"Tier 3 Items (GDP/Pop/Life) : {tier_counts.get(3, 0)}")
    print(f"Needs Review Count          : {needs_review_count}")
    print("="*55)

if __name__ == "__main__":
    main()

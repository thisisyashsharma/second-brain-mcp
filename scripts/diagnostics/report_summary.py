import json
from pathlib import Path

f_path = 'output/Zomato_Annual_Report_2023-24_structured.json'
with open(f_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Total Pages processed: {data['document']['pages']}")
tables = [e for e in data['elements'] if e['type'] == 'table']
print(f"Total Tables extracted: {len(tables)}\n")

for t in tables:
    print(f"--- Table {t['table_id']} on Page {t['page']} ---")
    print(f"Rows: {len(t['rows'])}")
    print(f"Docling Score: {t.get('docling_score', 'N/A')}")
    print(f"Final Score: {t.get('final_score', 'N/A')}")
    print(f"Needs Review: {t['needs_review']}")
    print(f"Extraction Method: {t['extraction_method']}")
    # print snippet
    if t['rows']:
        for row in t['rows'][:3]:
            print(f"  {row}")
    print()

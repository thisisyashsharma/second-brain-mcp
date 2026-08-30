import json
with open('output/Zomato_Annual_Report_2023-24_structured.json') as f:
    data = json.load(f)
for el in data['elements'][:20]:
    if el['type'] == 'text':
        print(f"[{el['page']}] {el['label']}: {el['content'][:50]}...")

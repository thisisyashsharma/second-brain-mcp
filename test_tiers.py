import json

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
            return 1
    for kw in TIER3_KEYWORDS:
        if kw in title_lower:
            return 3
    return 2

data = json.load(open('output/Zomato_Annual_Report_2023-24_structured.json', 'r', encoding='utf-8'))
for el in data.get('elements', []):
    if el.get('label') in ['title', 'section_header']:
        t = determine_tier(el['content'])
        print(f"Tier {t}: {el['content']}")

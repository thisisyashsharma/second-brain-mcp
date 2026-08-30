import os
import sys
import csv
import json
import argparse
from pathlib import Path

TABLE_HEADERS = [
    "Source Filename",
    "Dataset Name",
    "Country",
    "Country Code",
    "Indicator",
    "Indicator Code",
    "Year",
    "Value"
]

def determine_tier_from_path_or_indicator(csv_path, indicator_code, indicator_name):
    # 1. Check directory name
    parts = [p.lower() for p in csv_path.parts]
    if "tier1" in parts or "tier 1" in parts or "tier_1" in parts:
        return 1
    if "tier2" in parts or "tier 2" in parts or "tier_2" in parts:
        return 2
    if "tier3" in parts or "tier 3" in parts or "tier_3" in parts:
        return 3

    # 2. Check indicator code & name keywords
    code = (indicator_code or "").upper()
    ind_lower = (indicator_name or "").lower()
    
    # Tier 1 indicators (Debt, Military, Poverty, Arrears, Solvency)
    if any(k in code for k in ["DT.DOD.DECT", "MS.MIL.XPND", "SI.POV", "DECT", "DOD", "TDS"]):
        return 1
    if any(k in ind_lower for k in ["external debt", "military expenditure", "poverty headcount", "debt service", "borrowings"]):
        return 1
        
    # Tier 2 indicators (Electricity, Education, Health, Unemployment, Banking, Credit)
    if any(k in code for k in ["EG.ELC.ACCS", "SE.XPD.TOTL", "SH.XPD.CHEX", "SL.UEM.TOTL", "ELC", "CHEX", "UEM", "NPL", "DOMS", "PRVT"]):
        return 2
    if any(k in ind_lower for k in ["electricity", "education", "health", "unemployment", "credit", "non-performing"]):
        return 2
        
    # Tier 3 indicators (Inflation, Internet, GDP, Life Expectancy, Population, Trade)
    return 3

def parse_worldbank_csv(csv_path):
    """
    Parse standard World Bank wide-format CSV into normalized records.
    Preserves raw values with zero calculations or transformations.
    """
    csv_path = Path(csv_path)
    source_filename = csv_path.name
    dataset_name = "World Development Indicators"
    
    rows_raw = []
    # Use standard library csv reader
    with open(csv_path, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.reader(f)
        for row in reader:
            rows_raw.append(row)
            
    if not rows_raw:
        return dataset_name, source_filename, []
        
    # Detect dataset name from metadata header rows if present
    header_idx = -1
    for idx, row in enumerate(rows_raw[:15]):
        if len(row) >= 2 and row[0].strip().lower() == "data source":
            dataset_name = row[1].strip() or dataset_name
        # Look for the primary header row containing Country Name / Country Code
        row_lower = [c.strip().lower() for c in row]
        if "country name" in row_lower and ("indicator name" in row_lower or "indicator code" in row_lower):
            header_idx = idx
            break
        elif "country" in row_lower and "indicator" in row_lower:
            header_idx = idx
            break

    if header_idx == -1:
        # Fallback: assume line 0 is header
        header_idx = 0
        
    header_row = rows_raw[header_idx]
    col_map = {}
    year_cols = []
    
    for c_idx, col_name in enumerate(header_row):
        col_clean = col_name.strip()
        col_lower = col_clean.lower()
        if col_lower in ["country name", "country"]:
            col_map["country"] = c_idx
        elif col_lower in ["country code", "country_code"]:
            col_map["country_code"] = c_idx
        elif col_lower in ["indicator name", "indicator", "series name", "series"]:
            col_map["indicator"] = c_idx
        elif col_lower in ["indicator code", "indicator_code", "series code", "series_code"]:
            col_map["indicator_code"] = c_idx
        elif col_clean.isdigit() and len(col_clean) == 4:
            year_cols.append((col_clean, c_idx))
        elif len(col_clean) >= 4 and col_clean[:4].isdigit() and int(col_clean[:4]) >= 1900 and int(col_clean[:4]) <= 2100:
            year_cols.append((col_clean[:4], c_idx))
        elif col_clean.startswith("YR") and col_clean[2:].isdigit():
            year_cols.append((col_clean[2:], c_idx))

    # Sort year columns chronologically
    year_cols.sort(key=lambda x: x[0])
    
    country_idx = col_map.get("country", 0)
    code_idx = col_map.get("country_code", 1 if len(header_row) > 1 else 0)
    indicator_idx = col_map.get("indicator", 2 if len(header_row) > 2 else 0)
    ind_code_idx = col_map.get("indicator_code", 3 if len(header_row) > 3 else 0)
    
    sections_data = []
    
    for row in rows_raw[header_idx + 1:]:
        if not row or all(not str(c).strip() for c in row):
            continue
            
        country = row[country_idx].strip() if len(row) > country_idx else ""
        country_code = row[code_idx].strip() if len(row) > code_idx else ""
        indicator = row[indicator_idx].strip() if len(row) > indicator_idx else ""
        indicator_code = row[ind_code_idx].strip() if len(row) > ind_code_idx else ""
        
        if not country or not indicator:
            continue
            
        tier = determine_tier_from_path_or_indicator(csv_path, indicator_code, indicator)
        
        data_rows = []
        for year_str, y_idx in year_cols:
            if y_idx < len(row):
                val = row[y_idx].strip()
                if val != "" and val != ".." and val.lower() != "nan" and val.lower() != "null":
                    data_rows.append([
                        source_filename,
                        dataset_name,
                        country,
                        country_code,
                        indicator,
                        indicator_code,
                        year_str,
                        val
                    ])
                    
        sections_data.append({
            "source_filename": source_filename,
            "dataset_name": dataset_name,
            "country": country,
            "country_code": country_code,
            "indicator": indicator,
            "indicator_code": indicator_code,
            "tier": tier,
            "data_rows": data_rows
        })
        
    return dataset_name, source_filename, sections_data

def build_structured_and_tiered(all_sections_data, doc_name="worldbank_data.csv"):
    structured_elements = []
    tiered_sections = []
    
    for i, item in enumerate(all_sections_data):
        page_num = i + 1
        country = item["country"]
        country_code = item["country_code"]
        indicator = item["indicator"]
        indicator_code = item["indicator_code"]
        source_filename = item["source_filename"]
        dataset_name = item["dataset_name"]
        tier = item.get("tier", 3)
        data_rows = item["data_rows"]
        
        sec_title = f"World Bank: {country} - {indicator}"
        table_id = f"tbl_wb_{country_code or 'NA'}_{indicator_code.replace('.', '_') or 'NA'}_{page_num}"
        meta_paragraph = (
            f"Dataset: {dataset_name} | Source: {source_filename} | "
            f"Country: {country} ({country_code}) | Indicator: {indicator} ({indicator_code}) | Tier: {tier}"
        )
        
        # 1. Elements for structured JSON
        structured_elements.append({
            "type": "text",
            "label": "section_header",
            "page": page_num,
            "content": sec_title
        })
        structured_elements.append({
            "type": "text",
            "label": "paragraph",
            "page": page_num,
            "content": meta_paragraph
        })
        structured_elements.append({
            "type": "table",
            "table_id": table_id,
            "page": page_num,
            "extraction_method": "worldbank_csv_adapter",
            "docling_score": 1.0,
            "final_score": 1.0,
            "needs_review": False,
            "rows": [TABLE_HEADERS] + data_rows
        })
        
        # 2. Section for tiered JSON (Multi-Tier Security Architecture)
        tiered_sections.append({
            "title": sec_title,
            "tier": tier,
            "needs_review": False,
            "start_page": page_num,
            "end_page": page_num,
            "elements": [
                {
                    "type": "text",
                    "label": "paragraph",
                    "page": page_num,
                    "tier": tier,
                    "content": meta_paragraph
                },
                {
                    "type": "table",
                    "table_id": table_id,
                    "page": page_num,
                    "tier": tier,
                    "needs_review": False,
                    "rows": [TABLE_HEADERS] + data_rows
                }
            ]
        })
        
    structured_json = {
        "document": {
            "name": doc_name,
            "pages": len(all_sections_data),
            "processed_range": "1-end"
        },
        "elements": structured_elements
    }
    
    tiered_json = {
        "document": {
            "name": doc_name,
            "pages": len(all_sections_data),
            "processed_range": "1-end"
        },
        "sections": tiered_sections
    }
    
    return structured_json, tiered_json

def print_validation_report(csv_files, all_sections_data, tiered_json):
    countries = set()
    indicators = set()
    total_data_rows = 0
    
    tier_counts = {1: 0, 2: 0, 3: 0}
    needs_review_count = 0
    
    for item in all_sections_data:
        countries.add(item["country"])
        indicators.add(item["indicator"])
        total_data_rows += len(item["data_rows"])
        
    for sec in tiered_json.get("sections", []):
        t = sec.get("tier", 3)
        tier_counts[t] = tier_counts.get(t, 0) + 1
        if sec.get("needs_review", False):
            needs_review_count += 1
        for el in sec.get("elements", []):
            if el.get("type") == "table":
                if el.get("needs_review", False):
                    needs_review_count += 1

    print("\n" + "="*55)
    print("       WORLDBANK INGESTION VALIDATION REPORT       ")
    print("="*55)
    print(f"Number of CSV files   : {len(csv_files)}")
    print(f"Number of Countries   : {len(countries)}")
    print(f"Number of Indicators  : {len(indicators)}")
    print(f"Number of Data Rows   : {total_data_rows}")
    print(f"Number of Sections    : {len(tiered_json.get('sections', []))}")
    print(f"Number of Tables      : {len(tiered_json.get('sections', []))}")
    print(f"Tier 1 Sections       : {tier_counts.get(1, 0)} (Debt, Military, Poverty)")
    print(f"Tier 2 Sections       : {tier_counts.get(2, 0)} (Jobs, Health, School, Power)")
    print(f"Tier 3 Sections       : {tier_counts.get(3, 0)} (GDP, Pop, Life, Net, CPI)")
    print(f"Needs Review Count    : {needs_review_count}")
    print("="*55)

def main():
    parser = argparse.ArgumentParser(description="World Bank CSV Ingestion Adapter")
    parser.add_argument("--input-dir", default="data/worldbank", help="Directory containing World Bank CSV files")
    parser.add_argument("--output-structured", default="output/worldbank_structured.json", help="Path for structured JSON")
    parser.add_argument("--output-tiered", default="output/worldbank_tiered.json", help="Path for tiered JSON")
    parser.add_argument("--doc-name", default="worldbank_data.csv", help="Document name identifier")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    out_struct_path = Path(args.output_structured)
    out_tiered_path = Path(args.output_tiered)
    
    out_struct_path.parent.mkdir(parents=True, exist_ok=True)
    out_tiered_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"Error: Directory '{input_dir}' does not exist.")
        sys.exit(1)

    csv_files = sorted(list(input_dir.rglob("*.csv")))
    if not csv_files:
        print(f"No CSV files found in '{input_dir}'.")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV file(s) in {input_dir}:")
    for f in csv_files:
        print(f"  - {f.name}")

    all_sections_data = []
    for csv_file in csv_files:
        _, _, sections = parse_worldbank_csv(csv_file)
        all_sections_data.extend(sections)

    structured_json, tiered_json = build_structured_and_tiered(all_sections_data, doc_name=args.doc_name)

    with open(out_struct_path, 'w', encoding='utf-8') as f:
        json.dump(structured_json, f, indent=2)
    print(f"\nGenerated structured JSON -> {out_struct_path}")

    with open(out_tiered_path, 'w', encoding='utf-8') as f:
        json.dump(tiered_json, f, indent=2)
    print(f"Generated tiered JSON     -> {out_tiered_path}")

    print_validation_report(csv_files, all_sections_data, tiered_json)

if __name__ == "__main__":
    main()

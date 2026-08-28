import json
import psycopg2
import sys
import re

DB_DSN = "postgresql://postgres:root@localhost:5432/secondbrain"

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
    if len(sys.argv) < 2:
        print("Usage: python import_to_db.py <json_path>")
        sys.exit(1)
        
    json_path = sys.argv[1]
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    doc_name = data['document']['name']
    
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()
    
    # 1. Ensure document exists in documents table
    cur.execute("SELECT id FROM documents WHERE filename = %s", (doc_name,))
    row = cur.fetchone()
    if row:
        doc_id = row[0]
        print(f"Found existing document ID: {doc_id}")
    else:
        cur.execute(
            "INSERT INTO documents (filename, filepath, filetype, content) VALUES (%s, %s, %s, %s) RETURNING id",
            (doc_name, f"imported/{doc_name}", "pdf", "Structured JSON content ingested.")
        )
        doc_id = cur.fetchone()[0]
        print(f"Created new document ID: {doc_id}")
        
    # Clear old sections/tables for this doc if re-running
    cur.execute("DELETE FROM document_sections WHERE document_id = %s", (doc_id,))
    
    current_section_title = "General"
    current_tier, current_review = 2, True
    current_section_content = []
    current_start_page = 1
    current_end_page = 1
    
    sections_inserted = 0
    tables_inserted = 0
    
    def save_section():
        nonlocal sections_inserted
        if not current_section_content: return None
        text_content = "\\n".join(current_section_content)
        cur.execute(
            '''INSERT INTO document_sections 
               (document_id, section_title, tier, content, start_page, end_page, ordering_index, needs_review)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
            (doc_id, current_section_title, current_tier, text_content, current_start_page, current_end_page, sections_inserted, current_review)
        )
        sec_id = cur.fetchone()[0]
        sections_inserted += 1
        return sec_id

    # We need to buffer elements because tables need to be linked to the saved section ID.
    # A better approach: build sections in memory, then insert.
    
    class Section:
        def __init__(self, title, start_page):
            self.title = title
            self.tier, self.needs_review = determine_tier(title)
            self.start_page = start_page
            self.end_page = start_page
            self.content_lines = []
            self.tables = []

    sections = []
    current_sec = Section("General", 1)
    
    for el in data['elements']:
        page = el.get('page', current_sec.end_page)
        current_sec.end_page = max(current_sec.end_page, page)
        
        if el['type'] == 'text':
            if el.get('label') in ['title', 'section_header']:
                if current_sec.content_lines or current_sec.tables:
                    sections.append(current_sec)
                current_sec = Section(el['content'], page)
            else:
                current_sec.content_lines.append(el['content'])
        elif el['type'] == 'table':
            current_sec.tables.append(el)
            
    if current_sec.content_lines or current_sec.tables:
        sections.append(current_sec)
        
    needs_review_count = 0
        
    for i, sec in enumerate(sections):
        text_content = "\\n".join(sec.content_lines)
        if sec.needs_review:
            needs_review_count += 1
            
        cur.execute(
            '''INSERT INTO document_sections 
               (document_id, section_title, tier, content, start_page, end_page, ordering_index, needs_review)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
            (doc_id, sec.title, sec.tier, text_content, sec.start_page, sec.end_page, i, sec.needs_review)
        )
        sec_id = cur.fetchone()[0]
        
        for t in sec.tables:
            is_review = t.get('needs_review', False)
            if is_review:
                needs_review_count += 1
                
            headers = t['rows'][0] if t['rows'] else []
            rows = t['rows'][1:] if len(t['rows']) > 1 else []
            
            cur.execute(
                '''INSERT INTO document_tables
                   (document_id, section_id, table_title, tier, page, headers, rows, needs_review)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)''',
                (doc_id, sec_id, f"Table {t.get('table_id')}", sec.tier, t.get('page'), json.dumps(headers), json.dumps(rows), is_review)
            )
            tables_inserted += 1

    conn.commit()
    conn.close()
    
    print("INGESTION COMPLETE")
    print(f"Documents imported: 1")
    print(f"Sections imported: {len(sections)}")
    print(f"Tables imported: {tables_inserted}")
    print(f"Needs Review items: {needs_review_count}")
    
if __name__ == '__main__':
    main()

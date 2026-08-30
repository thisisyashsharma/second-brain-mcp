import os
import json
import psycopg2
import sys

DEFAULT_DSN = "postgresql://postgres:root@localhost:5432/secondbrain"

def main():
    if len(sys.argv) < 2:
        print("Usage: python ingestion/import_to_db.py <tiered_json_path> [optional_db_url]")
        sys.exit(1)
        
    json_path = sys.argv[1]
    db_dsn = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("DATABASE_URL", DEFAULT_DSN)
    
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    doc_name = data['document']['name']
    
    print(f"Connecting to database: {db_dsn.split('@')[-1] if '@' in db_dsn else 'localhost'}...")
    conn = psycopg2.connect(db_dsn)
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
    
    sections_inserted = 0
    tables_inserted = 0
    needs_review_count = 0
    
    sections = data.get('sections', [])
        
    for i, sec in enumerate(sections):
        # Extract text elements for section content
        content_lines = [el['content'] for el in sec.get('elements', []) if el.get('type') == 'text']
        text_content = "\n".join(content_lines)
        
        tier = sec.get('tier', 2)
        needs_review = sec.get('needs_review', True)
        
        if needs_review:
            needs_review_count += 1
            
        cur.execute(
            '''INSERT INTO document_sections 
               (document_id, section_title, tier, content, start_page, end_page, ordering_index, needs_review)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
            (doc_id, sec.get('title', 'Unknown'), tier, text_content, sec.get('start_page', 1), sec.get('end_page', 1), i, needs_review)
        )
        sec_id = cur.fetchone()[0]
        sections_inserted += 1
        
        tables = [el for el in sec.get('elements', []) if el.get('type') == 'table']
        for t in tables:
            is_review = t.get('needs_review', False) or needs_review
            if is_review:
                needs_review_count += 1
                
            headers = t.get('rows', [])[0] if t.get('rows') else []
            rows = t.get('rows', [])[1:] if len(t.get('rows', [])) > 1 else []
            
            # Use the table's explicit tier if available, otherwise fallback to section tier
            t_tier = t.get('tier', tier)
            
            cur.execute(
                '''INSERT INTO document_tables
                   (document_id, section_id, table_title, tier, page, headers, rows, needs_review)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)''',
                (doc_id, sec_id, f"Table {t.get('table_id', 'unknown')}", t_tier, t.get('page', sec.get('start_page', 1)), json.dumps(headers), json.dumps(rows), is_review)
            )
            tables_inserted += 1

    conn.commit()
    conn.close()
    
    print("INGESTION COMPLETE")
    print(f"Documents imported: 1")
    print(f"Sections imported: {sections_inserted}")
    print(f"Tables imported: {tables_inserted}")
    print(f"Needs Review items: {needs_review_count}")
    
if __name__ == '__main__':
    main()

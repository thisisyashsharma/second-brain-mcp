import psycopg2

DB_DSN = "postgresql://postgres:root@localhost:5432/secondbrain"

try:
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()

    print("=== DOCUMENTS ===")
    cur.execute("SELECT id, filename, filepath FROM documents WHERE filename LIKE '%Zomato%'")
    docs = cur.fetchall()
    doc_ids = []
    for doc in docs:
        print(f"ID: {doc[0]} | Filename: {doc[1]} | Filepath: {doc[2]}")
        doc_ids.append(doc[0])
        
    print("\n=== SECTIONS ===")
    for doc_id in doc_ids:
        cur.execute("SELECT count(*), tier FROM document_sections WHERE document_id = %s GROUP BY tier", (doc_id,))
        sec_counts = cur.fetchall()
        print(f"Doc ID {doc_id} Sections by Tier:")
        for count, tier in sec_counts:
            print(f"  Tier {tier}: {count}")
            
    print("\n=== TABLES ===")
    for doc_id in doc_ids:
        cur.execute("SELECT count(*), tier FROM document_tables WHERE document_id = %s GROUP BY tier", (doc_id,))
        tbl_counts = cur.fetchall()
        print(f"Doc ID {doc_id} Tables by Tier:")
        for count, tier in tbl_counts:
            print(f"  Tier {tier}: {count}")

    conn.close()
except Exception as e:
    print("Database Error:", e)

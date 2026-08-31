import sys
import json
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def wipe_and_deploy(db_url):
    print(f"\n=======================================================")
    print(f"       RENDER POSTGRESQL CLEAN WIPE & DEPLOYMENT       ")
    print(f"=======================================================")
    
    print(f"\n1. Connecting to Render PostgreSQL...")
    conn = psycopg2.connect(db_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()

    print("2. Completely wiping old schema and all old tables (CASCADE)...")
    cur.execute("DROP SCHEMA public CASCADE;")
    cur.execute("CREATE SCHEMA public;")
    cur.execute("GRANT ALL ON SCHEMA public TO public;")
    print("   [OK] Render database is 100% clean and empty.")

    print("\n3. Creating fresh schema from backend/schema.sql...")
    with open("backend/schema.sql", "r", encoding="utf-8") as f:
        schema_sql = f.read()
    cur.execute(schema_sql)
    print("   [OK] Created all 6 tables and indexes.")

    print("\n4. Ingesting fresh 3-Tier World Bank data...")
    with open("output/worldbank_tiered.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    doc_name = data["document"]["name"]
    cur.execute(
        "INSERT INTO documents (filename, filepath, filetype, content) VALUES (%s, %s, %s, %s) RETURNING id",
        (doc_name, f"imported/{doc_name}", "csv", "World Bank Multi-Tier WDI Dataset")
    )
    doc_id = cur.fetchone()[0]

    sec_count = 0
    tbl_count = 0

    for idx, sec in enumerate(data.get("sections", [])):
        cur.execute(
            """INSERT INTO document_sections 
               (document_id, section_title, tier, content, start_page, end_page, ordering_index, needs_review)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (
                doc_id,
                sec.get("title"),
                sec.get("tier", 3),
                sec.get("elements", [{}])[0].get("content", ""),
                sec.get("start_page"),
                sec.get("end_page"),
                idx + 1,
                sec.get("needs_review", False)
            )
        )
        sec_id = cur.fetchone()[0]
        sec_count += 1

        for el in sec.get("elements", []):
            if el.get("type") == "table":
                rows_data = el.get("rows", [])
                headers = rows_data[0] if rows_data else []
                data_rows = rows_data[1:] if len(rows_data) > 1 else []
                cur.execute(
                    """INSERT INTO document_tables 
                       (document_id, section_id, table_title, tier, page, headers, rows, needs_review)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        doc_id,
                        sec_id,
                        f"Table {el.get('table_id', '')}",
                        el.get("tier", sec.get("tier", 3)),
                        el.get("page"),
                        json.dumps(headers),
                        json.dumps(data_rows),
                        el.get("needs_review", False)
                    )
                )
                tbl_count += 1

    print(f"   [OK] Successfully imported {sec_count} sections and {tbl_count} tables.")

    print("\n5. Verifying Render Database Row Counts by Tier:")
    cur.execute("SELECT tier, count(*) FROM document_sections GROUP BY tier ORDER BY tier;")
    for r in cur.fetchall():
        print(f"   - Tier {r[0]}: {r[1]} sections")

    conn.close()
    print("\n=======================================================")
    print("  RENDER POSTGRESQL IS FULLY CLEANED & REDEPLOYED!  ")
    print("=======================================================\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/wipe_and_deploy_render.py <RENDER_EXTERNAL_DATABASE_URL>")
        sys.exit(1)
    wipe_and_deploy(sys.argv[1])

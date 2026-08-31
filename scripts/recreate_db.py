import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

DEFAULT_ADMIN_URL = "postgresql://postgres:root@localhost:5432/postgres"
DEFAULT_TARGET_URL = "postgresql://postgres:root@localhost:5432/secondbrain"

def recreate_db():
    print("Connecting to postgres admin database...")
    admin_conn = psycopg2.connect(DEFAULT_ADMIN_URL)
    admin_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = admin_conn.cursor()

    print("Terminating existing connections to secondbrain...")
    cur.execute("""
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = 'secondbrain' AND pid <> pg_backend_pid();
    """)

    print("Dropping database secondbrain...")
    cur.execute("DROP DATABASE IF EXISTS secondbrain;")

    print("Creating fresh database secondbrain...")
    cur.execute("CREATE DATABASE secondbrain;")
    admin_conn.close()
    print("Database secondbrain created cleanly.")

    print("Applying backend/schema.sql...")
    sb_conn = psycopg2.connect(DEFAULT_TARGET_URL)
    sb_cur = sb_conn.cursor()

    with open("backend/schema.sql", "r", encoding="utf-8") as f:
        schema_sql = f.read()

    sb_cur.execute(schema_sql)
    sb_conn.commit()

    sb_cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
    """)
    tables = [r[0] for r in sb_cur.fetchall()]
    print("Verified created tables:", tables)
    sb_conn.close()

if __name__ == "__main__":
    recreate_db()

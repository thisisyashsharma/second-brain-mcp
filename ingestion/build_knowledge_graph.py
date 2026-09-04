import os
import json
import psycopg2
import re
from psycopg2.extras import execute_values

DB_DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:root@localhost:5432/secondbrain")

CORE_CONCEPTS = [
    # Tier 3 Public Concepts
    {
        "name": "Digital Economy Transformation",
        "slug": "digital-economy-transformation",
        "type": "concept",
        "tier": 3,
        "summary": "Macroeconomic transformation driven by rapid expansion of internet penetration exceeding 60% of population.",
        "content": """# Concept: Digital Economy Transformation
## Definition
The structural shift in an economy resulting from widespread adoption of internet technologies, digital payments, and information networks.

## Measurement & Indicators
* Primary Indicator: `IT.NET.USER.ZS` (Individuals using the Internet % of population).
* Spillover: Accelerates productivity, financial inclusion, and services exports.
* Threshold Milestone: Penetration crossing 60% typically transitions economies into high-velocity digital services growth.""",
        "metadata": {"tier": 3, "category": "digital_infrastructure", "primary_indicator": "IT.NET.USER.ZS"}
    },
    {
        "name": "Disinflation & Price Stabilization",
        "slug": "disinflation-price-stabilization",
        "type": "concept",
        "tier": 3,
        "summary": "Monetary cooling trajectory where annual consumer price inflation recedes toward target central bank bands.",
        "content": """# Concept: Disinflation & Price Stabilization
## Definition
The slowing of the pace of price inflation. Unlike deflation (where prices fall), disinflation describes prices rising at a noticeably slower rate.

## Measurement & Indicators
* Primary Indicator: `FP.CPI.TOTL.ZG` (Inflation, consumer prices annual %).
* Post-2022 Context: Global supply chain normalization and interest rate tightening produced rapid disinflation across major economies from 2022 peaks.""",
        "metadata": {"tier": 3, "category": "monetary_economics", "primary_indicator": "FP.CPI.TOTL.ZG"}
    },
    {
        "name": "Demographic Longevity & Rebound",
        "slug": "demographic-longevity-rebound",
        "type": "concept",
        "tier": 3,
        "summary": "National life expectancy recovery and long-term upward trajectory reflecting healthcare resilience.",
        "content": """# Concept: Demographic Longevity & Rebound
## Definition
The overall mortality and demographic health profile of a nation measured by life expectancy at birth.

## Measurement & Indicators
* Primary Indicator: `SP.DYN.LE00.IN` (Life expectancy at birth, total years).
* Post-Pandemic Dynamic: Most global economies experienced sharp life expectancy dips in 2020-2021 followed by significant multi-year rebounds in 2022-2024.""",
        "metadata": {"tier": 3, "category": "demographics", "primary_indicator": "SP.DYN.LE00.IN"}
    },
    {
        "name": "Macroeconomic Output Expansion (GDP)",
        "slug": "macroeconomic-output-expansion-gdp",
        "type": "concept",
        "tier": 3,
        "summary": "Nominal gross domestic product growth reflecting aggregate economic scale and output value.",
        "content": """# Concept: Macroeconomic Output Expansion (GDP)
## Definition
The total monetary or market value of all finished goods and services produced within a country's borders in a specific time period.

## Measurement & Indicators
* Primary Indicator: `NY.GDP.MKTP.CD` (GDP current US$).
* Core Role: Serves as the primary denominator for sovereign leverage, defense intensity, and per-capita spending comparisons.""",
        "metadata": {"tier": 3, "category": "macroeconomics", "primary_indicator": "NY.GDP.MKTP.CD"}
    },

    # Tier 2 Operational Concepts
    {
        "name": "Universal Electrification",
        "slug": "universal-electrification",
        "type": "concept",
        "tier": 2,
        "summary": "Critical infrastructure milestone where 99%+ of a nation's population gains reliable access to electricity.",
        "content": """# Concept: Universal Electrification
## Definition
A fundamental developmental baseline where household electrification reaches universal or near-universal coverage (>= 99.0%).

## Measurement & Indicators
* Primary Indicator: `EG.ELC.ACCS.ZS` (Access to electricity % of population).
* Significance: Prerequisite for mechanized manufacturing, modern healthcare delivery, digital connectivity, and educational outcomes.""",
        "metadata": {"tier": 2, "category": "infrastructure", "primary_indicator": "EG.ELC.ACCS.ZS"}
    },
    {
        "name": "Human Capital & Healthcare Investment",
        "slug": "human-capital-healthcare-investment",
        "type": "concept",
        "tier": 2,
        "summary": "National public spending allocation toward healthcare delivery per capita and education share of GDP.",
        "content": """# Concept: Human Capital & Healthcare Investment
## Definition
The resource intensity committed by the public and private sectors toward health and educational development of citizens.

## Measurement & Indicators
* Healthcare: `SH.XPD.CHEX.PC.CD` (Current health expenditure per capita current US$).
* Education: `SE.XPD.TOTL.GD.ZS` (Government expenditure on education % of GDP).
* Cross-Country Disparity: Disparity between advanced and developing nations often exceeds a 10x ratio in per-capita healthcare expenditure.""",
        "metadata": {"tier": 2, "category": "public_services", "primary_indicator": "SH.XPD.CHEX.PC.CD"}
    },
    {
        "name": "Labor Market Stability & Employment",
        "slug": "labor-market-stability-employment",
        "type": "concept",
        "tier": 2,
        "summary": "Health of the national workforce measured by modeled unemployment rates and labor capacity utilization.",
        "content": """# Concept: Labor Market Stability & Employment
## Definition
The degree to which an economy utilizes its available labor force, distinguishing between frictional, cyclical, and structural unemployment.

## Measurement & Indicators
* Primary Indicator: `SL.UEM.TOTL.ZS` (Unemployment, total % of total labor force, modeled ILO estimate).
* Thresholds: Sub-5% indicates full employment; >25% reflects severe structural crises.""",
        "metadata": {"tier": 2, "category": "labor_market", "primary_indicator": "SL.UEM.TOTL.ZS"}
    },

    # Tier 1 Sensitive Concepts
    {
        "name": "Sovereign External Debt De-leveraging",
        "slug": "sovereign-external-debt-deleveraging",
        "type": "concept",
        "tier": 1,
        "summary": "Balance-of-payments trajectory where sovereign foreign liabilities are actively amortized and reduced.",
        "content": """# Concept: Sovereign External Debt De-leveraging
## Definition
The reduction of external debt stocks owed to non-residents (foreign banks, multilateral institutions, international bondholders).

## Measurement & Indicators
* Primary Indicator: `DT.DOD.DECT.CD` (External debt stocks, total DOD, current US$).
* Strategic Implication: De-leveraging mitigates foreign exchange vulnerability and sovereign default risk, while expansion fuels domestic investment at the cost of higher interest rate exposure.""",
        "metadata": {"tier": 1, "category": "sovereign_debt", "primary_indicator": "DT.DOD.DECT.CD"}
    },
    {
        "name": "Military Expenditure Burden",
        "slug": "military-expenditure-burden",
        "type": "concept",
        "tier": 1,
        "summary": "Sovereign defense resource allocation as a share of total economic output, reflecting geopolitical posture.",
        "content": """# Concept: Military Expenditure Burden
## Definition
The proportion of a nation's Gross Domestic Product devoted to defense, armed forces, weapons procurement, and military personnel.

## Measurement & Indicators
* Primary Indicator: `MS.MIL.XPND.GD.ZS` (Military expenditure % of GDP).
* Geopolitical Benchmark: NATO 2.0% of GDP guideline; rapid budget shifts signal strategic posture changes.""",
        "metadata": {"tier": 1, "category": "defense_geopolitics", "primary_indicator": "MS.MIL.XPND.GD.ZS"}
    },
    {
        "name": "National Poverty Headcount & Vulnerability",
        "slug": "national-poverty-headcount-vulnerability",
        "type": "concept",
        "tier": 1,
        "summary": "National poverty line incidence measuring acute household financial vulnerability and basic needs deficit.",
        "content": """# Concept: National Poverty Headcount & Vulnerability
## Definition
The percentage of the population living below the official national poverty line established by sovereign authorities.

## Measurement & Indicators
* Primary Indicator: `SI.POV.NAHC` (Poverty headcount ratio at national poverty lines % of population).
* Policy Impact: Key benchmark for social safety net targeting and multilateral development assistance.""",
        "metadata": {"tier": 1, "category": "poverty_welfare", "primary_indicator": "SI.POV.NAHC"}
    }
]

CONCEPT_RELATIONSHIPS = [
    # Concept -> Concept Causal & Structural Edges
    ("universal-electrification", "digital-economy-transformation", "CATALYZES", 2, {"description": "Electrification is a foundational prerequisite for digital infrastructure adoption."}),
    ("digital-economy-transformation", "macroeconomic-output-expansion-gdp", "EXPANDS_OUTPUT", 3, {"description": "Digitalization drives high-margin services exports and boosts nominal GDP growth."}),
    ("human-capital-healthcare-investment", "demographic-longevity-rebound", "PROMOTES", 2, {"description": "Per-capita healthcare expenditure strongly correlates with life expectancy gains."}),
    ("disinflation-price-stabilization", "labor-market-stability-employment", "SUPPORTS", 2, {"description": "Stable price levels preserve real wages and support employment predictability."}),
    ("universal-electrification", "national-poverty-headcount-vulnerability", "REDUCES_RISK_OF", 1, {"description": "Access to power directly enables micro-enterprise productivity, lowering poverty."}),
    ("military-expenditure-burden", "human-capital-healthcare-investment", "COMPETES_FOR_BUDGET", 1, {"description": "High defense budget allocation can crowd out healthcare and educational public capital."}),
    ("sovereign-external-debt-deleveraging", "disinflation-price-stabilization", "STABILIZES", 1, {"description": "Lower external debt burdens stabilize currency value and temper imported inflation."}),

    # Entity -> Concept Milestones
    ("entity-india", "universal-electrification", "ACHIEVED_MILESTONE", 2, {"status": "99.9% in 2024", "detail": "Universal access milestone attained."}),
    ("entity-india", "digital-economy-transformation", "RAPID_SCALING", 3, {"status": "70.0% in 2025", "detail": "Accelerating internet adoption (+14.1pp over 4 years)."}),
    ("entity-india", "macroeconomic-output-expansion-gdp", "EXPANDING_RAPIDLY", 3, {"status": "$3.76T in 2024", "detail": "Nominal GDP expansion of +$511B in 2 years."}),

    ("entity-united-states", "human-capital-healthcare-investment", "HIGHEST_PER_CAPITA", 2, {"status": "$13,473/capita in 2023", "detail": "Global leader in nominal per-capita health spending."}),
    ("entity-united-states", "macroeconomic-output-expansion-gdp", "LARGEST_ECONOMY", 3, {"status": "$29.3T in 2024", "detail": "Dominant global economic output."}),
    ("entity-united-states", "military-expenditure-burden", "HIGH_INTENSITY", 1, {"status": "3.42% of GDP in 2024", "detail": "Significant defense allocation."}),

    ("entity-china", "sovereign-external-debt-deleveraging", "ACTIVE_DELEVERAGING", 1, {"status": "-$304.5B from 2021-2024", "detail": "Substantial reduction in foreign liabilities."}),
    ("entity-china", "macroeconomic-output-expansion-gdp", "SECOND_LARGEST", 3, {"status": "$18.73T in 2024", "detail": "Second largest global economy."}),
    ("entity-china", "military-expenditure-burden", "MODERATE_INTENSITY", 1, {"status": "1.71% of GDP in 2024", "detail": "Steady defense share of output."}),

    ("entity-germany", "military-expenditure-burden", "RAPID_SURGE", 1, {"status": "1.89% in 2024 vs 1.30% in 2021", "detail": "Sharp geopolitical budget acceleration toward NATO 2% goal."}),
    ("entity-germany", "human-capital-healthcare-investment", "EFFICIENT_SPENDING", 2, {"status": "$6,394/capita in 2023", "detail": "Universal healthcare at less than half of US per-capita cost."}),

    ("entity-south-africa", "labor-market-stability-employment", "STRUCTURAL_CRISIS", 2, {"status": "32.28% in 2024", "detail": "Severe structural unemployment challenge."})
]

def build_knowledge_graph():
    print("=" * 65)
    print("       BUILDING SECOND BRAIN ENTITIES & KNOWLEDGE GRAPH       ")
    print("=" * 65)
    
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()

    # 1. Clean existing concepts and relationships
    print("\n1. Clearing existing wiki_relationships and wiki_concepts...")
    cur.execute("TRUNCATE wiki_relationships, wiki_sources, wiki_concepts RESTART IDENTITY CASCADE;")
    conn.commit()

    # 2. Extract Entities (Countries & Blocs) from document_sections
    print("2. Extracting sovereign entities from World Bank indexed sections...")
    cur.execute("""
        SELECT DISTINCT 
            substring(section_title from 'World Bank: (.*?) - ') as country
        FROM document_sections
        WHERE section_title LIKE 'World Bank: % - %'
        ORDER BY country;
    """)
    raw_countries = [r[0] for r in cur.fetchall() if r[0]]
    print(f"   Found {len(raw_countries)} distinct countries/entities.")

    # Also map country codes from tables
    cur.execute("""
        SELECT DISTINCT
            r->>2 as country_name,
            r->>3 as country_code
        FROM document_tables dt,
        jsonb_array_elements(dt.rows) as r
        WHERE r->>2 IS NOT NULL AND r->>3 IS NOT NULL AND length(r->>3) = 3;
    """)
    code_map = {r[0]: r[1] for r in cur.fetchall()}

    entity_records = []
    seen_slugs = set()
    for c in raw_countries:
        c_code = code_map.get(c, "")
        clean_name_slug = re.sub(r'[^a-zA-Z0-9]+', '-', c).strip('-').lower()
        slug = f"entity-{clean_name_slug}"
        if slug in seen_slugs:
            slug = f"{slug}-{c_code.lower()}" if c_code else f"{slug}-alt"
        seen_slugs.add(slug)

        summary = f"Sovereign nation / economic entity '{c}' indexed in the Second Brain World Bank dataset."
        content = f"""# Entity: {c}
* **Country Code**: `{c_code or 'N/A'}`
* **Entity Classification**: Sovereign Country / Regional Aggregate
* **Primary Data Source**: World Bank World Development Indicators (WDI)
* **Security Model**: Indicators and correlations are filtered dynamically according to authorized security tier (Tier 1 Audited, Tier 2 Operations, Tier 3 Public)."""
        metadata = json.dumps({
            "entity_type": "country",
            "country_code": c_code,
            "name": c,
            "is_entity": True
        })
        entity_records.append((c, slug, summary, content, "entity", 3, metadata))

    # Insert Entities in bulk
    insert_concept_sql = """
        INSERT INTO wiki_concepts (name, slug, summary, content, type, tier, metadata)
        VALUES %s
    """
    execute_values(cur, insert_concept_sql, entity_records)
    conn.commit()
    print(f"   [OK] Successfully inserted {len(entity_records)} Entity nodes into wiki_concepts.")

    # 3. Insert Core Macroeconomic Concepts
    print("\n3. Inserting foundational Macroeconomic Concepts...")
    concept_records = []
    for c in CORE_CONCEPTS:
        concept_records.append((
            c["name"],
            c["slug"],
            c["summary"],
            c["content"],
            c["type"],
            c["tier"],
            json.dumps(c["metadata"])
        ))
    execute_values(cur, insert_concept_sql, concept_records)
    conn.commit()
    print(f"   [OK] Successfully inserted {len(concept_records)} Macroeconomic Concepts into wiki_concepts.")

    # Fetch concept ID lookup map
    cur.execute("SELECT slug, id FROM wiki_concepts;")
    slug_to_id = {r[0]: r[1] for r in cur.fetchall()}

    # 4. Insert Graph Relationships & Edges
    print("\n4. Constructing semantic graph edges and correlation links...")
    rel_records = []
    skipped = 0

    for src_slug, tgt_slug, rel_type, tier, meta in CONCEPT_RELATIONSHIPS:
        src_id = slug_to_id.get(src_slug)
        tgt_id = slug_to_id.get(tgt_slug)
        if src_id and tgt_id:
            rel_records.append((src_id, tgt_id, rel_type, tier, json.dumps(meta)))
        else:
            skipped += 1

    insert_rel_sql = """
        INSERT INTO wiki_relationships (source_concept_id, target_concept_id, relationship, tier, metadata)
        VALUES %s
        ON CONFLICT (source_concept_id, target_concept_id, relationship) DO NOTHING;
    """
    execute_values(cur, insert_rel_sql, rel_records)
    conn.commit()
    print(f"   [OK] Inserted {len(rel_records)} graph edges into wiki_relationships ({skipped} skipped).")

    # 5. Link Concepts to Source Document in wiki_sources
    print("\n5. Linking concepts to primary World Bank source document...")
    cur.execute("SELECT id FROM documents LIMIT 1;")
    doc_row = cur.fetchone()
    if doc_row:
        doc_id = doc_row[0]
        cur.execute("""
            INSERT INTO wiki_sources (concept_id, document_id, relationship_type)
            SELECT id, %s, 'derived_from' FROM wiki_concepts
            ON CONFLICT DO NOTHING;
        """, (doc_id,))
        conn.commit()
        print(f"   [OK] Linked all concepts to document ID {doc_id}.")

    # 6. Verification Summary
    cur.execute("SELECT count(*) FROM wiki_concepts WHERE type = 'entity';")
    entity_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM wiki_concepts WHERE type = 'concept';")
    concept_count = cur.fetchone()[0]
    cur.execute("SELECT tier, count(*) FROM wiki_relationships GROUP BY tier ORDER BY tier;")
    rel_counts = cur.fetchall()

    print("\n" + "=" * 65)
    print("           KNOWLEDGE GRAPH BUILD COMPLETE           ")
    print("=" * 65)
    print(f"Total Entity Nodes (type: entity)  : {entity_count}")
    print(f"Total Concept Nodes (type: concept): {concept_count}")
    print("Relationships by Security Tier:")
    for r in rel_counts:
        print(f"  - Tier {r[0]}: {r[1]} edges")
    print("=" * 65 + "\n")

    conn.close()

if __name__ == "__main__":
    build_knowledge_graph()

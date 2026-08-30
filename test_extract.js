const fs = require('fs');
const data = JSON.parse(fs.readFileSync('output/Zomato_Annual_Report_2023-24_structured.json', 'utf8'));

let currentSection = "General";
for (const el of data.elements || []) {
    if (el.type === 'section_header') {
        currentSection = el.text;
    }
    if (el.type === 'table') {
        const rowsStr = JSON.stringify(el.rows);
        if (rowsStr.includes('Total liabilities') || rowsStr.includes('Borrowings') || rowsStr.includes('operating activities')) {
            console.log("MATCH in Section:", currentSection);
            console.log("Page:", el.page);
            console.log("Table ID:", el.table_id);
            console.log("Headers:", el.headers);
            for (const r of el.rows) {
                if (r.join(' ').includes('Total liabilities') || r.join(' ').includes('Borrowings') || r.join(' ').includes('operating activities')) {
                    console.log("Row Match:", r);
                }
            }
            console.log("------");
        }
    }
}

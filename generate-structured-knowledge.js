import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("./backend/node_modules/pdf-parse/lib/pdf-parse.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(__dirname, "test-brain/Finance/Eternals");
const outputDir = path.join(inputDir, "structured");

const TIER_1_KEYWORDS = ["company overview", "business overview", "company history", "products", "business segments", "strategy", "mission", "general organization", "management discussion"];
const TIER_2_KEYWORDS = ["revenue", "segment performance", "food delivery", "quick commerce", "hyperpure", "gov", "orders", "customer metrics", "operating kpis", "business performance"];
const TIER_3_KEYWORDS = ["financial statements", "balance sheet", "statement of profit", "cash flow", "total assets", "total liabilities", "borrowings", "loans", "lease liabilities", "accounting policies", "notes to accounts", "financial instruments", "auditor"];

function classifyTier(title) {
  const t = title.toLowerCase();
  for (const kw of TIER_3_KEYWORDS) if (t.includes(kw)) return 3;
  for (const kw of TIER_2_KEYWORDS) if (t.includes(kw)) return 2;
  for (const kw of TIER_1_KEYWORDS) if (t.includes(kw)) return 1;
  return 1; // default to Tier 1
}

function renderPage(pageData) {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false
  };
  return pageData.getTextContent(renderOptions).then(function(textContent) {
    let lastY, text = '';
    for (let item of textContent.items) {
      if (lastY == item.transform[5] || !lastY) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    return text;
  });
}

async function processPdf(filename) {
  const filePath = path.join(inputDir, filename);
  const dataBuffer = await fs.readFile(filePath);
  
  let currentPage = 1;
  const options = {
    pagerender: function(pageData) {
      const pageNum = currentPage++;
      return renderPage(pageData).then(text => `\n\n## Page ${pageNum}\n\n` + text);
    }
  };

  const data = await pdfParse(dataBuffer, options);
  
  let company = "Zomato";
  if (filename.toLowerCase().includes("eternal")) company = "Eternal";
  
  let fy = "Unknown";
  const fyMatch = filename.match(/20\d{2}-\d{2}/) || filename.match(/20\d{2}/);
  if (fyMatch) fy = fyMatch[0];

  const lines = data.text.split('\n');
  const sections = [];
  let currentSection = { title: "Introduction", tier: 1, page: 1, content: [] };
  let lastPage = 1;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Check for page markers
    const pageMatch = line.match(/^## Page (\d+)$/);
    if (pageMatch) {
      lastPage = parseInt(pageMatch[1], 10);
      currentSection.content.push(line);
      continue;
    }

    // Heuristic for section headings: short, all caps or title case, not ending in punctuation
    if (line.length > 3 && line.length < 60 && !line.match(/[.,;]$/) && (line === line.toUpperCase() || line.split(' ').every(w => w[0] === w[0]?.toUpperCase() || w.length <= 2))) {
      // It might be a heading. Let's check if it matches any tier keywords
      const t = line.toLowerCase();
      const isHeading = [...TIER_1_KEYWORDS, ...TIER_2_KEYWORDS, ...TIER_3_KEYWORDS].some(kw => t.includes(kw));
      
      if (isHeading) {
        sections.push(currentSection);
        currentSection = {
          title: line,
          tier: classifyTier(line),
          page: lastPage,
          content: [`# ${line}`]
        };
        continue;
      }
    }
    
    currentSection.content.push(line);
  }
  
  sections.push(currentSection);

  // Filter out empty introductory sections
  const validSections = sections.filter(s => s.content.join('').trim().length > 0);

  const markdownContent = `---
source_file: ${filename}
document_type: annual_report
company: ${company}
fiscal_year: ${fy}
source_format: pdf
---

${validSections.map(s => s.content.join('\n')).join('\n\n')}
`;

  const mdFilename = filename.replace(".pdf", ".md");
  await fs.writeFile(path.join(outputDir, mdFilename), markdownContent);
  
  return {
    source_file: filename,
    fiscal_year: fy,
    sections: validSections.map(s => ({ title: s.title, tier: s.tier, page: s.page }))
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const files = await fs.readdir(inputDir);
  const pdfs = files.filter(f => f.endsWith(".pdf"));
  
  const manifest = { documents: [] };
  
  for (const pdf of pdfs) {
    console.log(`Processing ${pdf}...`);
    try {
        const docManifest = await processPdf(pdf);
        manifest.documents.push(docManifest);
    } catch (err) {
        console.error(`Error processing ${pdf}:`, err);
    }
  }
  
  await fs.writeFile(path.join(outputDir, "tier-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Done.");
}

main().catch(console.error);

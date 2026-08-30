import fs from "fs";
import pdfParse from "pdf-parse";

async function testPdfParse() {
  const filePath = "test-brain/Finance/Eternals/Eternal_Annual_Report_2024-25.pdf";
  const dataBuffer = fs.readFileSync(filePath);

  const data = await pdfParse(dataBuffer, { max: 10 }); // parse first 10 pages
  console.log("=== METADATA ===");
  console.log(data.info);
  console.log("=== NUM PAGES ===");
  console.log(data.numpages);
  console.log("=== TEXT ===");
  console.log(data.text.substring(0, 1000));
}

testPdfParse().catch(console.error);

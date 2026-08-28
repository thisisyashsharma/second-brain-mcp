import fs from "fs/promises";
import path from "path";

/**
 * Get the file type from a filename extension.
 * Returns "md", "txt", "pdf", or null for unsupported types.
 */
export function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (["md", "markdown"].includes(ext)) return "md";
  if (["txt", "text"].includes(ext)) return "txt";
  if (ext === "pdf") return "pdf";
  return null;
}

/**
 * Extract text content from a file on disk.
 */
export async function extractText(filePath, filetype) {
  switch (filetype) {
    case "md":
    case "txt":
      return fs.readFile(filePath, "utf-8");
    case "pdf":
      return extractPdf(filePath);
    default:
      throw new Error(`Unsupported file type: ${filetype}`);
  }
}

/**
 * Extract text from a PDF file buffer (used during upload when file is in memory).
 */
export async function extractTextFromBuffer(buffer, filetype) {
  switch (filetype) {
    case "md":
    case "txt":
      return buffer.toString("utf-8");
    case "pdf":
      return extractPdfBuffer(buffer);
    default:
      throw new Error(`Unsupported file type: ${filetype}`);
  }
}

async function extractPdf(filePath) {
  const pdfParse = await loadPdfParse();
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return normalizePdfText(data.text || "");
}

async function extractPdfBuffer(buffer) {
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer);
  return normalizePdfText(data.text || "");
}

/**
 * Normalizes PDF extracted text:
 * - Fixes CR/LF to \n
 * - Trims whitespace-only lines
 * - Compresses horizontal spaces
 * - Compresses 3+ consecutive newlines to exactly 2 (preserving paragraph breaks)
 */
function normalizePdfText(text) {
  if (!text) return "";
  
  // 1. Normalize line endings
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // 2. Remove whitespace-only lines (leaves empty lines as just \n)
  normalized = normalized.replace(/^[ \t]+$/gm, "");
  
  // 3. Replace multiple horizontal spaces with a single space
  normalized = normalized.replace(/[ \t]{2,}/g, " ");
  
  // 4. Reduce repeated blank lines to a maximum of 2 newlines (preserves paragraphs/tables)
  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  
  return normalized.trim();
}

/** Lazy-load pdf-parse to avoid its test-file issue on import. */
let _pdfParse = null;
async function loadPdfParse() {
  if (!_pdfParse) {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    _pdfParse = mod.default;
  }
  return _pdfParse;
}

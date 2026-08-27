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
  return data.text || "";
}

async function extractPdfBuffer(buffer) {
  const pdfParse = await loadPdfParse();
  const data = await pdfParse(buffer);
  return data.text || "";
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

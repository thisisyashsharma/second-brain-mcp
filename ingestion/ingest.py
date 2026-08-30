import os
import sys
import json
import time
import argparse
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions

from ingestion.validator import validate_table
from ingestion.camelot_fallback import extract_table_with_camelot

def process_pdf(pdf_path, output_dir, page_range_str=None, debug=False):
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    final_output = output_dir / f"{pdf_path.stem}_structured.json"
    
    stats = {
        "total_pages": 0,
        "processing_time": 0,
        "tables_detected": 0,
        "docling_tables_accepted": 0,
        "tables_sent_to_camelot": 0,
        "lattice_successes": 0,
        "stream_successes": 0,
        "tables_marked_needs_review": 0,
        "final_extraction_success_rate": 0.0
    }
    
    start_time = time.time()
    
    import pymupdf
    try:
        with pymupdf.open(pdf_path) as p:
            total_pdf_pages = len(p)
    except Exception as e:
        logging.error(f"Could not open PDF with pymupdf: {e}")
        return

    stats["total_pages"] = total_pdf_pages
    
    output_elements = []
    
    if page_range_str:
        start_p, end_p = map(int, page_range_str.split("-"))
        page_chunks = [(start_p, min(end_p, total_pdf_pages))]
    else:
        chunk_size = 30
        page_chunks = [(s, min(s + chunk_size - 1, total_pdf_pages)) for s in range(1, total_pdf_pages + 1, chunk_size)]
    
    for start_page, end_page in page_chunks:
        chunk_docling_cache = output_dir / f"{pdf_path.stem}_docling_raw_{start_page}_{end_page}.json"
        
        doc = None
        if chunk_docling_cache.exists():
            logging.info(f"Loading cached Docling chunk {start_page}-{end_page}")
            from docling.datamodel.document import DoclingDocument
            try:
                with open(chunk_docling_cache, 'r', encoding='utf-8') as f:
                    doc = DoclingDocument.model_validate_json(f.read())
            except Exception as e:
                logging.warning(f"Failed to load cached docling chunk: {e}. Reprocessing.")
                doc = None
                
        if doc is None:
            logging.info(f"Starting Docling extraction for {pdf_path} (pages {start_page}-{end_page})...")
            
            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = False
            pipeline_options.do_table_structure = False
            pipeline_options.generate_page_images = False
            pipeline_options.generate_picture_images = False
            
            converter = DocumentConverter(
                allowed_formats=[InputFormat.PDF],
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
                }
            )
            
            conv_res = converter.convert(pdf_path, page_range=(start_page, end_page))
            doc = conv_res.document
            
            with open(chunk_docling_cache, 'w', encoding='utf-8') as f:
                f.write(doc.model_dump_json())
            logging.info(f"Saved Docling intermediate chunk to {chunk_docling_cache}")
            
        # 2. Iterate elements and validate tables
        for element, level in doc.iterate_items():
            if element.label == "table":
                stats["tables_detected"] += 1
                page_num = element.prov[0].page_no if element.prov else start_page
                
                # Extract docling grid
                docling_grid = []
                if hasattr(element, "data") and hasattr(element.data, "grid"):
                    table_data = element.export_to_dataframe()
                    docling_grid = [table_data.columns.tolist()] + table_data.fillna("").values.tolist()
                else:
                    docling_grid = []
                    
                score, needs_review, reasons = validate_table(docling_grid)
                
                final_grid = docling_grid
                extraction_method = "docling"
                final_score = score
                final_needs_review = needs_review
                
                if score < 0.75:
                    logging.info(f"Table on page {page_num} needs review (score={score:.2f}). Sent to Camelot. Reasons: {reasons}")
                    stats["tables_sent_to_camelot"] += 1
                    
                    cam_grid, cam_method = extract_table_with_camelot(pdf_path, page_num)
                    
                    if cam_grid:
                        cam_score, cam_needs_review, cam_reasons = validate_table(cam_grid)
                        if cam_score > score:
                            logging.info(f"Camelot ({cam_method}) produced a better table! (score: {cam_score:.2f} > {score:.2f})")
                            final_grid = cam_grid
                            extraction_method = f"camelot_{cam_method}"
                            final_score = cam_score
                            final_needs_review = cam_needs_review
                            
                            if cam_method == "lattice":
                                stats["lattice_successes"] += 1
                            else:
                                stats["stream_successes"] += 1
                        else:
                            logging.info(f"Camelot table was not better (score: {cam_score:.2f} <= {score:.2f}). Keeping Docling.")
                
                if extraction_method == "docling":
                    stats["docling_tables_accepted"] += 1
                    
                if final_needs_review:
                    stats["tables_marked_needs_review"] += 1
                    
                output_elements.append({
                    "type": "table",
                    "table_id": f"tbl_{page_num}_{stats['tables_detected']}",
                    "page": page_num,
                    "extraction_method": extraction_method,
                    "docling_score": score,
                    "final_score": final_score,
                    "needs_review": final_needs_review,
                    "rows": final_grid
                })
                
                if debug and final_needs_review:
                    debug_file = output_dir / f"debug_table_pg{page_num}_{stats['tables_detected']}.json"
                    with open(debug_file, 'w', encoding='utf-8') as f:
                        json.dump({
                            "docling_grid": docling_grid,
                            "docling_score": score,
                            "reasons": reasons,
                            "final_selected": final_grid
                        }, f, indent=2)
                    
            elif element.label in ["paragraph", "title", "section_header"]:
                page_num = element.prov[0].page_no if element.prov else start_page
                output_elements.append({
                    "type": "text",
                    "label": element.label,
                    "page": page_num,
                    "content": element.text
                })
            
    # Normalize output
    out_json = {
        "document": {
            "name": pdf_path.name,
            "pages": stats["total_pages"],
            "processed_range": page_range_str if page_range_str else "1-end"
        },
        "elements": output_elements
    }
    
    with open(final_output, 'w', encoding='utf-8') as f:
        json.dump(out_json, f, indent=2)
        
    stats["processing_time"] = time.time() - start_time
    stats["final_extraction_success_rate"] = 0.0
    if stats["tables_detected"] > 0:
        stats["final_extraction_success_rate"] = ((stats["tables_detected"] - stats["tables_marked_needs_review"]) / stats["tables_detected"]) * 100
        
    print("\n" + "="*50)
    print("INGESTION BENCHMARK REPORT")
    print("="*50)
    print(f"Total Pages Processed    : {stats['total_pages']} (Range: {page_range_str})")
    print(f"Total Processing Time    : {stats['processing_time']:.2f} seconds")
    print(f"Tables Detected          : {stats['tables_detected']}")
    print(f"Docling Tables Accepted  : {stats['docling_tables_accepted']}")
    print(f"Tables Sent to Camelot   : {stats['tables_sent_to_camelot']}")
    print(f"  -> Lattice Successes   : {stats['lattice_successes']}")
    print(f"  -> Stream Successes    : {stats['stream_successes']}")
    print(f"Tables Marked needs_review: {stats['tables_marked_needs_review']}")
    print(f"Final Success Rate       : {stats['final_extraction_success_rate']:.1f}%")
    print("="*50)
    print(f"Output saved to {final_output}")
    print("="*50)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PDF Ingestion Pipeline MVP")
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--output", default="./output", help="Output directory")
    parser.add_argument("--page-range", help="Optional page range to process, e.g. 155-184")
    parser.add_argument("--debug", action="store_true", help="Enable debug output for suspicious tables")
    args = parser.parse_args()
    
    process_pdf(args.pdf, args.output, args.page_range, args.debug)

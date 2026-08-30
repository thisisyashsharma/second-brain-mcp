import sys
import argparse
from pathlib import Path

def run_test(pdf_path):
    print(f"Testing minimal Docling on {pdf_path}")
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    print("Configuring pipeline...")
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False
    pipeline_options.do_table_structure = False
    pipeline_options.generate_page_images = False
    pipeline_options.generate_picture_images = False

    print("Initializing converter...")
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )

    print(f"Starting conversion of {pdf_path} (pages 1-30)...")
    conv_res = converter.convert(pdf_path, page_range=(1, 30))
    
    print("SUCCESS: Document converted!")
    
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    args = parser.parse_args()
    run_test(args.pdf)

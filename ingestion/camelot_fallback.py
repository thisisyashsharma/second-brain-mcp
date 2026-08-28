import logging
import camelot

def extract_table_with_camelot(pdf_path, page_num):
    """
    Attempts to extract tables from a specific page using Camelot.
    Returns (table_data, method) or (None, None).
    table_data is a list of lists of strings.
    """
    logging.info(f"Trying Camelot fallback on page {page_num}...")
    
    # 1. Try Lattice (looks for physical lines)
    try:
        lattice_tables = camelot.read_pdf(str(pdf_path), pages=str(page_num), flavor='lattice')
        if lattice_tables and len(lattice_tables) > 0:
            # We pick the largest table if there are multiple
            best_table = max(lattice_tables, key=lambda t: t.df.size)
            if best_table.df.size > 0 and len(best_table.df.columns) > 1:
                logging.info(f"Camelot Lattice found a table on page {page_num}.")
                return best_table.df.fillna("").values.tolist(), "lattice"
    except Exception as e:
        logging.debug(f"Camelot Lattice failed on page {page_num}: {e}")

    # 2. Try Stream (uses whitespace alignment for borderless tables)
    try:
        stream_tables = camelot.read_pdf(str(pdf_path), pages=str(page_num), flavor='stream')
        if stream_tables and len(stream_tables) > 0:
            best_table = max(stream_tables, key=lambda t: t.df.size)
            if best_table.df.size > 0 and len(best_table.df.columns) > 1:
                logging.info(f"Camelot Stream found a table on page {page_num}.")
                return best_table.df.fillna("").values.tolist(), "stream"
    except Exception as e:
        logging.debug(f"Camelot Stream failed on page {page_num}: {e}")
        
    return None, None

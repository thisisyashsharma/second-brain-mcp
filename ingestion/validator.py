import re

def validate_table(table_data):
    """
    Validates a table structurally and semantically for financial data.
    table_data is a list of lists (rows of cells, where cells are strings).
    Returns (score, needs_review, reasons)
    """
    if not table_data or len(table_data) < 2:
        return 0.0, True, ["Table is too small or empty"]

    score = 1.0
    reasons = []
    needs_review = False

    num_rows = len(table_data)
    cols_per_row = [len(row) for row in table_data]
    max_cols = max(cols_per_row) if cols_per_row else 0

    if max_cols < 2:
        return 0.1, True, ["Table has fewer than 2 columns"]

    # 1. Empty cell ratio
    total_cells = sum(len(row) for row in table_data)
    empty_cells = sum(1 for row in table_data for cell in row if not str(cell).strip())
    empty_ratio = empty_cells / total_cells if total_cells > 0 else 1.0

    if empty_ratio > 0.4:
        score -= 0.3
        reasons.append(f"High empty cell ratio ({empty_ratio:.2f})")

    # 2. Inconsistent column counts
    inconsistent_rows = sum(1 for c in cols_per_row if c != max_cols)
    if inconsistent_rows > num_rows * 0.2:
        score -= 0.3
        reasons.append("Inconsistent column counts across rows")

    # 3. Suspicious concatenated numbers (e.g. 19601371527351)
    has_concatenated_numbers = False
    for row in table_data:
        for cell in row:
            cell_str = str(cell).strip()
            # Find contiguous digits
            blocks = re.findall(r'\d+', cell_str.replace(',', ''))
            if any(len(b) >= 12 for b in blocks):
                has_concatenated_numbers = True
                break
        if has_concatenated_numbers:
            break

    if has_concatenated_numbers:
        score -= 0.5
        reasons.append("Suspicious concatenated numbers detected (e.g. 12+ contiguous digits)")
        needs_review = True

    # 4. Numeric column consistency & row-label-to-value alignment
    # Check if first column looks like a label (mostly text), and subsequent columns are mostly numeric
    label_empty = sum(1 for row in table_data if row and not str(row[0]).strip())
    if num_rows > 1 and label_empty > (num_rows - 1) * 0.5:
        score -= 0.2
        reasons.append("Missing row labels in >50% of rows")
        
    numeric_rows = 0
    for row in table_data[1:]:  # skip header
        # Does this row have numbers in the data columns?
        if len(row) > 1 and any(re.search(r'\d', str(cell)) for cell in row[1:]): 
            numeric_rows += 1
            
    if num_rows > 1 and numeric_rows < (num_rows - 1) * 0.3:
        score -= 0.3
        reasons.append("Low numeric density in data columns (structurally unreliable for financial table)")

    # 5. Missing / Unaligned Headers
    header = table_data[0]
    # In financial reports, headers usually have years (e.g., '2023', '2022', 'FY23', 'March 31')
    has_year = any(re.search(r'20\d\d|FY\d\d|March|Mar', str(h), re.IGNORECASE) for h in header)
    
    # Header length vs max_cols
    if len(header) < max_cols - 1:
        score -= 0.2
        reasons.append("Header column count does not align with data row column count")

    if not has_year and num_rows > 3:
        # Not severely penalizing since some tables aren't multi-year, but worth noting for financial validity
        pass 

    # 6. Fragmentation
    fragmented_cells = sum(1 for row in table_data for cell in row if len(str(cell).strip()) == 1 and str(cell).strip().isalnum())
    if fragmented_cells > total_cells * 0.2:
        score -= 0.4
        reasons.append("High cell fragmentation (many single-character cells)")

    score = max(0.0, min(1.0, score))
    
    if score < 0.75:
        needs_review = True

    return score, needs_review, reasons

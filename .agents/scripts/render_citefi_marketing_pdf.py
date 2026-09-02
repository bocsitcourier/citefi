from pathlib import Path

import pymupdf


pdf_path = Path("/tmp/citefi-files-6/citefi_marketing_site_v2.pdf")
output_dir = Path(".agents/outputs/citefi-marketing-v2")
output_dir.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(pdf_path)
print(f"pages={document.page_count}")

for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    output_path = output_dir / f"page-{index + 1}.png"
    pixmap.save(output_path)
    print(f"{output_path}\t{pixmap.width}x{pixmap.height}")
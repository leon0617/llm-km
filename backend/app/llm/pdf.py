from pathlib import Path
import fitz  # PyMuPDF


def pdf_to_png(pdf_path: Path, output_dir: Path, base_name: str, dpi: int = 200) -> list[str]:
    """Convert each PDF page to PNG. Returns list of filenames created."""
    output_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf_path))
    created = []
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    for i, page in enumerate(doc, start=1):
        filename = f"{base_name}_p{i:02d}.png"
        out_path = output_dir / filename
        pix = page.get_pixmap(matrix=mat)
        pix.save(str(out_path))
        created.append(filename)
    doc.close()
    return created

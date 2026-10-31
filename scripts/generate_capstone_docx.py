import os
import sys
import docx
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    shading_xml = f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>'
    cell._tc.get_or_add_tcPr().append(parse_xml(shading_xml))

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def add_header_footer(doc):
    for s in doc.sections:
        header = s.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("IDRMM System — Capstone Source Code Appendix")
        hrun.font.name = "Calibri"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(120, 120, 120)

        footer = s.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Source Code Repository Listing  |  Confidential Capstone Documentation")
        frun.font.name = "Calibri"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(140, 140, 140)

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    out_dir = os.path.join(root_dir, "deliverables", "capstone-source-code")
    os.makedirs(out_dir, exist_ok=True)
    out_docx = os.path.join(out_dir, "IDRMM_Complete_Source_Code.docx")

    ignore_dirs = {
        "node_modules", ".next", ".git", "supabase", ".gemini", ".claude",
        "artifacts", "deliverables", "coverage", ".vscode", ".husky"
    }
    ignore_files = {"package-lock.json"}

    categorized = {
        "app_pages": {
            "title": "Application Pages & Route Views (app/)",
            "desc": "Next.js App Router page views, layout hierarchies, loading states, and error boundaries.",
            "files": []
        },
        "api_routes": {
            "title": "REST API Endpoints & Route Handlers (app/api/)",
            "desc": "Backend API route handlers for backups, automation, health checks, and webhooks.",
            "files": []
        },
        "server_actions": {
            "title": "Server Actions & Database Operations",
            "desc": "Transactional mutations, role validation, schedule updates, and data persistence.",
            "files": []
        },
        "lib_utilities": {
            "title": "Domain Logic, Calculations & Utilities (lib/)",
            "desc": "Cost estimators, task progress algorithms, Gantt math, AI clients, and auth security.",
            "files": []
        },
        "components": {
            "title": "User Interface & Feature Components (components/)",
            "desc": "Interactive Gantt timeline, dialogs, charts, cost tables, forms, and responsive controls.",
            "files": []
        },
        "configs": {
            "title": "System Configuration & Metadata",
            "desc": "TypeScript compiler settings, Tailwind styling tokens, ESLint rules, and project manifest.",
            "files": []
        }
    }

    def should_include(full_path):
        base = os.path.basename(full_path)
        if base.startswith(".env"):
            return False
        if base in ignore_files:
            return False
        ext = os.path.splitext(base)[1].lower()
        return ext in {".ts", ".tsx", ".js", ".jsx", ".css", ".json"}

    for root, dirs, files in os.walk(root_dir):
        # Filter directories in-place
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, root_dir).replace("\\", "/")
            if should_include(full):
                try:
                    with open(full, "r", encoding="utf-8", errors="replace") as fh:
                        content = fh.read()
                    lines = content.split("\n")
                    info = {
                        "rel": rel,
                        "lines": len(lines),
                        "content": content,
                        "ext": os.path.splitext(f)[1].upper().replace(".", "")
                    }
                    if rel.startswith("app/api/"):
                        categorized["api_routes"]["files"].append(info)
                    elif "actions.ts" in rel or "-actions.ts" in rel or "action.ts" in rel:
                        categorized["server_actions"]["files"].append(info)
                    elif rel.startswith("app/"):
                        categorized["app_pages"]["files"].append(info)
                    elif rel.startswith("components/"):
                        categorized["components"]["files"].append(info)
                    elif rel.startswith("lib/"):
                        categorized["lib_utilities"]["files"].append(info)
                    else:
                        categorized["configs"]["files"].append(info)
                except Exception as e:
                    print(f"Warning: skipped {rel} due to {e}")

    total_files = sum(len(c["files"]) for c in categorized.values())
    total_lines = sum(sum(f["lines"] for f in c["files"]) for c in categorized.values())

    print(f"Building Word Document for {total_files} files ({total_lines:,} lines)...")

    doc = docx.Document()

    # Document Geometry
    section = doc.sections[0]
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)

    add_header_footer(doc)

    # -------------------------------------------------------------
    # 1. COVER / TITLE PAGE
    # -------------------------------------------------------------
    cover_p = doc.add_paragraph()
    cover_p.paragraph_format.space_before = Pt(36)
    cover_p.paragraph_format.space_after = Pt(8)
    run_title = cover_p.add_run("IDRMM SYSTEM")
    run_title.font.name = "Calibri"
    run_title.font.size = Pt(28)
    run_title.font.bold = True
    run_title.font.color.rgb = RGBColor(15, 23, 42)

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(24)
    run_sub = sub_p.add_run("Integrated Disaster Risk & Material Management System\nAppendix: Complete Source Code Repository Listing")
    run_sub.font.name = "Calibri"
    run_sub.font.size = Pt(14)
    run_sub.font.color.rgb = RGBColor(71, 85, 105)

    # Metadata Callout Box
    meta_table = doc.add_table(rows=5, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_table.autofit = False

    meta_data = [
        ("Document Classification:", "Official Capstone Source Code Appendix"),
        ("System Architecture:", "Next.js App Router (React 19, TypeScript, Tailwind CSS, Supabase)"),
        ("Total Source Files:", f"{total_files} Production Files"),
        ("Total Lines of Code:", f"{total_lines:,} Lines of Code"),
        ("Exclusions Applied:", "Excluded .env* files, database migrations (supabase/), build outputs")
    ]

    for row_idx, (label, val) in enumerate(meta_data):
        row = meta_table.rows[row_idx]
        c0, c1 = row.cells[0], row.cells[1]
        c0.width = Inches(2.2)
        c1.width = Inches(4.8)
        set_cell_background(c0, "F1F5F9")
        set_cell_background(c1, "F8FAFC")
        set_cell_margins(c0, top=80, bottom=80, left=120, right=120)
        set_cell_margins(c1, top=80, bottom=80, left=120, right=120)

        p0 = c0.paragraphs[0]
        r0 = p0.add_run(label)
        r0.font.name = "Calibri"
        r0.font.size = Pt(9.5)
        r0.font.bold = True
        r0.font.color.rgb = RGBColor(30, 41, 59)

        p1 = c1.paragraphs[0]
        r1 = p1.add_run(val)
        r1.font.name = "Calibri"
        r1.font.size = Pt(9.5)
        r1.font.color.rgb = RGBColor(51, 65, 85)

    doc.add_page_break()

    # -------------------------------------------------------------
    # 2. EXECUTIVE MODULE INVENTORY TABLE
    # -------------------------------------------------------------
    h1 = doc.add_heading("Section Overview & Module Summary", level=1)
    h1.paragraph_format.space_before = Pt(12)
    h1.paragraph_format.space_after = Pt(12)

    sum_table = doc.add_table(rows=len(categorized) + 2, cols=4)
    sum_table.alignment = WD_TABLE_ALIGNMENT.CENTER

    headers = ["#", "Module / Architectural Layer", "Files", "Lines of Code"]
    hdr_row = sum_table.rows[0]
    for idx, text in enumerate(headers):
        cell = hdr_row.cells[idx]
        set_cell_background(cell, "0F172A")
        set_cell_margins(cell, top=100, bottom=100, left=100, right=100)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in {0, 2, 3} else WD_ALIGN_PARAGRAPH.LEFT
        r = p.add_run(text)
        r.font.name = "Calibri"
        r.font.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(255, 255, 255)

    widths = [Inches(0.4), Inches(4.2), Inches(0.9), Inches(1.5)]

    for cat_idx, (cat_key, cat) in enumerate(categorized.items()):
        row = sum_table.rows[cat_idx + 1]
        c_lines = sum(f["lines"] for f in cat["files"])
        bg = "FFFFFF" if cat_idx % 2 == 0 else "F8FAFC"
        vals = [str(cat_idx + 1), cat["title"], str(len(cat["files"])), f"{c_lines:,}"]
        for idx, val in enumerate(vals):
            cell = row.cells[idx]
            cell.width = widths[idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=70, bottom=70, left=100, right=100)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in {0, 2, 3} else WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(val)
            r.font.name = "Calibri"
            r.font.size = Pt(9)
            if idx == 1:
                r.font.bold = True
            r.font.color.rgb = RGBColor(30, 41, 59)

    # Total row
    tot_row = sum_table.rows[len(categorized) + 1]
    tot_vals = ["", "TOTAL PROJECT REPOSITORY", str(total_files), f"{total_lines:,}"]
    for idx, val in enumerate(tot_vals):
        cell = tot_row.cells[idx]
        cell.width = widths[idx]
        set_cell_background(cell, "E2E8F0")
        set_cell_margins(cell, top=90, bottom=90, left=100, right=100)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in {0, 2, 3} else WD_ALIGN_PARAGRAPH.LEFT
        r = p.add_run(val)
        r.font.name = "Calibri"
        r.font.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(15, 23, 42)

    doc.add_page_break()

    # -------------------------------------------------------------
    # 3. DETAILED CODE CONTENT SECTIONS
    # -------------------------------------------------------------
    CHUNK_SIZE = 80  # lines per paragraph to optimize layout engine in Word

    for cat_idx, (cat_key, cat) in enumerate(categorized.items()):
        sec_num = cat_idx + 1
        sec_heading = doc.add_heading(f"Section {sec_num}: {cat['title']}", level=1)
        sec_heading.paragraph_format.space_before = Pt(16)
        sec_heading.paragraph_format.space_after = Pt(4)

        desc_p = doc.add_paragraph()
        desc_p.paragraph_format.space_after = Pt(14)
        desc_run = desc_p.add_run(cat["desc"] + f" ({len(cat['files'])} files, {sum(f['lines'] for f in cat['files']):,} lines)")
        desc_run.font.name = "Calibri"
        desc_run.font.italic = True
        desc_run.font.size = Pt(10)
        desc_run.font.color.rgb = RGBColor(100, 116, 139)

        for file_idx, f in enumerate(cat["files"]):
            f_num = f"{sec_num}.{file_idx + 1}"
            
            # File Header Heading 2
            fh = doc.add_heading(f"[{f_num}] {f['rel']} ({f['lines']} lines)", level=2)
            fh.paragraph_format.space_before = Pt(12)
            fh.paragraph_format.space_after = Pt(3)
            fh.paragraph_format.keep_with_next = True
            for r in fh.runs:
                r.font.name = "Consolas"
                r.font.size = Pt(10)
                r.font.bold = True
                r.font.color.rgb = RGBColor(30, 58, 138)  # Deep blue

            # Code lines chunked into paragraph blocks
            lines = f["content"].split("\n")
            total_chunks = (len(lines) + CHUNK_SIZE - 1) // CHUNK_SIZE
            
            for c_idx in range(total_chunks):
                chunk_lines = lines[c_idx * CHUNK_SIZE : (c_idx + 1) * CHUNK_SIZE]
                chunk_text = "\n".join(chunk_lines)

                cp = doc.add_paragraph()
                cp.paragraph_format.space_before = Pt(0)
                # Small gap after final chunk of file
                cp.paragraph_format.space_after = Pt(8) if (c_idx == total_chunks - 1) else Pt(0)
                cp.paragraph_format.line_spacing = 1.0

                crun = cp.add_run(chunk_text)
                crun.font.name = "Consolas"
                crun.font.size = Pt(8.0)
                crun.font.color.rgb = RGBColor(30, 41, 59)

        # Page break after each major section (except the last)
        if cat_idx < len(categorized) - 1:
            doc.add_page_break()

    print(f"Saving final document to: {out_docx}...")
    doc.save(out_docx)
    file_size_mb = os.path.getsize(out_docx) / (1024 * 1024)
    print(f"SUCCESS! Created {out_docx} ({file_size_mb:.2f} MB)")

if __name__ == "__main__":
    main()

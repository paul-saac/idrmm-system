import type { GeneratedReport } from "./generated-report";

export async function exportGeneratedReport(report: GeneratedReport, format: "pdf" | "xlsx"): Promise<Blob> {
  if (format === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IDRMM";
    for (const [index, section] of report.sections.entries()) {
      const sheet = workbook.addWorksheet(`${index + 1} ${section.title}`.slice(0, 31));
      sheet.columns = Array.from({ length: Math.max(2, section.headers.length) }, () => ({ width: 30 }));
      sheet.addRow([report.title]).font = { bold: true, size: 16 };
      sheet.addRow([report.project, `As of ${report.asOf}`]);
      sheet.addRow([]);
      sheet.addRow([section.title]).font = { bold: true };
      for (const paragraph of section.paragraphs) {
        const row = sheet.addRow([paragraph]);
        sheet.mergeCells(row.number, 1, row.number, Math.max(2, section.headers.length));
        row.alignment = { wrapText: true, vertical: "top" };
        row.height = Math.max(30, Math.ceil(paragraph.length / (Math.max(2, section.headers.length) * 28)) * 16 + paragraph.split("\n").length * 16);
      }
      sheet.addRow([]);
      if (section.headers.length) sheet.addRow(section.headers).font = { bold: true };
      section.rows.forEach(values => { sheet.addRow(values).alignment = { wrapText: true, vertical: "top" }; });
      sheet.views = [{ state: "frozen", ySplit: 2 }];
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  let y = 20;
  const line = (text: string, size = 10, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    for (const part of pdf.splitTextToSize(text, 174) as string[]) {
      if (y > 275) { pdf.addPage(); y = 20; }
      pdf.text(part, 18, y); y += size * 0.48;
    }
    y += 3;
  };
  line(report.title, 18, true);
  line(`${report.project} | As of ${report.asOf}`);
  for (const section of report.sections) {
    if (y > 250) { pdf.addPage(); y = 20; }
    y += 5; line(section.title, 13, true);
    section.paragraphs.forEach(p => line(p));
    section.rows.forEach(row => { row.forEach((value, i) => line(`${section.headers[i]}: ${value}`)); y += 3; });
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setFontSize(8); pdf.text(`${page} / ${pdf.getNumberOfPages()}`, 190, 289, { align: "right" });
  }
  return pdf.output("blob");
}

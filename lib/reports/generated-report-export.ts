import type { GeneratedReport } from "./generated-report";

function safePdfText(value: string | number): string {
  return String(value ?? "")
    .replace(/₱/g, "PHP ")
    .replace(/[—–]/g, "-")
    .replace(/·/g, "|")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function getColumnWidths(headers: string[], totalWidth: number): number[] {
  const count = headers.length;
  if (count <= 1) return [totalWidth];
  const weights = headers.map((h) => {
    const lower = h.toLowerCase();
    if (
      lower.includes("notes") ||
      lower.includes("changes") ||
      lower.includes("impact") ||
      lower.includes("explanation") ||
      lower.includes("description") ||
      lower.includes("disposition")
    ) {
      return 3.2;
    }
    if (
      lower === "reference" ||
      lower === "ref" ||
      lower.includes("revisions") ||
      lower === "stage" ||
      lower === "progress" ||
      lower.includes("count") ||
      lower.includes("variance")
    ) {
      return 0.65;
    }
    if (lower.includes("date") || lower.includes("version") || lower.includes("status")) {
      return 0.85;
    }
    return 1.1;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => (w / weightSum) * totalWidth);
}


function formatReportTimestamp(value: string | Date) {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).replace(" at ", ", ").replace(" AM", " am").replace(" PM", " pm");
}

const LOGO_BASE64 = "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";

async function exportPunchListPdf(report: GeneratedReport): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  const contentW = 182;
  const pageBottom = 268;
  const labelW = 55;
  const valX = marginX + labelW;
  const valW = contentW - labelW;

  const displayDate = (value: string) => {
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-GB", {
      timeZone: "Asia/Manila",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const meta = report.metadata;
  const items =
    report.punchDetails && report.punchDetails.length > 0
      ? report.punchDetails
      : report.sections.map((section, idx) => {
          const rows = Object.fromEntries(section.rows.map(([k, v]) => [String(k), String(v)]));
          const photoP = section.paragraphs.find(
            (p) => p.startsWith("Photo and video:") || p.startsWith("Photo evidence:")
          );
          const photoUrl = photoP
            ? photoP.replace(/^Photo (?:and video|evidence):\s*/, "").replace("Not attached", "").trim()
            : "";
          const descP = section.paragraphs.find((p) => p.startsWith("Description:"));
          const description = descP
            ? descP.replace(/^Description:\s*/, "").trim()
            : section.paragraphs[0] || "Not recorded";
          return {
            id: idx + 1,
            itemNumber: section.title.includes("·")
              ? section.title.split("·")[1]?.trim() || `PL-${String(idx + 1).padStart(4, "0")}`
              : `PL-${String(idx + 1).padStart(4, "0")}`,
            formNumber: `IDR M&M - ${report.project} - DP-QUAL-${String(idx + 1).padStart(4, "0")}`,
            trade: rows["Trade and party responsible"] || "Not specified",
            area: rows["Area"] || "Not specified",
            specificLocation: rows["Specific location"] || "Not specified",
            issueType: rows["Type of issue"] || "Punch item",
            identifiedOn: rows["Date identified"] || report.asOf,
            description,
            photoUrl: photoUrl.startsWith("http") ? photoUrl : undefined,
            actionPerson: rows["Action person"] || "Unassigned",
            inspectorName:
              rows["Resolution verified by"]?.split(",")[0] ||
              rows["Inspected / reported by"] ||
              meta?.foreman ||
              "Authorized Inspector",
            inspectorSignedAt: rows["Date identified"] || report.asOf,
            formCreatedAt: `${report.asOf}T00:00:00+08:00`,
            status: rows["Current status"] || "Open",
          };
        });
  const formCreatedTimestamp = formatReportTimestamp(items[0]?.formCreatedAt ?? `${report.asOf}T00:00:00+08:00`);
  const evidenceImages = await Promise.all(
    items.map(async (item) => {
      if (!item.photoUrl) return null;
      try {
        const response = await fetch(item.photoUrl);
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const format = contentType.includes("png")
          ? "PNG"
          : contentType.includes("webp")
            ? "WEBP"
            : "JPEG";
        return { data: new Uint8Array(await response.arrayBuffer()), format };
      } catch {
        return null;
      }
    })
  );

  const drawPageHeader = () => {
    try {
      pdf.addImage(`data:image/png;base64,${LOGO_BASE64}`, "PNG", marginX, 10.7, 29.04, 7.875);
    } catch {
      pdf.setFont("times", "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(24, 24, 27);
      pdf.text("IDR M&M", marginX, 19);
    }

    pdf.setFontSize(8);
    pdf.setTextColor(39, 39, 42);
    const headerX = marginX + 34.85;
    for (const [index, [label, value]] of [
      ["Organisation:", "IDR M&M Construction"],
      ["Address:", "D. Mariano St., Concepcion Uno, Marikina City"],
    ].entries()) {
      pdf.setFont("helvetica", "bold");
      pdf.text(label, headerX, 12.9 + index * 4.96);
      const valueX = headerX + pdf.getTextWidth(label) + 2;
      pdf.setFont("helvetica", "normal");
      pdf.text(pdf.splitTextToSize(value, marginX + contentW - 59 - valueX), valueX, 12.9 + index * 4.96);
    }
    pdf.setFont("helvetica", "normal");
    const contact = "+63 967 217 3481";
    const contactX = marginX + contentW - pdf.getTextWidth(contact);
    pdf.text(contact, contactX, 12.9);
    pdf.setFont("helvetica", "bold");
    pdf.text("Contact Number:", contactX - pdf.getTextWidth("Contact Number:") - 2, 12.9);

    // Solid black line with lessened gap
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.35);
    pdf.line(marginX, 21, marginX + contentW, 21);
  };

  drawPageHeader();

  let y = 29;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(24, 24, 27);
  pdf.text("Punch List Report", marginX, y);
  y += 9;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageBottom) {
      pdf.addPage();
      drawPageHeader();
      y = 29;
      return true;
    }
    return false;
  };

  const drawRow = (label: string, value: string, isMultiline = false) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);

    if (!isMultiline) {
      ensureSpace(5.5);
      pdf.text(safePdfText(label), marginX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(39, 39, 42);
      const valLines = pdf.splitTextToSize(safePdfText(value), valW) as string[];
      pdf.text(valLines[0] || "", valX, y);
      y += 8.5;
    } else {
      const valLines = pdf.splitTextToSize(safePdfText(value), valW) as string[];
      const blockH = Math.max(6.5, valLines.length * 4.8);
      ensureSpace(blockH + 1);
      pdf.text(safePdfText(label), marginX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(39, 39, 42);
      let lineY = y;
      for (const line of valLines) {
        pdf.text(line, valX, lineY);
        lineY += 4.8;
      }
      y = lineY + 3.7;
    }
  };

  if (items.length === 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(113, 113, 122);
    pdf.text("No punch-list items match this selection.", marginX, y + 5);
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (i > 0) {
        ensureSpace(25);
        pdf.setDrawColor(228, 228, 231);
        pdf.setLineWidth(0.3);
        pdf.line(marginX, y, marginX + contentW, y);
        y += 6;
      }

      drawRow("Automated Form Number:", item.formNumber);
      drawRow("Trade and Party Responsible:", item.trade);
      drawRow("Area:", item.area);
      drawRow("Specific Location:", item.specificLocation);
      drawRow("Type of issue:", item.issueType);
      drawRow("Date identified:", displayDate(item.identifiedOn));
      drawRow("Description:", item.description, true);

      // Photo and video
      ensureSpace(item.photoUrl ? 29 : 7);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9.5);
      pdf.setTextColor(24, 24, 27);
      pdf.text("Photo and video:", marginX, y);
      if (item.photoUrl) {
        const evidenceImage = evidenceImages[i];
        let imageAdded = false;
        if (evidenceImage) {
          try {
            pdf.addImage(evidenceImage.data, evidenceImage.format, valX, y - 3, 24, 20);
            imageAdded = true;
          } catch {
            imageAdded = false;
          }
        }
        if (!imageAdded) {
          pdf.setDrawColor(212, 212, 216);
          pdf.setFillColor(244, 244, 245);
          pdf.setLineWidth(0.3);
          pdf.rect(valX, y - 3, 24, 20, "FD");
          pdf.setFont("helvetica", "italic");
          pdf.setFontSize(8);
          pdf.setTextColor(113, 113, 122);
          pdf.text("Photo attached", valX + 3, y + 5);
        }

        y += 23;
      } else {
        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(9.5);
        pdf.setTextColor(113, 113, 122);
        pdf.text("No media attached", valX, y);
        y += 8.5;
      }

      drawRow("Action Person:", item.actionPerson);

      // Blank signature line for handwritten inspector sign-off.
      ensureSpace(11);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9.5);
      pdf.setTextColor(24, 24, 27);
      pdf.text("Inspector Signoff:", marginX, y);

      pdf.setDrawColor(30, 30, 30);
      pdf.setLineWidth(0.25);
      pdf.line(valX, y + 1, valX + 55, y + 1);
      y += 9;

      // Current Status
      drawRow("Current Status:", item.status.charAt(0).toUpperCase() + item.status.slice(1));
      y += 3;
    }
  }

  // Add Footers across all pages
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, 276, marginX + contentW, 276);

    pdf.setFontSize(8);
    const footerColumns = [
      { label: "Prepared By:", value: report.metadata?.preparedBy || "Authorized user", x: marginX, align: "left" as const },
      { label: "Project:", value: report.project, x: marginX + contentW / 2, align: "center" as const },
      { label: "Form created:", value: formCreatedTimestamp, x: marginX + contentW, align: "right" as const },
    ];
    for (const column of footerColumns) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(24, 24, 27);
      if (column.align === "right") {
        pdf.text(column.label, column.x, 280, { align: column.align });
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(113, 113, 122);
        pdf.text(pdf.splitTextToSize(safePdfText(column.value), contentW / 3 - 5), column.x, 284, { align: column.align });
      } else {
        const labelWidth = pdf.getTextWidth(column.label) + 1;
        pdf.setFont("helvetica", "normal");
        const lines = pdf.splitTextToSize(safePdfText(column.value), contentW / 3 - 5 - labelWidth) as string[];
        const width = labelWidth + Math.max(...lines.map((line) => pdf.getTextWidth(line)));
        const startX = column.align === "center" ? column.x - width / 2 : column.x;
        pdf.setFont("helvetica", "bold");
        pdf.text(column.label, startX, 280);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(113, 113, 122);
        pdf.text(lines, startX + labelWidth, 280);
      }
    }
    pdf.setFontSize(7);
    pdf.text(`Page ${page} of ${totalPages}`, marginX + contentW / 2, 294, { align: "center" });
  }

  return pdf.output("blob");
}

export async function exportGeneratedReport(report: GeneratedReport, format: "pdf" | "xlsx"): Promise<Blob> {
  if (format === "pdf" && (report.reportType === "punch" || (report.punchDetails && report.punchDetails.length > 0) || report.title.toLowerCase().includes("punch"))) {
    return exportPunchListPdf(report);
  }
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
      if (section.subtitle) {
        const subRow = sheet.addRow([section.subtitle]);
        subRow.font = { italic: true, size: 10 };
      }
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
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  const contentW = 182;
  const pageBottom = 268;

  const formCreatedTimestamp = formatReportTimestamp(report.metadata?.startDate ?? `${report.asOf}T00:00:00+08:00`);

  const drawPageHeader = () => {
    try {
      pdf.addImage(`data:image/png;base64,${LOGO_BASE64}`, "PNG", marginX, 10.7, 29.04, 7.875);
    } catch {
      pdf.setFont("times", "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(24, 24, 27);
      pdf.text("IDR M&M", marginX, 19);
    }

    pdf.setFontSize(8);
    pdf.setTextColor(39, 39, 42);
    const headerX = marginX + 34.85;
    for (const [index, [label, value]] of [
      ["Organisation:", "IDR M&M Construction"],
      ["Address:", "D. Mariano St., Concepcion Uno, Marikina City"],
    ].entries()) {
      pdf.setFont("helvetica", "bold");
      pdf.text(label, headerX, 12.9 + index * 4.96);
      const valueX = headerX + pdf.getTextWidth(label) + 2;
      pdf.setFont("helvetica", "normal");
      pdf.text(pdf.splitTextToSize(value, marginX + contentW - 59 - valueX), valueX, 12.9 + index * 4.96);
    }
    pdf.setFont("helvetica", "normal");
    const contact = "+63 967 217 3481";
    const contactX = marginX + contentW - pdf.getTextWidth(contact);
    pdf.text(contact, contactX, 12.9);
    pdf.setFont("helvetica", "bold");
    pdf.text("Contact Number:", contactX - pdf.getTextWidth("Contact Number:") - 2, 12.9);

    // Horizontal black divider line with lessened gap
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.35);
    pdf.line(marginX, 21, marginX + contentW, 21);
  };

  drawPageHeader();

  let y = 29;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(24, 24, 27);
  pdf.text(safePdfText(report.title), marginX, y);
  y += 9;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageBottom) {
      pdf.addPage();
      drawPageHeader();
      y = 29;
      return true;
    }
    return false;
  };

  // Render Each Report Section
  for (const section of report.sections) {
    ensureSpace(22);

    // Clean Section Header with Underline
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(safePdfText(section.title), marginX, y + 3.5);
    pdf.setDrawColor(212, 212, 216);
    pdf.setLineWidth(0.25);
    pdf.line(marginX, y + 5.5, marginX + contentW, y + 5.5);
    y += 8.5;

    // Italicized Section Subtitle / Instructions
    if (section.subtitle) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8);
      pdf.setTextColor(82, 82, 91);
      const subLines = pdf.splitTextToSize(safePdfText(section.subtitle), contentW - 2) as string[];
      for (const sl of subLines) {
        ensureSpace(4);
        pdf.text(sl, marginX + 1, y);
        y += 3.6;
      }
      y += 1.5;
    }

    const isGeneralInfo =
      section.title.toLowerCase().includes("general information") ||
      section.title.toLowerCase().includes("lifecycle summary");

    if (isGeneralInfo) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);

      const labelW = 55;
      const valX = marginX + labelW;
      const valW = contentW - labelW;

      for (const row of section.rows) {
        ensureSpace(7);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(24, 24, 27);
        const labelText = String(row[0] ?? "").endsWith(":") ? String(row[0] ?? "") : `${String(row[0] ?? "")}:`;
        pdf.text(safePdfText(labelText), marginX, y);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(39, 39, 42);
        const lines = pdf.splitTextToSize(safePdfText(row[1] ?? ""), valW) as string[];
        let valY = y;
        for (const line of lines) {
          ensureSpace(4.5);
          pdf.text(line, valX, valY);
          valY += 4.5;
        }
        y = Math.max(y + 6.5, valY + 1.5);
      }

      const summaryText =
        section.paragraphs.length > 0 && section.paragraphs[0]
          ? section.paragraphs.join("\n\n")
          : "Not recorded";

      ensureSpace(12);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(24, 24, 27);
      pdf.text("Project lifecycle summary:", marginX, y);

      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(39, 39, 42);
      const pLines = pdf.splitTextToSize(safePdfText(summaryText), valW) as string[];
      let pY = y;
      for (const line of pLines) {
        ensureSpace(4.5);
        pdf.text(line, valX, pY);
        pY += 4.5;
      }
      y = Math.max(y + 6.5, pY + 3);

      y += 5;
      continue;
    }

    // Section Narrative Paragraphs
    if (section.paragraphs.length > 0) {
      const hasTable = section.headers.length > 0;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.8);
      pdf.setTextColor(24, 24, 27);

      if (!hasTable) {
        // Framed Document Text Box (for narrative-only sections like Lessons Learned)
        const allLines: string[] = [];
        for (const p of section.paragraphs) {
          const wrapped = pdf.splitTextToSize(safePdfText(p), contentW - 6) as string[];
          allLines.push(...wrapped);
        }
        const boxHeight = Math.max(18, allLines.length * 4.2 + 5);
        ensureSpace(boxHeight + 4);
        pdf.setDrawColor(82, 82, 91);
        pdf.setLineWidth(0.25);
        pdf.rect(marginX, y, contentW, boxHeight, "D");
        let textY = y + 4.5;
        for (const l of allLines) {
          pdf.text(l, marginX + 3, textY);
          textY += 4.2;
        }
        y += boxHeight + 5;
      } else {
        for (const p of section.paragraphs) {
          const wrapped = pdf.splitTextToSize(safePdfText(p), contentW - 2) as string[];
          for (const l of wrapped) {
            ensureSpace(4.5);
            pdf.text(l, marginX + 1, y);
            y += 4;
          }
          y += 1.2;
        }
        y += 1;
      }
    }

    // Formal Bordered Table
    if (section.headers.length > 0) {
      const colWidths = getColumnWidths(section.headers, contentW);

      const drawTableHeader = () => {
        pdf.setFont("helvetica", "bolditalic");
        pdf.setFontSize(8);
        pdf.setTextColor(24, 24, 27);
        const headerLinesByCol = section.headers.map((h, i) =>
          pdf.splitTextToSize(safePdfText(h), Math.max(10, colWidths[i] - 3)) as string[]
        );
        const maxHeaderLines = Math.max(1, ...headerLinesByCol.map(lines => lines.length));
        const headerH = Math.max(6.8, maxHeaderLines * 3.6 + 3);

        ensureSpace(headerH + 7);
        let curX = marginX;
        for (let i = 0; i < section.headers.length; i++) {
          pdf.setFillColor(242, 242, 245);
          pdf.setDrawColor(63, 63, 70);
          pdf.setLineWidth(0.25);
          pdf.rect(curX, y, colWidths[i], headerH, "FD");
          let lineY = y + 4;
          for (const hl of headerLinesByCol[i]) {
            pdf.text(hl, curX + 1.5, lineY);
            lineY += 3.6;
          }
          curX += colWidths[i];
        }
        y += headerH;
      };

      drawTableHeader();

      if (section.rows.length === 0) {
        const emptyH = 7;
        ensureSpace(emptyH);
        pdf.setDrawColor(113, 113, 122);
        pdf.setLineWidth(0.2);
        pdf.rect(marginX, y, contentW, emptyH, "D");
        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(8);
        pdf.setTextColor(113, 113, 122);
        pdf.text("No records match this selection.", marginX + 3, y + 4.6);
        y += emptyH;
      } else {
        for (const row of section.rows) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          pdf.setTextColor(24, 24, 27);

          const cellLines = section.headers.map((_, i) =>
            pdf.splitTextToSize(safePdfText(row[i] ?? ""), Math.max(10, colWidths[i] - 3)) as string[]
          );
          const maxLines = Math.max(1, ...cellLines.map(lines => lines.length));
          const rowH = Math.max(6.5, maxLines * 3.6 + 2.8);

          if (y + rowH > pageBottom) {
            pdf.addPage();
            y = 16;
            drawTableHeader();
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.setTextColor(24, 24, 27);
          }

          const isTotalRow = String(row[0] ?? "").toLowerCase().startsWith("total ");
          let curX = marginX;
          for (let i = 0; i < section.headers.length; i++) {
            if (isTotalRow) {
              pdf.setFillColor(248, 248, 250);
              pdf.setDrawColor(82, 82, 91);
              pdf.rect(curX, y, colWidths[i], rowH, "FD");
              pdf.setFont("helvetica", "bold");
            } else {
              pdf.setDrawColor(113, 113, 122);
              pdf.setLineWidth(0.2);
              pdf.rect(curX, y, colWidths[i], rowH, "D");
              pdf.setFont("helvetica", "normal");
            }
            let lineY = y + 4;
            for (const cl of cellLines[i]) {
              pdf.text(cl, curX + 1.5, lineY);
              lineY += 3.6;
            }
            curX += colWidths[i];
          }
          y += rowH;
        }
      }
      y += 5;
    }
  }

  // Document Footers across all pages matching Punch List
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, 276, marginX + contentW, 276);

    pdf.setFontSize(8);
    const footerColumns = [
      { label: "Prepared By:", value: report.metadata?.preparedBy || "Authorized user", x: marginX, align: "left" as const },
      { label: "Project:", value: report.project, x: marginX + contentW / 2, align: "center" as const },
      { label: "Form created:", value: formCreatedTimestamp, x: marginX + contentW, align: "right" as const },
    ];
    for (const column of footerColumns) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(24, 24, 27);
      if (column.align === "right") {
        pdf.text(column.label, column.x, 280, { align: column.align });
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(113, 113, 122);
        pdf.text(pdf.splitTextToSize(safePdfText(column.value), contentW / 3 - 5), column.x, 284, { align: column.align });
      } else {
        const labelWidth = pdf.getTextWidth(column.label) + 1;
        pdf.setFont("helvetica", "normal");
        const lines = pdf.splitTextToSize(safePdfText(column.value), contentW / 3 - 5 - labelWidth) as string[];
        const width = labelWidth + Math.max(...lines.map((line) => pdf.getTextWidth(line)));
        const startX = column.align === "center" ? column.x - width / 2 : column.x;
        pdf.setFont("helvetica", "bold");
        pdf.text(column.label, startX, 280);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(113, 113, 122);
        pdf.text(lines, startX + labelWidth, 280);
      }
    }
    pdf.setFontSize(7);
    pdf.text(`Page ${page} of ${totalPages}`, marginX + contentW / 2, 294, { align: "center" });
  }

  return pdf.output("blob");
}

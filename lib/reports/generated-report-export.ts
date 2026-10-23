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

  const pdfCreatedTimestamp = formatReportTimestamp(new Date());
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
      pdf.addImage(`data:image/png;base64,${LOGO_BASE64}`, "PNG", marginX, 7.5, 38, 18.25);
    } catch {
      pdf.setFont("times", "bold");
      pdf.setFontSize(18);
      pdf.setTextColor(24, 24, 27);
      pdf.text("IDR M&M", marginX, 19);
    }

    // Column 1
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Organisation:", marginX + 43, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    pdf.text("IDR M&M Construction", marginX + 64, 13);

    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Project:", marginX + 43, 18);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    const projClipped = (pdf.splitTextToSize(safePdfText(report.project), 52) as string[])[0] || "";
    pdf.text(projClipped, marginX + 64, 18);

    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Prepared By:", marginX + 43, 23);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    const preparedBy = meta?.preparedBy || "Authorized user";
    const preparedByClipped = (pdf.splitTextToSize(safePdfText(preparedBy), 48) as string[])[0] || "";
    pdf.text(preparedByClipped, marginX + 64, 23);

    // Column 2
    const formCreatedText = safePdfText(formCreatedTimestamp);
    pdf.setFont("helvetica", "normal");
    const formCreatedValueWidth = pdf.getTextWidth(formCreatedText);
    const formCreatedValueX = marginX + contentW - formCreatedValueWidth;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Form created:", formCreatedValueX - pdf.getTextWidth("Form created:") - 2, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    pdf.text(formCreatedText, formCreatedValueX, 13);

    // Solid black line with lessened gap
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.35);
    pdf.line(marginX, 28, marginX + contentW, 28);
  };

  drawPageHeader();

  let y = 36;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(24, 24, 27);
  pdf.text("Punch List Report", marginX, y);
  y += 9;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageBottom) {
      pdf.addPage();
      drawPageHeader();
      y = 36;
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

    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("IDR M&M", marginX, 281);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(113, 113, 122);
    pdf.text("Generated with IDR M&M", marginX + 15, 281);

    pdf.text("Printed version is uncontrolled", marginX + contentW / 2, 280, { align: "center" });
    pdf.text(`Page ${page} of ${totalPages}`, marginX + contentW / 2, 284, { align: "center" });

    pdf.text("This PDF was created at", marginX + contentW, 280, { align: "right" });
    pdf.text(safePdfText(pdfCreatedTimestamp), marginX + contentW, 284, { align: "right" });
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
  const pdfCreatedTimestamp = formatReportTimestamp(new Date());

  const drawPageHeader = () => {
    try {
      pdf.addImage(`data:image/png;base64,${LOGO_BASE64}`, "PNG", marginX, 7.5, 38, 18.25);
    } catch {
      pdf.setFont("times", "bold");
      pdf.setFontSize(18);
      pdf.setTextColor(24, 24, 27);
      pdf.text("IDR M&M", marginX, 19);
    }

    // Column 1
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Organisation:", marginX + 43, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    pdf.text("IDR M&M Construction", marginX + 64, 13);

    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Project:", marginX + 43, 18);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    const projClipped = (pdf.splitTextToSize(safePdfText(report.project), 52) as string[])[0] || "";
    pdf.text(projClipped, marginX + 64, 18);

    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Prepared By:", marginX + 43, 23);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    const preparedBy = report.metadata?.preparedBy || "Authorized user";
    const prepClipped = (pdf.splitTextToSize(safePdfText(preparedBy), 48) as string[])[0] || "";
    pdf.text(prepClipped, marginX + 64, 23);

    // Column 2
    const formCreatedText = safePdfText(formCreatedTimestamp);
    pdf.setFont("helvetica", "normal");
    const formCreatedValueWidth = pdf.getTextWidth(formCreatedText);
    const formCreatedValueX = marginX + contentW - formCreatedValueWidth;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("Form created:", formCreatedValueX - pdf.getTextWidth("Form created:") - 2, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(39, 39, 42);
    pdf.text(formCreatedText, formCreatedValueX, 13);

    // Horizontal black divider line with lessened gap
    pdf.setDrawColor(24, 24, 27);
    pdf.setLineWidth(0.35);
    pdf.line(marginX, 28, marginX + contentW, 28);
  };

  drawPageHeader();

  let y = 36;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(24, 24, 27);
  pdf.text(safePdfText(report.title), marginX, y);
  y += 9;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageBottom) {
      pdf.addPage();
      drawPageHeader();
      y = 36;
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

    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(24, 24, 27);
    pdf.text("IDR M&M", marginX, 281);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(113, 113, 122);
    pdf.text("Generated with IDR M&M", marginX + 15, 281);

    pdf.text("Printed version is uncontrolled", marginX + contentW / 2, 280, { align: "center" });
    pdf.text(`Page ${page} of ${totalPages}`, marginX + contentW / 2, 284, { align: "center" });

    pdf.text("This PDF was created at", marginX + contentW, 280, { align: "right" });
    pdf.text(safePdfText(pdfCreatedTimestamp), marginX + contentW, 284, { align: "right" });
  }

  return pdf.output("blob");
}

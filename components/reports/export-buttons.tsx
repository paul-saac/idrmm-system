"use client";

import { useState, type RefObject } from "react";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import type { ReportData } from "@/lib/reports/data";
import { projectStatusLabel } from "@/lib/projects/status";

function money(amount: number) {
  return Math.round(amount * 100) / 100;
}

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

async function buildWorkbook(data: ReportData) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "IDR M&M Inc.";
  wb.created = new Date();

  const totalActual =
    data.overview.actual.labor +
    data.overview.actual.material +
    data.overview.actual.equipment +
    data.overview.actual.other;
  const allocatedBudget = data.project.allocatedBudget ?? 0;

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 22 },
  ];
  summary.addRows([
    { metric: "Project", value: data.project.name },
    { metric: "Status", value: projectStatusLabel(data.project.status) },
    { metric: "Location", value: data.project.location ?? "—" },
    { metric: "Project Manager", value: data.project.projectManagerName ?? "—" },
    { metric: "Foreman", value: data.project.foremanName ?? "—" },
    { metric: "Total Estimated Cost", value: money(data.totalEstimatedCost) },
    { metric: "Allocated Budget", value: money(allocatedBudget) },
    { metric: "Actual Expense", value: money(totalActual) },
    { metric: "Cost Variance", value: money(allocatedBudget - totalActual) },
    { metric: "Overall Progress", value: `${data.progressPercent}%` },
    { metric: "Start Date", value: data.project.startDate ?? "—" },
    { metric: "Target Completion", value: data.project.targetEndDate ?? "—" },
  ]);
  summary.getRow(1).font = { bold: true };

  const materialSheet = wb.addWorksheet("Material Expenses");
  materialSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Supplier / Type", key: "supplier", width: 24 },
    { header: "Material", key: "material", width: 26 },
    { header: "Specification", key: "spec", width: 20 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Cost", key: "cost", width: 14 },
  ];
  for (const group of data.materialRows) {
    for (const proc of group.procurements) {
      for (const item of proc.items) {
        materialSheet.addRow({
          date: group.logDate,
          supplier:
            proc.supplierName ||
            (proc.procurementType === "direct_purchase" ? "Direct Purchase" : "Supplier Delivery"),
          material: item.materialName,
          spec: item.specification ?? "",
          qty: item.quantity,
          unit: item.unit ?? "",
          cost: money(item.subTotal),
        });
      }
    }
  }
  materialSheet.getRow(1).font = { bold: true };

  const laborSheet = wb.addWorksheet("Labor Expenses");
  laborSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Worker Role", key: "role", width: 22 },
    { header: "Worker Count", key: "count", width: 14 },
    { header: "Daily Rate", key: "rate", width: 14 },
    { header: "OT Hours", key: "ot", width: 10 },
    { header: "Total", key: "total", width: 14 },
  ];
  for (const group of data.laborRows) {
    for (const item of group.items) {
      laborSheet.addRow({
        date: group.logDate,
        role: item.workerRole,
        count: item.workerCount,
        rate: money(item.dailyRate),
        ot: item.otHours,
        total: money(item.total),
      });
    }
  }
  laborSheet.getRow(1).font = { bold: true };

  const equipmentSheet = wb.addWorksheet("Equipment Expenses");
  equipmentSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Equipment", key: "name", width: 24 },
    { header: "Type", key: "type", width: 14 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Amount", key: "amount", width: 14 },
  ];
  for (const group of data.equipmentRows) {
    for (const item of group.items) {
      equipmentSheet.addRow({
        date: group.logDate,
        name: item.equipmentName,
        type: item.acquisitionType === "rental" ? "Rental" : "Purchase",
        qty: item.quantity,
        amount: money(item.amount),
      });
    }
  }
  equipmentSheet.getRow(1).font = { bold: true };

  return wb;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButtons({
  data,
  reportRef,
}: {
  data: ReportData;
  reportRef: RefObject<HTMLDivElement | null>;
}) {
  const [busy, setBusy] = useState<"pdf" | "excel" | null>(null);
  const baseName = sanitizeFileName(`${data.project.name} - Report`);

  async function handleExcelExport() {
    setBusy("excel");
    try {
      const wb = await buildWorkbook(data);
      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${baseName}.xlsx`
      );
    } finally {
      setBusy(null);
    }
  }

  async function handlePdfExport() {
    const node = reportRef.current;
    if (!node) return;
    setBusy("pdf");
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(node, { scale: 1.5, backgroundColor: "#ffffff" });
      // JPEG, not PNG: this report is a long, tall page (banner through
      // three tables), so at scale 1.5 the canvas can run several
      // thousand pixels tall — as lossless PNG that came out to ~27MB,
      // unusable as something to email or hand to a client. JPEG at
      // high quality on a mostly-flat/white dashboard shrinks that by
      // roughly 10x with no visible quality loss, and `compress: true`
      // adds further lossless PDF-stream compression on top.
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
        compress: true,
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${baseName}.pdf`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handlePdfExport}
        disabled={busy !== null}
        className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "pdf" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        Export PDF
      </button>
      <button
        type="button"
        onClick={handleExcelExport}
        disabled={busy !== null}
        className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "excel" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="size-4" />
        )}
        Export Excel
      </button>
    </div>
  );
}

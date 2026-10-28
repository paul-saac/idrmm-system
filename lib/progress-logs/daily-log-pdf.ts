import type { Incident } from "@/lib/incidents/model";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from "@/lib/incidents/model";
import type { OverrideLog } from "./types";

export type DailyLogPdfInput = {
  projectName: string;
  workItemName: string;
  unit: string | null;
  log: OverrideLog;
  incidents: Incident[];
};

function safe(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/₱/g, "PHP ")
    .replace(/[—–]/g, "-")
    .replace(/·/g, "|");
}

function peso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quantity(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 3 });
}

function reportDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
  });
}

function fileName(value: string) {
  return value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 150);
}

export async function downloadDailyLogPdf(input: DailyLogPdfInput) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const margin = 14;
  const width = 182;
  const bottom = 277;
  let y = 14;

  function footer() {
    pdf.setDrawColor(45); pdf.setLineWidth(0.25); pdf.line(margin, 283, margin + width, 283);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(90);
    pdf.text("IDR M&M | Daily Progress Log Report", margin, 288);
    pdf.text(`Page ${pdf.getNumberOfPages()}`, 105, 288, { align: "center" });
    pdf.text(`PDF created ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`, margin + width, 288, { align: "right" });
  }
  function nextPage(required = 14) {
    if (y + required <= bottom) return;
    footer(); pdf.addPage(); y = 14;
  }
  function section(title: string) {
    nextPage(12);
    pdf.setFillColor(235, 235, 235); pdf.rect(margin, y, width, 8, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(35); pdf.text(safe(title), margin + 3, y + 5.4);
    y += 10;
  }
  function row(label: string, value: string) {
    const lines = pdf.splitTextToSize(safe(value), 126) as string[];
    const height = Math.max(7, lines.length * 4 + 3);
    nextPage(height);
    pdf.setDrawColor(220); pdf.line(margin, y + height, margin + width, y + height);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(80); pdf.text(safe(label), margin + 2, y + 4.7);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(30); pdf.text(lines, margin + 54, y + 4.7);
    y += height;
  }

  const preparedBy = `${input.log.savedByName ?? "Unknown account"}${input.log.savedByRole ? ` · ${input.log.savedByRole}` : ""}`;
  const savedAt = new Date(input.log.createdAt).toLocaleString("en-US", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  // Keep the exported report masthead consistent with the formal reports page:
  // strong identity and title, compact metadata, then one full-width divider.
  pdf.setFont("times", "bold"); pdf.setFontSize(18); pdf.setTextColor(24, 24, 27);
  pdf.text("IDR M&M", margin, y + 5);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
  pdf.text("DAILY PROGRESS LOG", margin + width, y + 5, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(82, 82, 91);
  pdf.text(reportDate(input.log.entryDate), margin + width, y + 11, { align: "right" });

  y += 18;
  const headerRows = [
    ["Project", input.projectName],
    ["Task / Phase", input.workItemName],
    ["Prepared by", preparedBy],
    ["Saved at", savedAt],
  ] as const;
  for (const [label, value] of headerRows) {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(63, 63, 70);
    pdf.text(label, margin + 2, y);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(24, 24, 27);
    pdf.text(safe(value), margin + 34, y);
    y += 5;
  }
  pdf.setDrawColor(24, 24, 27); pdf.setLineWidth(0.35);
  pdf.line(margin, y + 1, margin + width, y + 1);
  y += 7;

  section("WORK PROGRESS AND COST SUMMARY");
  row("Quantity completed", `${quantity(input.log.quantityCompleted)}${input.unit ? ` ${input.unit}` : ""}`);
  row("Material cost", peso(input.log.costs.material));
  row("Labor cost", peso(input.log.costs.labor));
  row("Other cost", peso(input.log.costs.other));
  row("Equipment cost", peso(input.log.costs.equipment));

  if (input.log.materialsUsed.length) {
    section("MATERIALS USED");
    for (const item of input.log.materialsUsed) row(item.name, `${quantity(item.quantity)}${item.unit ? ` ${item.unit}` : ""}${item.unitCost == null ? "" : ` | ${peso(item.quantity * item.unitCost)}`}`);
  }
  if (input.log.attendance.length) {
    section("LABOR");
    for (const worker of input.log.attendance) row(worker.name, `${quantity(worker.hours)} hours | ${peso(worker.hours * worker.rate)}`);
  }
  if (input.log.equipmentCosts?.length) {
    section("EQUIPMENT COSTS");
    for (const item of input.log.equipmentCosts) row(item.unplanned ? `${item.name} (unplanned)` : item.name, peso(item.amount));
  }
  if (input.log.otherCosts?.length) {
    section("OTHER COSTS");
    for (const item of input.log.otherCosts) row(item.unplanned ? `${item.name} (unplanned)` : item.name, peso(item.amount));
  }
  if (input.incidents.length) {
    section("INCIDENT REPORTS");
    for (const incident of input.incidents) {
      row(INCIDENT_TYPES[incident.incident_type], INCIDENT_SEVERITIES[incident.severity]);
      if (incident.location) row("Location", incident.location);
      row("What happened", incident.description);
      row("Reported by", incident.reporter_name || "Project member");
      if (incident.attachments.length) row("Evidence", incident.attachments.map(item => item.name).join(", "));
    }
  }
  footer();
  pdf.save(`${fileName(`${input.projectName} - ${input.workItemName} - ${input.log.entryDate} Daily Progress Log`)}.pdf`);
}

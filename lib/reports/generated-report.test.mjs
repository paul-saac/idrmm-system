import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function load(file) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  const source = readFileSync(path, "utf8")
    .replace('"./closeout-model"', '"./closeout-model.ts"')
    .replace('"./punch-list-model"', '"./punch-list-model.ts"')
    .replace('"./quality-inspection-model"', '"./quality-inspection-model.ts"')
    .replace('"../incidents/model"', '"../incidents/model.ts"');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loadedModule = new Module(path);
  loadedModule.filename = path;
  loadedModule.paths = Module._nodeModulePaths(fileURLToPath(new URL(".", import.meta.url)));
  loadedModule._compile(output, path);
  return loadedModule.exports;
}
const { generateReport, generateAsBuiltReport, generatePunchListReport, generateFinancialReport, generateQualityReport, generateSafetyReport, MILESTONE_COLUMNS, AS_BUILT_SECTIONS, AS_BUILT_COLUMNS, FINANCIAL_REPORT_SECTIONS } = load("./generated-report.ts");
const { exportGeneratedReport } = load("./generated-report-export.ts");
const data = {
  project: { name: "Test project", startDate: "2026-01-01", targetEndDate: "2026-02-01", actualEndDate: null },
  asOf: "2026-03-01", progressPercent: 75,
  record: { notes: { summary: "Lifecycle review", outcomes: "Recorded outcomes" }, milestone_dates: { "task-1": "2026-01-15" } },
  work: [{ key: "task-1", name: "Foundation", phase: "Structure", milestone: true, end: "2026-01-14", percent: 100 }, { key: "task-2", name: "Roof", milestone: true, percent: 50 }],
};
const options = { title: "Closeout", sections: ["summary", "outcomes", "milestones", "performance"], columns: [...MILESTONE_COLUMNS], from: "", to: "" };
test("uses selected sections, columns and confirmed achievement dates only", () => {
  const report = generateReport(data, { ...options, sections: ["milestones"], columns: ["Milestone", "Variance (days)"] });
  assert.equal(report.sections.length, 1);
  assert.deepEqual(report.sections[0].rows, [["Foundation", 1]]);
  assert.equal(generateReport(data, { ...options, sections: ["milestones"], from: "2026-02-01" }).sections[0].rows.length, 0);
  assert.throws(() => generateReport(data, { ...options, from: "2026-03-01", to: "2026-01-01" }));
  assert.throws(() => generateReport(data, { ...options, columns: [] }));
  assert.throws(() => generateReport(data, { ...options, sections: [] }));
  assert.throws(() => generateReport(data, { ...options, title: " " }));
  assert.equal(generateReport(data, options).sections[3].rows[0][3], "Not recorded");
  assert.deepEqual(generateReport({ ...data, record: { ...data.record, notes: { lessons: "Confirm delivery dates early." } } }, { ...options, sections: ["lessons"] }).sections[0].paragraphs, ["Confirm delivery dates early."]);
});
test("PDF and Excel exports contain generated selections and numeric cells", async () => {
  const report = generateReport(data, options);
  const pdf = await exportGeneratedReport(report, "pdf");
  assert.ok((await pdf.text()).startsWith("%PDF-"));
  assert.ok((await pdf.text()).includes("Lifecycle review"));
  const excel = await exportGeneratedReport(report, "xlsx");
  const require = createRequire(import.meta.url);
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await excel.arrayBuffer());
  assert.equal(workbook.worksheets.length, 4);
  const sheet = workbook.worksheets[2];
  assert.equal(sheet.lastRow.getCell(1).value, "Foundation");
  assert.equal(sheet.lastRow.getCell(5).value, 1);
});

test("generates final financial report only from supported project cost records", async () => {
  const financialData = {
    ...data,
    project: { ...data.project, allocatedBudget: 150000 },
    costBaseline: {
      allocatedBudget: 150000,
      planned: { labor: 30000, material: 50000, equipment: 10000, other: 5000, total: 95000 },
      actual: { labor: 28000, material: 52000, equipment: 9000, other: 4000, total: 93000 },
    },
    deliverables: [{ name: "Structure", planned: 95000, logged: 93000 }],
    work: [{ ...data.work[0], planned: 95000, logged: 93000 }],
    expenses: [
      {
        id: "purchase-1", entryDate: "2026-01-05", itemName: "Cement", itemKey: "purchase-1",
        supplier: "Build Supply", invoiceNumber: "INV-001", savedByName: "Admin",
        materialPurchase: { quantity: 100, unit: "bags", unitPrice: 520 },
        costs: { material: 52000, labor: 0, equipment: 0, other: 0 },
      },
      {
        id: "task-1", entryDate: "2026-01-06", itemName: "Structure - Foundation", itemKey: "task-1", savedByName: "Foreman",
        attendance: [{ name: "Juan Dela Cruz", hours: 8, rate: 500 }],
        equipmentItems: [{ name: "Concrete mixer", amount: 9000, unplanned: false }],
        otherItems: [{ name: "Permit", amount: 4000, unplanned: true }],
        costs: { material: 0, labor: 4000, equipment: 9000, other: 4000 },
      },
    ],
  };
  const report = generateFinancialReport(financialData, { title: "Final financial & job cost report", sections: FINANCIAL_REPORT_SECTIONS.map(section => section.id), from: "", to: "" });
  assert.equal(report.reportType, "financial");
  assert.deepEqual(report.sections.map(section => section.title), [
    "A. Final cost summary",
    "B. Planned vs. actual by cost type",
    "C. Material cost breakdown",
    "D. Labor cost breakdown",
    "E. Equipment cost breakdown",
    "F. Other cost breakdown",
    "G. Job cost breakdown by category",
    "H. Job cost breakdown by task",
  ]);
  assert.equal(report.sections[1].rows[2][0], "Tools & Equipment");
  assert.equal(report.sections[2].rows[0][1], "Cement");
  assert.equal(report.sections[3].rows[0][1], "Juan Dela Cruz");
  assert.equal(report.sections[4].rows[0][1], "Concrete mixer");
  assert.equal(report.sections[5].rows[0][1], "Permit");
  assert.deepEqual(
    generateFinancialReport(financialData, { title: "Custom", sections: ["materials", "equipment"], from: "", to: "" }).sections.map(section => section.title),
    ["C. Material cost breakdown", "E. Equipment cost breakdown"]
  );
  const filtered = generateFinancialReport(financialData, { title: "Filtered", sections: ["summary", "materials"], from: "2026-01-06", to: "2026-01-31" });
  assert.equal(filtered.sections[0].rows[2][1], "PHP 17,000.00");
  assert.equal(filtered.sections[1].rows.length, 0);
  assert.throws(() => generateFinancialReport(financialData, { title: "Custom", sections: [], from: "", to: "" }));
  assert.throws(() => generateFinancialReport(financialData, { title: "Custom", sections: ["summary"], from: "2026-02-01", to: "2026-01-01" }));
  assert.ok(report.sections.flatMap(section => section.rows).flat().every(value => !String(value).toLowerCase().includes("revenue")));
  assert.ok((await exportGeneratedReport(report, "pdf")).size > 0);
  assert.ok((await exportGeneratedReport(report, "xlsx")).size > 0);
});

test("generates quality report from recorded inspections, tests, and linked documents", async () => {
  const sheets = [{ id: 12, sheet_number: "CERT-01", title: "Concrete Test Certificate", document_type: "other", status: "accepted" }];
  const qualityInspections = [{
    id: 3,
    inspection_type: "structural",
    inspection_scope: "Concrete footings",
    authority_type: "testing_laboratory",
    certificate_number: "LAB-2026-031",
    issued_on: "2026-02-21",
    standard_reference: "ACI 318",
    nonconformance_description: "",
    corrective_action_required: "",
    punch_item_id: null,
    reinspection_reference: "",
    related_work_name: "Concrete Footings",
    area: "Grid A-1",
    inspected_on: "2026-02-20",
    inspector_name: "Engr. Ana Cruz",
    inspector_role: "Structural Engineer",
    inspector_organization: "ABC Testing Laboratory",
    license_number: "PRC-12345",
    result: "passed",
    remarks: "Accepted based on supplied test result.",
    test_name: "Concrete compressive strength",
    acceptance_criteria: "At least 28 MPa",
    actual_result: "31.5",
    result_unit: "MPa",
    related_sheet_id: 12,
  }];
  const report = generateQualityReport({ ...data, sheets, qualityInspections, punchItems: [] }, { title: "Quality assurance and inspection sign-off report", from: "", to: "" });
  assert.equal(report.reportType, "quality");
  assert.equal(report.sections.length, 3);
  assert.deepEqual(report.sections.map(section => section.title), [
    "A. Inspection summary",
    "B. Test results",
    "C. Supporting certificates and sign-offs",
  ]);
  assert.equal(report.sections[0].rows[0][0], "INS-0003");
  assert.equal(report.sections[1].rows[0][4], "31.5 MPa");
  assert.ok(String(report.sections[2].rows[0][2]).includes("Concrete Test Certificate"));
  assert.ok((await exportGeneratedReport(report, "pdf")).size > 0);
  assert.ok((await exportGeneratedReport(report, "xlsx")).size > 0);
});

test("generates safety closeout report from recorded project incidents", async () => {
  const safetyIncidents = [{
    id: 8,
    project_id: 10,
    task_id: 3,
    category_id: null,
    context_name: "Site clearing",
    log_date: "2026-02-18",
    incident_type: "equipment_damage",
    severity: "moderate",
    occurred_on: "2026-02-18",
    occurred_time: "14:30:00",
    location: "Site entrance",
    description: "Truck mirror was damaged while reversing. No injury was reported.",
    attachments: [{ path: "10/u1/photo.jpg", name: "damage.jpg", type: "image/jpeg", size: 1200, url: "https://example.test/damage.jpg" }],
    reported_by: "u1",
    reporter_name: "Site Foreman",
    created_at: "2026-02-18T06:31:00Z",
  }];
  const report = generateSafetyReport({ ...data, safetyIncidents }, { title: "Safety and incident closeout report", from: "", to: "" });
  assert.equal(report.reportType, "safety");
  assert.equal(report.sections.length, 5);
  assert.equal(report.sections[0].rows[0][1], 1);
  assert.equal(report.sections[1].rows[0][2], "Equipment damage");
  assert.equal(report.sections[2].rows[0][3], safetyIncidents[0].description);
  assert.equal(report.sections[3].rows[0][2], "damage.jpg");
  assert.ok((await exportGeneratedReport(report, "pdf")).size > 0);
  assert.ok((await exportGeneratedReport(report, "xlsx")).size > 0);
});
test("generates detailed As-built drawing & record report across all sections and exports cleanly", async () => {
  const sheets = [
    {
      id: 1, project_id: 10, sheet_number: "A-01", title: "Ground Floor Plan", discipline: "Architectural",
      document_type: "drawing", revision: 1, stage: "original", file_path: "10/u1/a01-r1.pdf", file_name: "a01-r1.pdf",
      evidence_path: "10/u1/a01-r1.pdf", external_name: "Arch. Maria Santos", external_role: "Principal Architect",
      approval_date: "2026-01-10", change_notes: "", status: "accepted", submitted_by: "u1", submitted_name: "Carlos Reyes",
      created_at: "2026-01-10T08:00:00Z", reviewed_by: "admin1", reviewed_name: "Admin User", reviewed_at: "2026-01-11T09:00:00Z",
      review_notes: "Baseline accepted.",
    },
    {
      id: 2, project_id: 10, sheet_number: "A-01", title: "Ground Floor Plan", discipline: "Architectural",
      document_type: "drawing", revision: 2, stage: "as_built", file_path: "10/u1/a01-r2.pdf", file_name: "a01-r2.pdf",
      evidence_path: "10/u1/a01-r2.pdf", external_name: "Arch. Maria Santos", external_role: "Principal Architect",
      approval_date: "2026-02-20", change_notes: "Relocated north corridor partition by 300mm per SI-04.", status: "accepted",
      submitted_by: "u1", submitted_name: "Carlos Reyes", created_at: "2026-02-20T10:00:00Z",
      reviewed_by: "admin1", reviewed_name: "Admin User", reviewed_at: "2026-02-21T11:00:00Z",
      review_notes: "Verified against field inspection.",
    },
    {
      id: 3, project_id: 10, sheet_number: "BOM-01", title: "Structural Steel BOM", discipline: "General",
      document_type: "bom", revision: 1, stage: "original", file_path: "10/u1/bom01.pdf", file_name: "bom01.pdf",
      evidence_path: null, external_name: null, external_role: null, approval_date: null,
      change_notes: "Initial BOM baseline.", status: "submitted", submitted_by: "u1", submitted_name: "Carlos Reyes",
      created_at: "2026-01-12T08:00:00Z", reviewed_by: null, reviewed_name: null, reviewed_at: null, review_notes: null,
    },
  ];
  const asBuiltData = { ...data, sheets, sheetsAvailable: true };
  const asBuiltOptions = {
    title: "As-built drawing & record report",
    sections: AS_BUILT_SECTIONS.map(s => s.id),
    columns: [...AS_BUILT_COLUMNS],
    from: "",
    to: "",
  };
  const report = generateAsBuiltReport(asBuiltData, asBuiltOptions);
  assert.equal(report.sections.length, 5);
  // Register section shows Original vs Revision 1 and revision count
  const registerSection = report.sections[1];
  assert.equal(registerSection.rows.length, 2);
  assert.equal(registerSection.rows[0][0], "A-01");
  assert.equal(registerSection.rows[0][4], "Revision 1");
  assert.equal(registerSection.rows[0][5], "As-built");
  assert.equal(registerSection.rows[0][6], 1);
  assert.equal(registerSection.rows[1][0], "BOM-01");
  assert.equal(registerSection.rows[1][4], "Original");
  assert.equal(registerSection.rows[1][6], 0);

  // Comparison section compares Original baseline with Latest version
  const comparisonSection = report.sections[2];
  assert.ok(String(comparisonSection.rows[0][7]).includes("Relocated north corridor partition"));

  // Changes section lists all 3 versions chronologically per sheet
  const changesSection = report.sections[3];
  assert.equal(changesSection.rows.length, 3);
  assert.equal(changesSection.rows[0][2], "Original");
  assert.equal(changesSection.rows[1][2], "Revision 1");

  // Exports to PDF and Excel
  const pdf = await exportGeneratedReport(report, "pdf");
  assert.ok((await pdf.text()).includes("Relocated north corridor partition"));
  const excel = await exportGeneratedReport(report, "xlsx");
  assert.ok(excel.size > 0);
});

test("generates one simple traceable report section per punch item", () => {
  const punchItem = {
    id: 7,
    title: "Missing outlet cover",
    description: "Install the missing cover before turnover.",
    area: "Ground floor",
    specific_location: "Room 102",
    related_work_name: "Electrical fixtures",
    issue_type: "incomplete",
    priority: "high",
    status: "open",
    responsible_trade: "Electrical team",
    assigned_to_name: "Site Foreman",
    identified_on: "2026-02-10",
    identified_by_name: "Project Manager",
    due_date: "2026-02-14",
    correction_notes: "Cover installed.",
    verification_notes: "Awaiting final inspection.",
    before_photo_url: "https://example.test/before.jpg",
    after_photo_url: "https://example.test/after.jpg",
    resolved_at: null,
    verified_at: null,
    verified_by_name: null,
  };
  const report = generatePunchListReport({ ...data, punchItems: [punchItem] }, { title: "Punch list report", from: "", to: "" });
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].title, "Punch List · PL-0007");
  assert.deepEqual(report.sections[0].rows.at(-1), ["Current status", "Open"]);
  assert.ok(report.sections[0].paragraphs.some(value => value.includes("Install the missing cover")));
});

test("generates punch list report format with punchDetails and exports PDF matching template", async () => {
  const punchItem = {
    id: 1,
    title: "Chipped baseboard paint",
    description: "Repaint baseboard along west wall.",
    area: "Living Room",
    specific_location: "West wall, corner",
    related_work_name: "Finishes",
    issue_type: "workmanship",
    priority: "low",
    status: "open",
    responsible_trade: "Painting Crew",
    assigned_to_name: "Foreman John",
    identified_on: "2026-02-12",
    created_at: "2026-02-12T08:30:00Z",
    identified_by_name: "PM Santos",
    due_date: "2026-02-16",
    correction_notes: "",
    verification_notes: "",
    before_photo_url: "https://example.test/paint.jpg",
    after_photo_url: null,
    resolved_at: null,
    verified_at: null,
    verified_by_name: null,
  };
  const report = generatePunchListReport({ ...data, punchItems: [punchItem] }, { title: "Punch List", from: "", to: "" });
  assert.equal(report.reportType, "punch");
  assert.ok(report.punchDetails);
  assert.equal(report.punchDetails.length, 1);
  assert.equal(report.punchDetails[0].itemNumber, "PL-0001");
  assert.ok(report.punchDetails[0].formNumber.includes("DP-QUAL-0001"));
  assert.equal(report.punchDetails[0].trade, "Painting Crew");
  assert.equal(report.punchDetails[0].area, "Living Room");
  assert.equal(report.punchDetails[0].specificLocation, "West wall, corner");

  const pdf = await exportGeneratedReport(report, "pdf");
  assert.ok(pdf.size > 0);
  const pdfText = await pdf.text();
  assert.ok(pdfText.includes("Punch List"));
  assert.ok(!pdfText.includes("DP-QUAL-0014"));
  assert.ok(pdfText.includes("Organisation:"));
  assert.ok(pdfText.includes("Prepared By:"));
  assert.ok(pdfText.includes("Form created:"));
});

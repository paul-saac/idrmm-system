import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function load(file) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  const source = readFileSync(path, "utf8").replace('"./closeout-model"', '"./closeout-model.ts"');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = new Module(path);
  module.filename = path;
  module.paths = Module._nodeModulePaths(fileURLToPath(new URL(".", import.meta.url)));
  module._compile(output, path);
  return module.exports;
}
const { generateReport, generateAsBuiltReport, MILESTONE_COLUMNS, AS_BUILT_SECTIONS, AS_BUILT_COLUMNS } = load("./generated-report.ts");
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

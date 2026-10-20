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
const { generateReport, MILESTONE_COLUMNS } = load("./generated-report.ts");
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

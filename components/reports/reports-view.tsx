"use client";

import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { ProjectPicker, type ProjectOption } from "./project-picker";
import { ReportBuilder } from "./report-builder";


export function ReportsView({ projects, selectedProjectId, data }: {
  projects: ProjectOption[];
  selectedProjectId: number | null;
  data: CloseoutReportData | null;
}) {
  if (projects.length === 0) return <p className="p-8 text-sm text-zinc-500">No projects yet — create one to generate reports.</p>;
  if (!data) return <div className="flex flex-col items-center gap-3 py-16">
    <p className="text-sm text-zinc-500">Select a project to view its report.</p>
    <ProjectPicker projects={projects} selectedProjectId={selectedProjectId} />
  </div>;

  return <ReportBuilder key={data.project.id} data={data} projects={projects} />;
}

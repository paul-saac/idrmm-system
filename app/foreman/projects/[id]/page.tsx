import type { Metadata } from "next";
import { ProjectDetailPage } from "@/components/projects/project-detail-page";

export const metadata: Metadata = { title: "Project Details" };

// DAILY LOGS — ON HOLD: there's no foreman daily-log detail route
// (app/admin/projects/[id]/daily-logs/[logId] has no foreman counterpart
// yet), and the Daily Logs tab is hidden in the foreman portal.
export default async function ForemanProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetailPage projectId={Number(id)} />;
}

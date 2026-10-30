import type { Metadata } from "next";
import { ProjectDetailPage } from "@/components/projects/project-detail-page";

export const metadata: Metadata = { title: "Project Details" };

export default async function ForemanProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetailPage projectId={Number(id)} />;
}

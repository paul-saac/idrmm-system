import { notFound, redirect } from "next/navigation";

export default async function ProjectManagerMaterialRequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const projectId = Number(id);
  const materialRequestId = Number(requestId);

  if (!Number.isFinite(projectId) || !Number.isFinite(materialRequestId)) {
    notFound();
  }

  redirect(
    `/project-manager/projects/${projectId}?tab=materials&subtab=requests&request=${materialRequestId}`
  );
}

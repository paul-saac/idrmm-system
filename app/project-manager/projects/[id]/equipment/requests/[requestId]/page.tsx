import { notFound, redirect } from "next/navigation";

export default async function ProjectManagerEquipmentRequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const projectId = Number(id);
  const equipmentRequestId = Number(requestId);

  if (!Number.isFinite(projectId) || !Number.isFinite(equipmentRequestId)) {
    notFound();
  }

  redirect(
    `/project-manager/projects/${projectId}?tab=equipment&subtab=requests&request=${equipmentRequestId}`
  );
}

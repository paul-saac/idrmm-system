import { notFound, redirect } from "next/navigation";

// An equipment request opens in its row of the project's Equipment tab,
// not on a page of its own — a link here lands there, with the request open.
export default async function ForemanEquipmentRequestPage({
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
    `/foreman/projects/${projectId}?tab=equipment&subtab=requests&request=${equipmentRequestId}`
  );
}

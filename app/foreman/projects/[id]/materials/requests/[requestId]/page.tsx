import { notFound, redirect } from "next/navigation";

// A material request opens in its row of the project's Materials tab, not
// on a page of its own — a link here lands there, with the request open.
export default async function ForemanMaterialRequestPage({
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
    `/foreman/projects/${projectId}?tab=materials&subtab=requests&request=${materialRequestId}`
  );
}

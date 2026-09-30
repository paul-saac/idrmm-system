import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMaterialRequestDetail } from "@/lib/material-requests/data";
import { MaterialRequestDetailView } from "@/components/projects/materials/material-request-detail-view";

export const metadata: Metadata = { title: "Material Request" };

// Row-level security only returns requests on the foreman's own projects,
// so any other request id resolves to null and 404s below.
export default async function ForemanMaterialRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { requestId } = await params;
  const materialRequestId = Number(requestId);

  if (!Number.isFinite(materialRequestId)) {
    notFound();
  }

  const request = await getMaterialRequestDetail(materialRequestId);

  if (!request) {
    notFound();
  }

  return <MaterialRequestDetailView request={request} />;
}

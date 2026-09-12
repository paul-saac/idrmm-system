import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMaterialRequestDetail } from "@/lib/material-requests/data";
import { MaterialRequestDetailView } from "@/components/projects/materials/material-request-detail-view";

export const metadata: Metadata = { title: "Material Request" };

export default async function MaterialRequestDetailPage({
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

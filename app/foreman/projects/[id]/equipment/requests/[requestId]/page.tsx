import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEquipmentRequestDetail } from "@/lib/equipment-requests/data";
import { EquipmentRequestDetailView } from "@/components/projects/equipment/equipment-request-detail-view";

export const metadata: Metadata = { title: "Equipment Request" };

// Row-level security only returns requests on the foreman's own projects,
// so any other request id resolves to null and 404s below.
export default async function ForemanEquipmentRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { requestId } = await params;
  const equipmentRequestId = Number(requestId);

  if (!Number.isFinite(equipmentRequestId)) {
    notFound();
  }

  const request = await getEquipmentRequestDetail(equipmentRequestId);

  if (!request) {
    notFound();
  }

  return <EquipmentRequestDetailView request={request} />;
}

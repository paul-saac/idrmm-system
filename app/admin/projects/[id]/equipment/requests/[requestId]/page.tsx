import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEquipmentRequestDetail } from "@/lib/equipment-requests/data";
import { EquipmentRequestDetailView } from "@/components/projects/equipment/equipment-request-detail-view";

export const metadata: Metadata = { title: "Equipment Request" };

export default async function EquipmentRequestDetailPage({
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

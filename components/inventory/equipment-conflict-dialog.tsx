"use client";

import { TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { equipmentTaskDateRange } from "@/lib/equipment/usage-status";
import type { EquipmentConflict } from "@/lib/equipment/tracking-types";

export function EquipmentConflictDialog({ conflict, onClose }: { conflict: EquipmentConflict | null; onClose: () => void }) {
  return <Modal open={!!conflict} onClose={onClose} title="Equipment assignment conflict" variant="centered" size="small">
    {conflict && <div className="space-y-4 text-sm">
      <div role="alert" className="flex items-start gap-3">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <p><strong>{conflict.equipment}</strong> is already assigned to unfinished work during the selected dates.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-zinc-200 py-3">
        <dt className="text-zinc-500">Project</dt><dd>{conflict.projectName || "Another project"}</dd>
        <dt className="text-zinc-500">Task</dt><dd>{conflict.task}</dd>
        {(conflict.startDate || conflict.endDate) && <><dt className="text-zinc-500">Dates</dt><dd>{equipmentTaskDateRange(conflict.startDate, conflict.endDate)}</dd></>}
      </dl>
      <p className="text-zinc-500">Choose another equipment item or adjust the task schedule. Your selections have not been saved.</p>
      <div className="flex justify-end"><button type="button" onClick={onClose} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 hover:bg-zinc-50">Close</button></div>
    </div>}
  </Modal>;
}

"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useMemo, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { InitialsAvatar } from "@/components/ui/list-table";
import type { Worker } from "@/lib/workers/data";

const formatPeso = (n: number) =>
  "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type WorkerTab = "skilled" | "subcontractors";

export function WorkerPickerModal({
  open,
  workers,
  title = "Add workforce",
  description = "Select a skilled worker or subcontractor who worked on this task today.",
  icon = <Users className="size-5" />,
  variant = "centered",
  onSelect,
  onClose,
}: {
  open: boolean;
  workers: readonly Worker[];
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  variant?: "panel" | "centered";
  onSelect: (worker: Worker) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkerTab>("skilled");
  const [search, setSearch] = useState("");

  const tabCounts = useMemo(() => {
    let skilled = 0;
    let subcontractors = 0;
    for (const w of workers) {
      if (w.employmentType === "subcontractor") {
        subcontractors++;
      } else if (w.category === "skilled") {
        skilled++;
      }
    }

    return { skilled, subcontractors };
  }, [workers]);

  const tabs: { key: WorkerTab; label: string; count: number }[] = useMemo(
    () => [
      { key: "skilled", label: "Skilled Workers", count: tabCounts.skilled },
      { key: "subcontractors", label: "Subcontractors", count: tabCounts.subcontractors },
    ],
    [tabCounts]
  );

  const filteredWorkers = useMemo(() => {
    const list = workers.filter((w) =>
      activeTab === "subcontractors"
        ? w.employmentType === "subcontractor"
        : w.employmentType !== "subcontractor" && w.category === "skilled"
    );

    const q = search.trim().toLowerCase();
    if (!q) return list;

    return list.filter(
      (w) =>
        w.fullName.toLowerCase().includes(q) ||
        (w.title && w.title.toLowerCase().includes(q)) ||
        (w.employmentType && w.employmentType.toLowerCase().includes(q)) ||
        (w.subcontractorCompany && w.subcontractorCompany.toLowerCase().includes(q))
    );
  }, [workers, activeTab, search]);

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      icon={icon}
      variant={variant}
      size="wide"
      onClose={onClose}
    >
      <div className="flex h-[32rem] min-h-0 flex-col gap-4">
        {/* Search input */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member by name, role, or trade..."
            className="h-[38px] w-full rounded-md border border-zinc-200 bg-white pr-9 pl-9 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              title="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div role="tablist" aria-label="Worker categories" className="flex gap-4 overflow-x-auto border-b border-zinc-200 px-1 pt-1 pb-0">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 pb-2.5 text-xs sm:text-sm font-medium whitespace-nowrap transition ${
                  active
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                    active ? "bg-zinc-100 text-zinc-900 font-semibold" : "bg-zinc-50 text-zinc-400"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Member list / table without Action column */}
        <div key={activeTab} className="tab-content-enter min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {filteredWorkers.length === 0 ? (
            <EmptyState className="h-full px-6">
              {workers.length === 0 ? (
                <p>All available team members have already been added to this task.</p>
              ) : (
                <p>No team members matching &ldquo;{search}&rdquo;</p>
              )}
            </EmptyState>
          ) : (
            <div className="h-full overflow-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                  <tr>
                    <th className="px-5 py-3">Member</th>
                    <th className="px-4 py-3">Role / Trade</th>
                    <th className="px-4 py-3">Rate</th>
                    <th className="px-4 py-3">Employment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredWorkers.map((worker) => (
                    <tr
                      key={worker.id}
                      onClick={() => {
                        onSelect(worker);
                        onClose();
                      }}
                      className="cursor-pointer transition hover:bg-zinc-50"
                    >
                      <td className="px-5 py-3 font-medium text-zinc-900">
                        <div className="flex items-center gap-2.5">
                          <InitialsAvatar name={worker.fullName} />
                          <span className="truncate">{worker.fullName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {worker.title ? (
                          <span className="truncate text-xs">{worker.title}</span>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-zinc-700">
                        {worker.hourlyRate !== null ? (
                          `${formatPeso(worker.hourlyRate)}/hr`
                        ) : (
                          <span className="text-amber-600">No rate</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        {worker.employmentType === "subcontractor" ? (
                          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 font-medium">
                            Subcontractor{worker.subcontractorCompany ? ` (${worker.subcontractorCompany})` : ""}
                          </span>
                        ) : (
                          <span className="capitalize">{worker.employmentType || "Employee"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </ModalFooter>
    </Modal>
  );
}

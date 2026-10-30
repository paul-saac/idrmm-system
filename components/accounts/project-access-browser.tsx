"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { InitialsAvatar } from "@/components/ui/list-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { ProjectAccessEditor, type ProjectAccessChange } from "./project-access-editor";
import { saveProjectAccess } from "@/lib/accounts/project-access";
import { roleLabel } from "@/lib/auth/roles";
import type { AccountRow } from "@/lib/accounts/data";

export function ProjectAccessBrowser({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [changes, setChanges] = useState<ProjectAccessChange[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!selected || !changes.length || saving) return;
    setSaving(true); setError(null);
    try {
      const result = await saveProjectAccess(selected.id, changes);
      if (result.error) { setError(result.error); return; }
      setSelected(null); setChanges([]); router.refresh();
    } catch { setError("Could not save project access. Please retry."); }
    finally { setSaving(false); }
  }
  const filtered = accounts.filter(account => `${account.firstName} ${account.lastName} ${account.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-zinc-900">Project access <span className="ml-2 text-xs font-normal text-zinc-400">{filtered.length}</span></h2><label className="relative"><span className="sr-only">Search accounts</span><Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or email" className="rounded border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400" /></label></div>
    <div className="overflow-hidden rounded border border-zinc-200 bg-white">
      {!filtered.length ? <EmptyState className="py-10">No accounts match.</EmptyState> : <ul className="divide-y divide-zinc-200">{filtered.map(account => {
        const name = `${account.firstName} ${account.lastName}`.trim() || account.email;
        return <li key={account.id}><button type="button" onClick={() => { setChanges([]); setError(null); setSelected(account); }} className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition hover:bg-zinc-50"><InitialsAvatar name={name} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-zinc-900">{name}</span><span className="block truncate text-xs text-zinc-500">{account.email}</span></span><span className="text-xs text-zinc-500">{roleLabel(account.role)}</span></button></li>;
      })}</ul>}
    </div>
    <Modal open={selected !== null} onClose={() => { if (!saving) setSelected(null); }} title="Manage project access" size="wide">
      {selected && <><div className="mb-5 flex items-center gap-3"><InitialsAvatar name={`${selected.firstName} ${selected.lastName}`} /><div><h3 className="text-base font-semibold">{selected.firstName} {selected.lastName}</h3><p className="text-xs text-zinc-500">{selected.email} · {roleLabel(selected.role)}</p></div></div><ProjectAccessEditor key={selected.id} accountId={selected.id} initialSettings={selected.accessPreview} disabled={saving} onChangesChange={setChanges} /><ModalFooter>{error && <p role="alert" className="mr-auto text-sm text-red-600">{error}</p>}<button type="button" disabled={saving} onClick={() => setSelected(null)} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm">Cancel</button><button type="button" disabled={saving || !changes.length} onClick={save} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></ModalFooter></>}
    </Modal>
  </div>;
}

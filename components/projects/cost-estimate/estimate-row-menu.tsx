"use client";

import { useId, useRef, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";

export function RowMenu({ name, actions, disabled = false }: { name: string; disabled?: boolean; actions: { label: string; run: () => void; destructive?: boolean }[] }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  return <>
    <button type="button" disabled={disabled} popoverTarget={id} aria-label={`Manage ${name || "row"}`} title="Manage row"
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(rect.right - 172, window.innerWidth - 180)), top: Math.min(rect.bottom + 4, window.innerHeight - actions.length * 34 - 16) });
      }} className="flex size-7 cursor-pointer items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50">
      <MoreHorizontal aria-hidden className="size-4" />
    </button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={`Manage ${name || "row"}`} style={{ ...position, right: "auto", bottom: "auto" }}
      className="fixed m-0 w-43 overflow-hidden rounded border border-zinc-200 bg-white p-0 text-xs text-zinc-700 shadow-md">
      {actions.map(action => <button key={action.label} type="button" disabled={disabled} role="menuitem" onClick={() => { menu.current?.hidePopover(); action.run(); }}
        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 ${action.destructive ? "text-red-600" : "text-zinc-700"}`}>
        {action.destructive ? <Trash2 aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}{action.label}
      </button>)}
    </div>
  </>;
}


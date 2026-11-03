"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";

type RequestKind = "material" | "equipment";
type Sync = {
  materials: MaterialRequestDetail[];
  canceled: ReadonlySet<string>;
  error: string | null;
  saveMaterial: (request: MaterialRequestDetail) => void;
  setCanceled: (kind: RequestKind, id: number, value: boolean) => void;
  setError: (error: string | null) => void;
};
const Context = createContext<Sync | null>(null);
export function RequestSyncProvider({ children }: { children: ReactNode }) {
  const [materials, setMaterials] = useState<MaterialRequestDetail[]>([]);
  const [canceled, setCanceledState] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  return <Context.Provider value={{ materials, canceled, error, setError,
    saveMaterial: request => setMaterials(previous => [request, ...previous.filter(row => row.id !== request.id)]),
    setCanceled: (kind, id, value) => setCanceledState(previous => {
      const next = new Set(previous), key = `${kind}:${id}`;
      if (value) next.add(key); else next.delete(key);
      return next;
    }),
  }}>{children}</Context.Provider>;
}
export const useRequestSync = () => useContext(Context);

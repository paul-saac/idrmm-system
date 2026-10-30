"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

const ProjectEditContext = createContext(true);

export function ProjectAccessProvider({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  return <ProjectEditContext.Provider value={canEdit}>{children}</ProjectEditContext.Provider>;
}

export function useProjectCanEdit() {
  return useContext(ProjectEditContext);
}

export function ProjectWriteButton({ disabled, className = "", ...props }: ComponentProps<"button">) {
  const canEdit = useProjectCanEdit();
  return <button {...props} disabled={!canEdit || disabled} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`} />;
}

export function ProjectWriteInput({ disabled, ...props }: ComponentProps<"input">) {
  const canEdit = useProjectCanEdit();
  return <input {...props} disabled={!canEdit || disabled} />;
}

export function ProjectWriteSelect({ disabled, ...props }: ComponentProps<"select">) {
  const canEdit = useProjectCanEdit();
  return <select {...props} disabled={!canEdit || disabled} />;
}

export function ProjectWriteTextarea({ disabled, ...props }: ComponentProps<"textarea">) {
  const canEdit = useProjectCanEdit();
  return <textarea {...props} disabled={!canEdit || disabled} />;
}

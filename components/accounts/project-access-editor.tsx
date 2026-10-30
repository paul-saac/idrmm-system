"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LockKeyhole } from "lucide-react";
import { Checkbox } from "@/components/ui/list-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  loadProjectAccess,
  type AccessLevel,
  type ProjectAccessSettings,
} from "@/lib/accounts/project-access";

export type ProjectAccessChange = {
  id: number;
  previous: AccessLevel;
  level: AccessLevel;
};

export function ProjectAccessEditor({
  accountId,
  initialSettings,
  showHeading = true,
  disabled = false,
  onChangesChange,
}: {
  accountId: string;
  initialSettings?: ProjectAccessSettings;
  showHeading?: boolean;
  disabled?: boolean;
  onChangesChange?: (changes: ProjectAccessChange[]) => void;
}) {
  const [settings, setSettings] = useState<ProjectAccessSettings | null>(
    () => initialSettings ?? null
  );
  const [draft, setDraft] = useState<Record<number, AccessLevel>>(() =>
    initialSettings
      ? Object.fromEntries(
          initialSettings.projects.map((project) => [project.id, project.level])
        )
      : {}
  );
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadProjectAccess(accountId).then((result) => {
      if (cancelled) return;
      if (result.settings) {
        setSettings(result.settings);
        setDraft(
          Object.fromEntries(
            result.settings.projects.map((project) => [project.id, project.level])
          )
        );
        setError(null);
      } else if (!initialSettings) {
        setError(result.error ?? "Could not load project access.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, reload, initialSettings]);

  useEffect(() => {
    if (!onChangesChange) return;
    if (!settings || !settings.eligible) {
      onChangesChange([]);
      return;
    }
    const nextChanges = settings.projects
      .filter((project) => (draft[project.id] ?? project.level) !== project.level)
      .map((project) => ({
        id: project.id,
        previous: project.level,
        level: draft[project.id] ?? project.level,
      }));
    onChangesChange(nextChanges);
  }, [settings, draft, onChangesChange]);

  return (
    <div className="flex flex-col gap-3">
      {showHeading && (
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <LockKeyhole className="size-4 text-zinc-500" /> Access
        </h3>
      )}
      <p className="text-xs text-zinc-500">
        Select projects and choose what this account can do. Existing role restrictions still apply.
      </p>
      {settings && settings.projects.length === 0 && (
        <EmptyState compact className="py-4">
          No projects available to manage.
        </EmptyState>
      )}
      {settings && settings.projects.length > 0 && (
        <div className="max-h-80 overflow-auto rounded border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <span className="sr-only">Allow project access</span>
                </th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="w-40 px-3 py-2 font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {settings.projects.map((project) => {
                const level = draft[project.id] ?? project.level;
                const enabled = level !== "none";
                return (
                  <tr key={project.id}>
                    <td className="px-3 py-3">
                      <span
                        className={disabled ? "pointer-events-none opacity-50" : ""}
                        inert={disabled || !settings.eligible}
                      >
                        <Checkbox
                          checked={enabled}
                          label={`Allow access to ${project.name}`}
                          onChange={() => {
                            setDraft((previous) => ({
                              ...previous,
                              [project.id]: enabled ? "none" : "view",
                            }));
                          }}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-zinc-900">{project.name}</p>
                      {project.location && (
                        <p className="mt-0.5 text-xs text-zinc-500">{project.location}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="relative block">
                        <select
                          aria-label={`${project.name} access level`}
                          value={enabled ? level : "view"}
                          disabled={!enabled || disabled || !settings.eligible}
                          onChange={(event) => {
                            setDraft((previous) => ({
                              ...previous,
                              [project.id]: event.target.value as AccessLevel,
                            }));
                          }}
                          className="w-full cursor-pointer appearance-none rounded border border-zinc-200 bg-white py-2 pr-8 pl-3 text-xs text-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
                        >
                          <option value="view">View only</option>
                          <option value="edit">View & edit</option>
                        </select>
                        <ChevronDown
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-zinc-400"
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setReload((value) => value + 1)}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Reload access
          </button>
        </div>
      )}
    </div>
  );
}

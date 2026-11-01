"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  createProjectEvent,
  updateProjectEvent,
  type ProjectEventActionState,
} from "@/lib/project-events/actions";
import {
  EVENT_NAME_MAX_LENGTH,
  PROJECT_EVENT_TYPES,
  formatDuration,
  formatTime,
  minutesToTime,
  timeToMinutes,
  type ProjectEvent,
  type ProjectEventType,
} from "@/lib/project-events/types";
import { toLocalDate } from "@/lib/task-progress/calculate";

const DATE_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Meeting times in 15-minute steps: a start from 6:00 AM to 9:00 PM, an
// end any time after it until 10:00 PM.
const STEP = 15;
const FIRST_START = 6 * 60;
const LAST_START = 21 * 60;
const LAST_END = 22 * 60;
const DEFAULT_START = "09:00";
const DEFAULT_END = "10:00";

const START_OPTIONS = Array.from(
  { length: (LAST_START - FIRST_START) / STEP + 1 },
  (_, i) => minutesToTime(FIRST_START + i * STEP)
);

const FIELD_CLASS =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

function Select({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD_CLASS} cursor-pointer appearance-none pr-8`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

/**
 * Add (or edit) one calendar event — a holiday or a meeting — on the
 * Calendar view's day (see 0055_project_events.sql). The day itself isn't editable here; it
 * comes from where Add event was clicked. Start/End time only applies to
 * a meeting, so it only shows for one.
 */
export function ProjectEventModalContent({
  projectId,
  date,
  event,
  onClose,
  onSaved,
  onDelete,
}: {
  projectId: number;
  /** YYYY-MM-DD */
  date: string;
  /** Set when editing an existing event. */
  event?: ProjectEvent;
  onClose: () => void;
  onSaved: (result: ProjectEventActionState) => void;
  onDelete?: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<ProjectEventType>(event?.type ?? "holiday");
  const [name, setName] = useState(event?.name ?? "");
  const [startTime, setStartTime] = useState(event?.startTime ?? DEFAULT_START);
  const [endTime, setEndTime] = useState(event?.endTime ?? DEFAULT_END);
  const [isWorkingDay, setIsWorkingDay] = useState(event?.isWorkingDay ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMeeting = type === "meeting";
  const startMinutes = timeToMinutes(startTime);
  const endOptions = Array.from(
    { length: Math.max(0, (LAST_END - startMinutes) / STEP) },
    (_, i) => startMinutes + (i + 1) * STEP
  );

  function handleStartChange(value: string) {
    setStartTime(value);
    // Keep the same length when moving the start, as long as it fits.
    const length = timeToMinutes(endTime) - startMinutes;
    const nextEnd = Math.min(LAST_END, timeToMinutes(value) + Math.max(STEP, length));
    setEndTime(minutesToTime(nextEnd));
  }

  async function run(action: () => Promise<ProjectEventActionState>) {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      if (result.error) { setError(result.error); return; }
      onSaved(result);
      onClose();
      router.refresh();
    } catch { setError("Could not save the event. Please try again."); }
    finally { setPending(false); }
  }

  function handleSave() {
    const input = {
      type,
      isWorkingDay,
      name,
      date,
      startTime: isMeeting ? startTime : null,
      endTime: isMeeting ? endTime : null,
    };
    return run(() =>
      event
        ? updateProjectEvent(event.id, projectId, input)
        : createProjectEvent(projectId, input)
    );
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      {!event?.nationalHoliday && <div className="flex flex-col gap-1.5">
        <label htmlFor="event-type" className="text-sm font-medium text-zinc-900">
          Type<RequiredMark /></label>
        <Select id="event-type" value={type} onChange={(value) => setType(value as ProjectEventType)}>
          {PROJECT_EVENT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-name" className="text-sm font-medium text-zinc-900">
          Name<RequiredMark /></label>
        <input
          id="event-name"
          value={name}
          readOnly={event?.nationalHoliday}
          onChange={(e) => setName(e.target.value)}
          maxLength={EVENT_NAME_MAX_LENGTH}
          autoComplete="off"
          className={FIELD_CLASS}
        />
      </div>

      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-900">Date</span>
          <p className="py-2 text-sm text-zinc-700">{DATE_LABEL.format(toLocalDate(date))}</p>
        </div>
        {isMeeting && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-900">Time<RequiredMark /></span>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select id="event-start" value={startTime} onChange={handleStartChange}>
                  {START_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {formatTime(time)}
                    </option>
                  ))}
                </Select>
              </div>
              <span className="text-zinc-400">–</span>
              <div className="min-w-0 flex-1">
                <Select id="event-end" value={endTime} onChange={setEndTime}>
                  {endOptions.map((minutes) => (
                    <option key={minutes} value={minutesToTime(minutes)}>
                      {formatTime(minutesToTime(minutes))} ({formatDuration(minutes - startMinutes)})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      {type === "holiday" && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={isWorkingDay} onChange={e => setIsWorkingDay(e.target.checked)} disabled={pending} className="accent-zinc-700" />
          Include in working days
        </label>
      )}
      {type === "holiday" && <p className="text-xs text-zinc-500">When included, this date follows the project&apos;s weekly working-day schedule.</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          {onDelete && <button type="button" onClick={onDelete} disabled={pending} className="cursor-pointer rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">Delete</button>}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : event ? "Save" : "Add event"}
          </button>
        </div>
      </div>
    </div>
  );
}

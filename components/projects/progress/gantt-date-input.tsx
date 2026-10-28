"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";

/** Keeps the native segmented date editor; replaces only its calendar popup. */
export function GanttDateInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarActive = useRef(false);
  const [calendar, setCalendar] = useState<{ anchor: HTMLInputElement; value: string } | null>(null);

  function openCalendar() {
    const input = inputRef.current;
    if (input) {
      calendarActive.current = true;
      setCalendar({ anchor: input, value: input.value });
    }
  }

  function closeCalendar() {
    calendarActive.current = false;
    setCalendar(null);
    // Commit only after leaving the popup, not when focusing its controls.
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.blur();
    }
  }

  return (
    <div className="gantt-date-input group relative h-full w-full">
      <input
        {...props}
        ref={inputRef}
        onBlur={(event) => {
          if (!calendarActive.current) props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if ((event.altKey && event.key === "ArrowDown") || event.key === "F4") {
            event.preventDefault();
            openCalendar();
          } else {
            props.onKeyDown?.(event);
          }
        }}
      />
      <button
        type="button"
        aria-label={`Open ${props["aria-label"] ?? "date"} calendar`}
        aria-haspopup="dialog"
        aria-expanded={Boolean(calendar)}
        className="absolute inset-y-0 right-2 flex cursor-pointer items-center text-zinc-500 opacity-0 group-focus-within:opacity-100"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          inputRef.current?.focus();
          if (calendar) closeCalendar();
          else openCalendar();
        }}
      >
        <CalendarDays aria-hidden className="size-3.5" />
      </button>
      {calendar && (
        <DatePicker
          calendarAnchor={calendar.anchor}
          defaultValue={calendar.value}
          ariaLabel={props["aria-label"] ?? "Date"}
          min={props.min === undefined ? undefined : String(props.min)}
          max={props.max === undefined ? undefined : String(props.max)}
          onCalendarClose={closeCalendar}
          onChange={(value) => {
            const input = inputRef.current;
            if (!input) return;
            input.value = value;
            // DatePicker closes next; closeCalendar uses the original save path.
          }}
        />
      )}
    </div>
  );
}

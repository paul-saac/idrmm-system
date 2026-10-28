"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2000, index, 1))
);

function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: string) {
  const date = parseIso(value);
  return date
    ? date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    : "mm/dd/yyyy";
}

export function DatePicker({
  name,
  defaultValue = "",
  value: controlledValue,
  onChange,
  id,
  required = false,
  disabled = false,
  className,
  rootClassName,
  buttonLabel,
  min,
  max,
  ariaLabel,
  calendarAnchor,
  onCalendarClose,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string, input: HTMLInputElement | null) => void;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  rootClassName?: string;
  buttonLabel?: string;
  min?: string;
  max?: string;
  ariaLabel: string;
  calendarAnchor?: HTMLElement;
  onCalendarClose?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(Boolean(calendarAnchor));
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const initialMonth = parseIso(value) ?? new Date();
  const [month, setMonth] = useState(() => new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !calendarAnchor?.contains(event.target as Node)) {
        setOpen(false);
        onCalendarClose?.();
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        onCalendarClose?.();
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, calendarAnchor, onCalendarClose]);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form || controlledValue !== undefined) return;
    function reset() {
      setInternalValue(defaultValue);
      const date = parseIso(defaultValue) ?? new Date();
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlledValue, defaultValue]);

  const days = useMemo(() => {
    const firstWeekday = month.getDay();
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
  }, [month]);

  const today = toIso(new Date());
  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(parseIso(min ?? "")?.getFullYear() ?? currentYear - 100, month.getFullYear());
  const lastYear = Math.max(parseIso(max ?? "")?.getFullYear() ?? currentYear + 100, month.getFullYear());
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);

  function choose(next: string) {
    if (controlledValue === undefined) setInternalValue(next);
    if (inputRef.current) inputRef.current.value = next;
    onChange?.(next, inputRef.current);
    setOpen(false);
    onCalendarClose?.();
  }

  const anchorRect = calendarAnchor?.getBoundingClientRect();
  const content = (
    <div ref={rootRef} className={calendarAnchor ? "fixed z-[100]" : `relative ${rootClassName ?? ""}`}
      style={anchorRect ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 264)),
        top: anchorRect.bottom + 330 > window.innerHeight ? undefined : anchorRect.bottom,
        bottom: anchorRect.bottom + 330 > window.innerHeight ? window.innerHeight - anchorRect.top + 4 : undefined,
      } : undefined}
    >
      {!calendarAnchor && <>
      <input ref={inputRef} type="hidden" name={name} value={value} required={required} disabled={disabled} readOnly />
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const selected = parseIso(value);
            if (selected) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
          }
          setOpen((current) => !current);
        }}
        className={`flex w-full cursor-pointer items-center justify-between gap-3 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? "min-w-32 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 outline-none transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-200"}`}
      >
        <span className={buttonLabel ? "" : value ? "tabular-nums" : "text-zinc-400"}>
          {buttonLabel ?? displayDate(value)}
        </span>
        <CalendarDays aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
      </button>
      </>}

      {open && (
        <div
          role="dialog"
          aria-label={`${ariaLabel} calendar`}
          className={`dropdown-content-enter ${calendarAnchor ? "relative" : "absolute top-full left-0"} z-50 mt-1 w-64 rounded border border-zinc-200 bg-white text-zinc-700 shadow-lg`}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              className="cursor-pointer rounded p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex min-w-0 items-center gap-1">
              <select
                data-calendar-dropdown
                aria-label="Calendar month"
                value={month.getMonth()}
                onChange={(event) => setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}
                className="min-w-0 cursor-pointer rounded border-none bg-transparent px-1 py-1 text-xs font-semibold text-zinc-900 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-200"
              >
                {MONTHS.map((label, index) => <option key={label} value={index}>{label}</option>)}
              </select>
              <select
                data-calendar-dropdown
                aria-label="Calendar year"
                value={month.getFullYear()}
                onChange={(event) => setMonth(new Date(Number(event.target.value), month.getMonth(), 1))}
                className="min-w-0 cursor-pointer rounded border-none bg-transparent px-1 py-1 text-xs font-semibold text-zinc-900 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-200"
              >
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              className="cursor-pointer rounded p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 px-2 pt-2 text-center text-[11px] font-medium text-zinc-400">
            {WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-px px-2 pb-2">
            {days.map((date) => {
              const iso = toIso(date);
              const outside = date.getMonth() !== month.getMonth();
              const selected = iso === value;
              const disabled = Boolean((min && iso < min) || (max && iso > max));
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => choose(iso)}
                  className={`h-8 cursor-pointer rounded text-xs tabular-nums transition disabled:cursor-not-allowed disabled:text-zinc-300 ${
                    selected
                      ? "bg-zinc-900 font-semibold text-white"
                      : outside
                        ? "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600"
                        : iso === today
                          ? "bg-zinc-100 font-semibold text-zinc-900 hover:bg-zinc-200"
                          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2">
            <button type="button" onClick={() => choose("")} className="cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-900">Clear</button>
            <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); choose(today); }} className="cursor-pointer text-xs font-medium text-zinc-700 transition hover:text-zinc-900">Today</button>
          </div>
        </div>
      )}
    </div>
  );
  return calendarAnchor ? createPortal(content, document.body) : content;
}

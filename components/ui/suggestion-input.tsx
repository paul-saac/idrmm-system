"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";

/** Free text plus the app's gray suggestion menu, without a browser datalist. */
export function SuggestionInput({ suggestions, value: controlledValue, defaultValue = "", onValueChange, ...props }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "list"> & {
    suggestions: readonly string[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void;
  }) {
  const generatedId = useId(), listId = `${generatedId}-suggestions`;
  const input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(defaultValue), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const value = controlledValue ?? draft;
  const options = [...new Set(suggestions)].filter(option => option.toLowerCase().includes(value.trim().toLowerCase()));
  const visible = open && options.length > 0 && !props.disabled;
  function choose(next: string) { setDraft(next); onValueChange?.(next); setOpen(false); setActive(-1); }
  useEffect(() => {
    if (visible && active >= 0) menu.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, visible]);
  useEffect(() => {
    const popup = menu.current;
    if (!popup || !visible) { if (popup?.matches(":popover-open")) popup.hidePopover(); return; }
    function position() {
      const field = input.current?.getBoundingClientRect(); if (!field || !popup) return;
      const height = Math.min(240, options.length * 34);
      const below = window.innerHeight - field.bottom - 8;
      popup.style.left = `${Math.max(8, Math.min(field.left, window.innerWidth - field.width - 8))}px`;
      popup.style.top = `${below < Math.min(120, height) && field.top > below ? Math.max(8, field.top - height - 4) : field.bottom + 4}px`;
      popup.style.width = `${Math.min(field.width, window.innerWidth - 16)}px`;
      popup.style.maxHeight = `${Math.min(height, Math.max(100, window.innerHeight - 24))}px`;
    }
    position(); if (!popup.matches(":popover-open")) popup.showPopover();
    function outside(event: PointerEvent) {
      if (event.target !== input.current && !popup?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [visible, options.length]);
  useEffect(() => {
    const form = input.current?.form;
    function reset() { if (controlledValue === undefined) setDraft(defaultValue); setOpen(false); }
    form?.addEventListener("reset", reset); return () => form?.removeEventListener("reset", reset);
  }, [controlledValue, defaultValue]);
  return <span className="relative block min-w-0">
    <input {...props} className={`${props.className ?? ""} w-full`} ref={input} id={props.id ?? generatedId} value={value} autoComplete="off"
      role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={listId}
      aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
      onChange={event => { setDraft(event.target.value); onValueChange?.(event.target.value); setActive(-1); setOpen(true); }}
      onFocus={event => { setOpen(true); props.onFocus?.(event); }}
      onBlur={event => { setOpen(false); props.onBlur?.(event); }}
      onKeyDown={event => {
        if (event.key === "Escape" && visible) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key === "Enter" && visible && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]); }
        props.onKeyDown?.(event);
      }} />
    <div ref={menu} id={listId} role="listbox" popover="manual"
      className="dropdown-content-enter fixed inset-auto m-0 overflow-y-auto rounded border border-zinc-200 bg-white p-0 text-sm text-zinc-700 shadow-sm">
      {options.map((option, index) => <button key={option} id={`${listId}-${index}`} type="button" tabIndex={-1} role="option" aria-selected={active === index}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}
        className={`block w-full cursor-pointer px-3 py-2 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none ${active === index ? "bg-zinc-100" : "bg-white"}`}>
        {option}
      </button>)}
    </div>
  </span>;
}

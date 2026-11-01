"use client";

import { useEffect, useRef } from "react";

function formatBudget(value: string) {
  const [whole, fraction] = value.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

export function AllocatedBudgetInput({ id, defaultValue, className }: {
  id: string;
  defaultValue?: number | null;
  className: string;
}) {
  const rawInput = useRef<HTMLInputElement>(null);
  const initialValue = defaultValue == null ? "" : String(defaultValue);
  useEffect(() => {
    const input = rawInput.current;
    const form = input?.form;
    if (!input || !form) return;
    // Hidden input values reflect their default value; restore it on form reset.
    const reset = () => { input.value = initialValue; };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initialValue]);

  return <>
    <input
      id={id}
      type="text"
      inputMode="decimal"
      defaultValue={formatBudget(initialValue)}
      autoComplete="off"
      className={className}
      onChange={event => {
        const input = event.currentTarget;
        const raw = input.value.replace(/,/g, "");
        const beforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/,/g, "").length;
        if (!/^\d*(?:\.\d{0,2})?$/.test(raw)) {
          input.value = formatBudget(rawInput.current?.value ?? "");
          return;
        }
        if (rawInput.current) rawInput.current.value = raw;
        input.value = formatBudget(raw);
        let caret = 0;
        let characters = 0;
        while (caret < input.value.length && characters < beforeCaret) {
          if (input.value[caret] !== ",") characters++;
          caret++;
        }
        input.setSelectionRange(caret, caret);
      }}
    />
    <input ref={rawInput} type="hidden" name="allocatedBudget" defaultValue={initialValue} />
  </>;
}

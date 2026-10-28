"use client";

import { useEffect } from "react";

/**
 * Disables autofill helpers when a text field is actually used. Avoid an
 * eager document scan/observer here: streamed Client Components can exist in
 * the DOM before React hydrates them, and mutating their attributes during
 * that window causes hydration mismatches.
 */
export function DisableBrowserAutocomplete() {
  useEffect(() => {
    function disable(el: Element) {
      const textInput =
        el instanceof HTMLInputElement &&
        ["text", "search", "email", "tel", "url"].includes(el.type);
      if (textInput || el instanceof HTMLTextAreaElement) {
        if (el.getAttribute("autocomplete") !== "off") {
          el.setAttribute("autocomplete", "off");
        }
        // Property assignments also mutate the observed attribute, even when
        // its value is unchanged. Keep every write idempotent to avoid an
        // endless MutationObserver microtask loop that blocks navigation.
        if (el.getAttribute("data-lpignore") !== "true") {
          el.setAttribute("data-lpignore", "true");
        }
        if (el.getAttribute("data-1p-ignore") !== "true") {
          el.setAttribute("data-1p-ignore", "true");
        }
      }
    }

    // Event-only mutation keeps server/client markup untouched during hydration.
    function handleEvent(e: Event) {
      const target = e.target;
      if (target instanceof Element) {
        disable(target);
      }
    }

    document.addEventListener("focusin", handleEvent, true);
    document.addEventListener("pointerdown", handleEvent, true);

    return () => {
      document.removeEventListener("focusin", handleEvent, true);
      document.removeEventListener("pointerdown", handleEvent, true);
    };
  }, []);

  return null;
}


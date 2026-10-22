"use client";

import { useEffect } from "react";

/**
 * Globally disables browser input history and autofill suggestion popups
 * across all inputs, textareas, and forms in the application.
 */
export function DisableBrowserAutocomplete() {
  useEffect(() => {
    function disable(el: Element) {
      if (
        (el instanceof HTMLInputElement && el.type !== "password") ||
        el instanceof HTMLTextAreaElement
      ) {
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
      } else if (el instanceof HTMLFormElement) {
        if (el.getAttribute("autocomplete") !== "off") {
          el.setAttribute("autocomplete", "off");
        }
      }
    }

    // 1. Initial pass over all existing elements in the document
    document.querySelectorAll("input, textarea, form").forEach(disable);

    // 2. Observe any dynamically mounted elements or attribute updates
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              disable(node);
              node.querySelectorAll("input, textarea, form").forEach(disable);
            }
          }
        } else if (mutation.type === "attributes" && mutation.target instanceof Element) {
          disable(mutation.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["autocomplete"],
    });

    // 3. Capture-phase events to intercept focus before browser suggestion triggers
    function handleEvent(e: Event) {
      const target = e.target;
      if (target instanceof Element) {
        disable(target);
      }
    }

    document.addEventListener("focusin", handleEvent, true);
    document.addEventListener("pointerdown", handleEvent, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", handleEvent, true);
      document.removeEventListener("pointerdown", handleEvent, true);
    };
  }, []);

  return null;
}


import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("autocomplete protection mutates only interacted text fields", () => {
  let cleanup, writes = 0;
  const listeners = new Map();
  class Element {
    attrs = new Map();
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) {
      writes++;
      this.attrs.set(name, value);
    }
    set autocomplete(value) { this.setAttribute("autocomplete", value); }
    querySelectorAll() { return []; }
  }
  class Input extends Element { type = "text"; }
  class Textarea extends Element {}
  class Form extends Element {}
  const document = {
    documentElement: new Element(),
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./disable-browser-autocomplete.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(code, { exports, require: () => ({ useEffect: (effect) => { cleanup = effect(); } }),
    Element, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLFormElement: Form,
    document });
  exports.DisableBrowserAutocomplete();
  const text = new Input();
  assert.equal(writes, 0, "mount must not mutate unhydrated fields");
  listeners.get("focusin")({ target: text });
  assert.equal(text.getAttribute("autocomplete"), "off");
  assert.equal(text.getAttribute("data-lpignore"), "true");
  assert.equal(text.getAttribute("data-1p-ignore"), "true");
  const afterFirstFocus = writes;
  listeners.get("pointerdown")({ target: text });
  assert.equal(writes, afterFirstFocus, "already-protected fields are not rewritten");

  const checkbox = new Input(); checkbox.type = "checkbox";
  listeners.get("focusin")({ target: checkbox });
  assert.equal(checkbox.getAttribute("autocomplete"), null);

  const password = new Input(); password.type = "password";
  password.setAttribute("autocomplete", "new-password");
  listeners.get("focusin")({ target: password });
  assert.equal(password.getAttribute("autocomplete"), "new-password");
  cleanup();
  assert.equal(listeners.size, 0);
});

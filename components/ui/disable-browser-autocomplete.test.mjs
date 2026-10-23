import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("autocomplete observer settles after dynamic inputs and repeated focus", () => {
  let observer, cleanup, writes = 0;
  const queue = [], listeners = new Map();
  class Element {
    attrs = new Map();
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) {
      writes++;
      this.attrs.set(name, value);
      // Browsers report same-value attribute assignments too.
      if (observer?.active && name === "autocomplete") queue.push({ type: "attributes", target: this });
    }
    set autocomplete(value) { this.setAttribute("autocomplete", value); }
    querySelectorAll() { return []; }
  }
  class Input extends Element { type = "text"; }
  class Textarea extends Element {}
  class Form extends Element {}
  const initial = new Input();
  const document = {
    documentElement: new Element(),
    querySelectorAll: () => [initial],
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  class MutationObserver {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./disable-browser-autocomplete.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(code, { exports, require: () => ({ useEffect: (effect) => { cleanup = effect(); } }),
    Element, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLFormElement: Form,
    MutationObserver, document });
  exports.DisableBrowserAutocomplete();
  function flush() {
    let rounds = 0;
    while (queue.length) {
      assert.ok(++rounds < 5, "observer must not keep triggering itself");
      observer.callback(queue.splice(0));
    }
  }
  for (const element of [initial, new Input(), new Textarea(), new Form()]) {
    observer.callback([{ type: "childList", addedNodes: [element] }]);
    flush();
    assert.equal(element.getAttribute("autocomplete"), "off");
    const before = writes;
    listeners.get("focusin")({ target: element });
    listeners.get("pointerdown")({ target: element });
    flush();
    assert.equal(writes, before, "already-disabled elements must not be rewritten");
    element.setAttribute("autocomplete", "on");
    flush();
    assert.equal(element.getAttribute("autocomplete"), "off");
  }
  const password = new Input(); password.type = "password";
  password.setAttribute("autocomplete", "new-password"); flush();
  assert.equal(password.getAttribute("autocomplete"), "new-password");
  cleanup();
  assert.equal(observer.active, false);
  assert.equal(listeners.size, 0);
});

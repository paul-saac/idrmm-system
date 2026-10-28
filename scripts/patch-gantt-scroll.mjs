import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ORIGINAL = ", rtl, scrollX, onExpanderClick]);";
const PATCHED = ", rtl, onExpanderClick]); // IDRMM: scrolling must not rebuild schedule geometry.";

/** gantt-task-react 0.3.9 rebuilds its dates and all bar tasks on each
 * horizontal scroll. Scroll offsets already have their own effects;
 * only RTL initialization reads scrollX in the geometry effect. */
export function patchGanttScroll(source) {
  let patched = source.replaceAll("\r\n", "\n");
  if (!patched.includes(PATCHED)) {
    if (patched.split(ORIGINAL).length !== 2) {
      throw new Error("Gantt scroll patch no longer matches. Review the installed gantt-task-react version before updating this patch.");
    }
    patched = patched.replace(ORIGINAL, PATCHED);
  }
  for (const [axis, offset] of [["X", "scrollLeft"], ["Y", "scrollTop"]]) {
    const pattern = new RegExp(`  var handleScroll${axis} = function handleScroll${axis}\\(event\\) \\{[\\s\\S]*?\\r?\\n  \\};`, "g");
    const handlers = [...patched.matchAll(pattern)];
    if (handlers.length !== 1 || (!handlers[0][0].includes("!ignoreScrollEvent") && !handlers[0][0].includes("IDRMM: preserve every scrollbar position"))) {
      throw new Error(`Gantt scroll patch no longer matches the ${axis} scrollbar handler.`);
    }
    patched = patched.replace(pattern, `  var handleScroll${axis} = function handleScroll${axis}(event) {
    // IDRMM: preserve every scrollbar position, including batched reversals.
    var nextScroll = event.currentTarget.${offset};
    setScroll${axis}(function (previous) { return previous === nextScroll ? previous : nextScroll; });
  };`);
  }
  // Passive effects can write an older offset back after a newer drag event.
  // Keep all scroll surfaces synchronized in the same commit, before paint.
  for (const [ref, offset, value, count] of [
    ["scrollRef", "scrollTop", "scroll", 1],
    ["scrollRef", "scrollLeft", "scroll", 1],
    ["horizontalContainerRef", "scrollTop", "scrollY", 2],
    ["verticalGanttContainerRef", "scrollLeft", "scrollX", 1],
  ]) {
    const effectPrefix = patched.includes("var React = require('react');") ? "React." : "";
    const original = `${effectPrefix}useEffect(function () {
    if (${ref}.current) {
      ${ref}.current.${offset} = ${value};
    }
  }, [${value}]);`;
    const replacement = `React.useLayoutEffect(function () {
    // IDRMM: synchronize scroll surfaces before paint, without redundant writes.
    if (${ref}.current && ${ref}.current.${offset} !== ${value}) {
      ${ref}.current.${offset} = ${value};
    }
  }, [${value}]);`;
    if (patched.split(replacement).length === count + 1) continue;
    if (patched.split(original).length !== count + 1) {
      throw new Error(`Gantt scroll patch no longer matches ${ref}.${offset} synchronization.`);
    }
    patched = patched.replaceAll(original, replacement);
  }
  return patched;
}

function patchInstalledGantt() {
  const packagePath = require.resolve("gantt-task-react/package.json");
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  if (version !== "0.3.9") throw new Error(`Review the Gantt scroll patch for gantt-task-react ${version}; it targets 0.3.9.`);
  for (const file of ["index.js", "index.modern.js"]) {
    const path = join(dirname(packagePath), "dist", file);
    const original = readFileSync(path, "utf8");
    const patched = patchGanttScroll(original);
    if (patched !== original) writeFileSync(path, patched);
  }
  console.log("Gantt scroll performance patch applied.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) patchInstalledGantt();

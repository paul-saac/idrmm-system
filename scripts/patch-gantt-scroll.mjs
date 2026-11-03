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
  // Stable row identity for Shift-selection; label text and DOM order are not unique.
  const reactName = patched.includes("var React = require('react');") ? "React__default" : "React";
  const barRoot = `return ${reactName}.createElement("g", {\n    onKeyDown: function onKeyDown(e) {`;
  const identifiedBarRoot = `return ${reactName}.createElement("g", {\n    "data-gantt-row-id": task.id,\n    onKeyDown: function onKeyDown(e) {`;
  if (!patched.includes(identifiedBarRoot)) {
    if (patched.split(barRoot).length !== 2) throw new Error("Gantt row identity patch no longer matches TaskItem.");
    patched = patched.replace(barRoot, identifiedBarRoot);
  }
  // Expose the library's own connector geometry once so multi-bar drag previews
  // can redraw either endpoint without layout reads or React renders per frame.
  const arrowRoot = '    className: "arrow"';
  const identifiedArrowRoot = `    className: "arrow",
    "data-gantt-from": taskFrom.id,
    "data-gantt-to": taskTo.id,
    "data-gantt-from-x": rtl ? taskFrom.x1 : taskFrom.x2,
    "data-gantt-to-x": rtl ? taskTo.x2 : taskTo.x1,
    "data-gantt-from-y": taskFrom.y + taskHeight / 2,
    "data-gantt-to-y": taskTo.y + taskHeight / 2,
    "data-gantt-row-offset": (taskFrom.index > taskTo.index ? -1 : 1) * rowHeight / 2,
    "data-gantt-indent": rtl ? -arrowIndent : arrowIndent`;
  if (!patched.includes(identifiedArrowRoot)) {
    if (patched.split(arrowRoot).length !== 2) throw new Error("Gantt connector identity patch no longer matches Arrow.");
    patched = patched.replace(arrowRoot, identifiedArrowRoot);
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
  // Match inclusive task ends: a milestone on the 11th sits on the
  // right boundary of the 11th. Only display geometry moves, not saved dates.
  const milestoneStart = "  var x = taskXCoordinate(task.start, dates, columnWidth);\n  var y = taskYCoordinate(index, rowHeight, taskHeight);\n  var x1 = x - taskHeight * 0.5;";
  const previousMilestoneCentered = `  // IDRMM: center date-only milestone geometry in its scheduled day.
  var milestoneDayStart = new Date(task.start.getTime());
  milestoneDayStart.setHours(0, 0, 0, 0);
  var milestoneDayEnd = new Date(milestoneDayStart.getTime());
  milestoneDayEnd.setDate(milestoneDayEnd.getDate() + 1);
  var milestoneDisplayDate = new Date((milestoneDayStart.getTime() + milestoneDayEnd.getTime()) / 2);
  var x = taskXCoordinate(milestoneDisplayDate, dates, columnWidth);
  var y = taskYCoordinate(index, rowHeight, taskHeight);
  var x1 = x - taskHeight * 0.5;`;
  const milestoneAligned = `  // IDRMM: align date-only milestones to the inclusive end-date boundary.
  var milestoneDayEnd = new Date(task.start.getTime());
  milestoneDayEnd.setHours(0, 0, 0, 0);
  milestoneDayEnd.setDate(milestoneDayEnd.getDate() + 1);
  var x = taskXCoordinate(milestoneDayEnd, dates, columnWidth);
  var y = taskYCoordinate(index, rowHeight, taskHeight);
  var x1 = x - taskHeight * 0.5;`;
  if (!patched.includes(milestoneAligned)) {
    const previous = patched.includes(previousMilestoneCentered) ? previousMilestoneCentered : milestoneStart;
    if (patched.split(previous).length !== 2) throw new Error("Gantt milestone geometry patch no longer matches convertToMilestone.");
    patched = patched.replace(previous, milestoneAligned);
  }
  // Forward a display-only calendar layer into both SVG surfaces. It is
  // rendered below today and task bars; no geometry/scroll effects are changed.
  for (const [original, replacement] of [
    ["  var gridProps = {\n    columnWidth: columnWidth,", "  var gridProps = {\n    renderNonWorkingDays: _ref.renderNonWorkingDays,\n    viewMode: viewMode,\n    columnWidth: columnWidth,"],
    ["  var calendarProps = {\n    dateSetup: dateSetup,", "  var calendarProps = {\n    renderNonWorkingDays: _ref.renderNonWorkingDays,\n    dateSetup: dateSetup,"],
    ["  }, gridRows),", "  }, gridRows), _ref.renderNonWorkingDays && _ref.renderNonWorkingDays({ dates: dates, columnWidth: columnWidth, height: y, header: false, viewMode: _ref.viewMode }),"],
    ["  }), bottomValues, \" \", topValues);", "  }), _ref.renderNonWorkingDays && _ref.renderNonWorkingDays({ dates: dateSetup.dates, columnWidth: columnWidth, height: headerHeight, header: true, viewMode: viewMode }), bottomValues, \" \", topValues);"],
  ]) {
    if (patched.includes(replacement)) continue;
    if (patched.split(original).length !== 2) throw new Error("Gantt non-working calendar layer patch no longer matches its SVG surface.");
    patched = patched.replace(original, replacement);
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

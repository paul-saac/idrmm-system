import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { patchGanttScroll } from "./patch-gantt-scroll.mjs";
import ts from "typescript";

const require = createRequire(import.meta.url);

const installed = readFileSync(require.resolve("gantt-task-react"), "utf8");
const original = installed.replace(
  ", rtl, onExpanderClick]); // IDRMM: scrolling must not rebuild schedule geometry.",
  ", rtl, scrollX, onExpanderClick]);",
);

/** Runs the installed library's geometry effect with a small hook harness.
 * Nested UI is not mounted; the real date/bar conversion code still runs. */
function chartHarness(source) {
  const state = [];
  let cursor = 0;
  let scrollSlot;
  let geometry;
  let previousDependencies;
  let rebuilds = 0;
  let horizontalScroll;
  let verticalScroll;
  let verticalSlot;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      if (initial === -1) scrollSlot = index;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef: () => ({ current: null }),
    useLayoutEffect() {},
    useMemo: (compute) => compute(),
    useEffect(effect, dependencies) {
      if (effect.toString().includes("setBarTasks(convertToBarTasks")) geometry = { effect, dependencies };
    },
    createElement: (_type, props) => {
      if (props?.onScroll && "svgWidth" in props) horizontalScroll = props.onScroll;
      if (props?.onScroll && "ganttFullHeight" in props) verticalScroll = props.onScroll;
      return null;
    },
  };
  const exports = {};
  runInNewContext(source, { exports, require: (name) => {
    assert.equal(name, "react");
    return react;
  }, console });
  const props = {
    tasks: [{ id: "1", name: "Task", type: "task", progress: 0, start: new Date(2026, 9, 12), end: new Date(2026, 9, 16) }],
    viewMode: "Day",
    onExpanderClick() {},
  };
  function render(changes = {}) {
    Object.assign(props, changes);
    cursor = 0;
    exports.Gantt(props);
    // Gantt's scrollY state immediately precedes its sentinel-initialized scrollX.
    verticalSlot = scrollSlot - 1;
    assert.ok(geometry, "Schedule geometry effect exists");
    if (!previousDependencies || geometry.dependencies.some((value, index) => !Object.is(value, previousDependencies[index]))) {
      geometry.effect();
      rebuilds++;
    }
    previousDependencies = geometry.dependencies;
  }
  return {
    render,
    scroll(value) { state[scrollSlot] = value; render(); },
    dragHorizontal(offsets) {
      for (const value of offsets) horizontalScroll({ currentTarget: { scrollLeft: value } });
      render();
      return state[scrollSlot];
    },
    dragVertical(offsets) {
      for (const value of offsets) verticalScroll({ currentTarget: { scrollTop: value } });
      render();
      return state[verticalSlot];
    },
    rebuilds: () => rebuilds,
    props,
  };
}

test("regression control: the unpatched library rebuilds all bars during scrolling", () => {
  const chart = chartHarness(original);
  chart.render();
  for (const offset of [0, 50, 100, 150]) chart.scroll(offset);
  assert.equal(chart.rebuilds(), 5);
});

test("scrolling no longer rebuilds dates or bars", () => {
  const chart = chartHarness(patchGanttScroll(original));
  chart.render();
  for (const offset of [0, 50, 100, 150]) chart.scroll(offset);
  assert.equal(chart.rebuilds(), 1);
});

test("task/date edits, zoom, width, and phase expansion still refresh geometry", () => {
  const chart = chartHarness(patchGanttScroll(original));
  chart.render();
  chart.render({ tasks: [{ ...chart.props.tasks[0], end: new Date(2026, 9, 20) }] });
  chart.render({ viewMode: "Month" });
  chart.render({ columnWidth: 100 });
  chart.render({ onExpanderClick() {} });
  assert.equal(chart.rebuilds(), 5);
});

test("the patch is safe to rerun and rejects unexpected dependency source", () => {
  const patched = patchGanttScroll(original);
  assert.equal(patchGanttScroll(patched), patched);
  assert.throws(() => patchGanttScroll("unexpected source"), /no longer matches/);
});

test("fast horizontal dragging always uses the final offset", () => {
  const chart = chartHarness(patchGanttScroll(original));
  chart.render();
  chart.scroll(0);
  assert.equal(chart.dragHorizontal([100, 450, 900, 1400]), 1400);
  assert.equal(chart.dragHorizontal([1200, 600, 150, 0]), 0);
  assert.equal(chart.rebuilds(), 1);
});

test("batched reversals back to the starting position are not dropped", () => {
  const chart = chartHarness(patchGanttScroll(original));
  chart.render();
  chart.scroll(0);
  assert.equal(chart.dragHorizontal([300, 900, 0]), 0);
  assert.equal(chart.dragVertical([150, 450, 0]), 0);
});

test("rapid vertical dragging also keeps its final position", () => {
  const chart = chartHarness(patchGanttScroll(original));
  chart.render();
  assert.equal(chart.dragVertical([100, 300, 500]), 500);
  assert.equal(chart.dragVertical([200, 0]), 0);
});

function scrollSurfaceHarness() {
  const refs = [];
  const layoutEffects = [];
  const passiveEffects = [];
  let cursor = 0;
  const react = {
    useRef() { return refs[cursor++]; },
    useEffect(effect) { passiveEffects.push(effect); },
    useLayoutEffect(effect) { layoutEffects.push(effect); },
    createElement() { return null; },
  };
  const exports = {};
  runInNewContext(patchGanttScroll(original) + "\nexports.scrollSurfaces = { HorizontalScroll, TaskGantt };", {
    exports, console, require: () => react,
  });
  return {
    refs, layoutEffects, passiveEffects,
    render(name, props) {
      cursor = 0;
      layoutEffects.length = 0;
      passiveEffects.length = 0;
      exports.scrollSurfaces[name](props);
    },
    beforePaint() { for (const effect of layoutEffects) effect(); },
  };
}

test("scrollbar updates before paint and never writes the same position twice", () => {
  const surface = scrollSurfaceHarness();
  let offset = 0;
  let writes = 0;
  surface.refs.push({ current: {
    get scrollLeft() { return offset; },
    set scrollLeft(value) { offset = value; writes++; },
  } });
  surface.render("HorizontalScroll", { scroll: 600, svgWidth: 2000, taskListWidth: 300 });
  assert.equal(surface.passiveEffects.length, 0);
  surface.beforePaint();
  assert.equal(offset, 600);
  assert.equal(writes, 1);
  surface.render("HorizontalScroll", { scroll: 600, svgWidth: 2000, taskListWidth: 300 });
  surface.beforePaint();
  assert.equal(writes, 1);
});

test("the timeline synchronizes both axes before the next paint", () => {
  const surface = scrollSurfaceHarness();
  const body = { scrollTop: 0 };
  const timeline = { scrollLeft: 0 };
  surface.refs.push({ current: null }, { current: body }, { current: timeline });
  surface.render("TaskGantt", {
    scrollX: 600, scrollY: 100,
    gridProps: { svgWidth: 2000 },
    calendarProps: { headerHeight: 50 },
    barProps: { tasks: [], rowHeight: 34 },
  });
  assert.equal(surface.passiveEffects.length, 0);
  surface.beforePaint();
  assert.equal(body.scrollTop, 100);
  assert.equal(timeline.scrollLeft, 600);
});

test("the modern browser bundle receives the same scroll fixes", () => {
  const modern = readFileSync(require.resolve("gantt-task-react/dist/index.modern.js"), "utf8");
  const patched = patchGanttScroll(modern);
  assert.equal(patchGanttScroll(patched), patched);
  assert.equal(patched.split("IDRMM: synchronize scroll surfaces before paint").length - 1, 5);
  const compiled = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const chart = chartHarness(compiled);
  chart.render();
  chart.scroll(0);
  assert.equal(chart.dragHorizontal([500, 1000, 0]), 0);
  assert.equal(chart.rebuilds(), 1);
});

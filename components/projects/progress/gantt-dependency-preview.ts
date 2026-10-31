type ConnectorGeometry = {
  fromX: number; toX: number; fromY: number; toY: number;
  rowOffset: number; indent: number;
};

/** Match gantt-task-react's routing, including when an endpoint crosses the
 * other bar. The signed indent also supports right-to-left schedules. */
export function dependencyDragPath(geometry: ConnectorGeometry, fromDelta: number, toDelta: number) {
  const { fromY, toY, rowOffset, indent } = geometry;
  const fromX = geometry.fromX + fromDelta, toX = geometry.toX + toDelta;
  const direction = indent < 0 ? -1 : 1;
  const detour = direction * (fromX + indent * 2 - toX) >= 0;
  const horizontal = detour ? indent : toX - fromX - indent;
  return {
    path: `M ${fromX} ${fromY} h ${indent} v ${rowOffset} ${detour ? `H ${toX - indent}` : ""} V ${toY} h ${horizontal}`,
    points: `${toX},${toY} ${toX - direction * 5},${toY - 5} ${toX - direction * 5},${toY + 5}`,
  };
}

/** Cache nodes and coordinates only at drag start or DOM replacement. */
export function createDependencyDragPreview(root: ParentNode, movingIds: ReadonlySet<string>) {
  type Entry = { path: SVGPathElement; polygon: SVGPolygonElement | null; geometry: ConnectorGeometry; from: boolean; to: boolean };
  let entries: Entry[] = [];
  const originals = new Map<Element, { attribute: string; value: string | null }>();
  function remember(node: Element, attribute: string) {
    if (!originals.has(node)) originals.set(node, { attribute, value: node.getAttribute(attribute) });
  }
  function recache() {
    entries = [];
    for (const node of root.querySelectorAll<SVGGElement>("[data-gantt-from][data-gantt-to]")) {
      const from = movingIds.has(node.dataset.ganttFrom ?? ""), to = movingIds.has(node.dataset.ganttTo ?? "");
      if (!from && !to) continue;
      const path = node.querySelector<SVGPathElement>("path"), polygon = node.querySelector<SVGPolygonElement>("polygon");
      if (!path) continue;
      const geometry = {
        fromX: Number(node.dataset.ganttFromX), toX: Number(node.dataset.ganttToX),
        fromY: Number(node.dataset.ganttFromY), toY: Number(node.dataset.ganttToY),
        rowOffset: Number(node.dataset.ganttRowOffset), indent: Number(node.dataset.ganttIndent),
      };
      if (!Object.values(geometry).every(Number.isFinite)) continue;
      remember(path, "d");
      if (polygon) remember(polygon, "points");
      entries.push({ path, polygon, geometry, from, to });
    }
  }
  recache();
  return {
    recache,
    paint(pixels: number) {
      for (const entry of entries) {
        const result = dependencyDragPath(entry.geometry, entry.from ? pixels : 0, entry.to ? pixels : 0);
        entry.path.setAttribute("d", result.path);
        entry.polygon?.setAttribute("points", result.points);
      }
    },
    restore() {
      for (const [node, original] of originals) {
        if (original.value === null) node.removeAttribute(original.attribute);
        else node.setAttribute(original.attribute, original.value);
      }
      originals.clear(); entries = [];
    },
  };
}

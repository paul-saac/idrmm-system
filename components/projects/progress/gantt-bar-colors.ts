/** Stable, widely spaced hues: adding/reordering a group never recolors others. */
export function ganttBarColors(categoryId: number, kind: "summary" | "subtask" | "standalone" | "milestone") {
  if (kind === "milestone") return {
    backgroundColor: "#155dfc", backgroundSelectedColor: "#1447e6",
    progressColor: "#155dfc", progressSelectedColor: "#1447e6",
  };
  if (kind === "standalone") return {
    backgroundColor: "#b8c2cc", backgroundSelectedColor: "#a2afbc",
    progressColor: "#7d8b99", progressSelectedColor: "#6b7987",
  };
  // Golden-angle spacing offers hundreds of hues without a short repeating palette.
  const hue = ((Math.abs(categoryId) * 137.508) % 360).toFixed(2);
  return {
    backgroundColor: `hsl(${hue} 62% 66%)`,
    backgroundSelectedColor: `hsl(${hue} 62% 59%)`,
    // A lighter fill keeps the chart's dark task labels readable on every hue.
    progressColor: kind === "summary" ? "#ffffff" : `hsl(${hue} 62% 82%)`,
    progressSelectedColor: kind === "summary" ? "#ffffff" : `hsl(${hue} 62% 76%)`,
  };
}

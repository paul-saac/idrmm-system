/**
 * Fixed, validated chart colors (see the dataviz skill — every set here
 * was run through scripts/validate_palette.js, not eyeballed). Each
 * entity keeps the same color everywhere it appears across this report:
 * Material/Labor/Equipment never swap hues between the Monthly Expense
 * chart and the Cost Breakdown donut, and Actual/Planned/Balance never
 * swap between the Material Costs and Planned vs Actual donuts.
 *
 * The category set intentionally uses only 3 hues + a neutral for
 * "Other" — the validator fails all-pairs distinguishability at a 4th
 * hue (yellow beside orange), so Other folds to gray instead per the
 * skill's documented mitigation rather than adding a 4th competing hue.
 */
export const CATEGORY_COLORS = {
  material: "#2a78d6",
  labor: "#eb6834",
  equipment: "#1baf7a",
  other: "#a8a79d",
} as const;

export const STATUS_COLORS = {
  actual: "#2a78d6",
  planned: "#1baf7a",
  balance: "#e34948",
  spent: "#2a78d6",
  remaining: "#1baf7a",
} as const;

export const SEQUENTIAL_HUE = "#2a78d6";

export const CHART_INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
};

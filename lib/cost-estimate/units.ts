/**
 * Predefined units of measurement for the Add/Edit Task Item form's Unit
 * field — covers materials, labor, equipment, and general construction
 * activities. "Other" is a deliberate escape hatch (reveals a text
 * input) rather than free typing by default, since a fixed list keeps
 * units consistent across tasks/projects.
 */
export const UNIT_OPTIONS = [
  "pcs",
  "set",
  "lot",
  "kg",
  "g",
  "ton",
  "lb",
  "m",
  "cm",
  "mm",
  "in",
  "ft",
  "yd",
  "m²",
  "cm²",
  "ft²",
  "in²",
  "m³",
  "cm³",
  "ft³",
  "L",
  "mL",
  "gal",
  "bag",
  "box",
  "roll",
  "sheet",
  "length",
  "pair",
  "unit",
  "day",
  "hour",
] as const;

export const OTHER_UNIT = "Other";

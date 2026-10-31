// The Team page's own fixed lists — categories (its tables) and the title
// suggestions under them. Titles stay typable, so anything else can be
// entered too; picking a known one fills its category in.

export type MemberCategory =
  | "management"
  | "professional"
  | "skilled";

export const MEMBER_CATEGORIES: { value: MemberCategory; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "skilled", label: "Skilled Workers" },
  { value: "professional", label: "Engineers & Architects" },
];

export function isMemberCategory(value: string): value is MemberCategory {
  return MEMBER_CATEGORIES.some((category) => category.value === value);
}

export function categoryLabel(category: MemberCategory) {
  return MEMBER_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

export type EmploymentType = "employee" | "subcontractor";

const TITLES: { title: string; category: MemberCategory }[] = [
  { title: "Project Manager", category: "management" },
  { title: "Architect", category: "professional" },
  { title: "Civil Engineer", category: "professional" },
  { title: "Structural Engineer", category: "professional" },
  { title: "Project Engineer", category: "professional" },
  { title: "Site Engineer", category: "professional" },
  { title: "Foreman", category: "management" },
  { title: "Mason", category: "skilled" },
  { title: "Carpenter", category: "skilled" },
  { title: "Steelman", category: "skilled" },
  { title: "Electrician", category: "skilled" },
  { title: "Plumber", category: "skilled" },
  { title: "Welder", category: "skilled" },
  { title: "Painter", category: "skilled" },
  { title: "Tile Setter", category: "skilled" },
  { title: "Equipment Operator", category: "skilled" },
  { title: "Driver", category: "skilled" },
];

export const TITLE_SUGGESTIONS = TITLES.map((t) => t.title);

/** A known title's own category — null for anything else. */
export function categoryForTitle(title: string): MemberCategory | null {
  const key = title.trim().toLowerCase();
  return TITLES.find((t) => t.title.toLowerCase() === key)?.category ?? null;
}

export function memberCategory(title: string | null, stored: MemberCategory, profileId?: string | null): MemberCategory {
  return profileId ? "management" : categoryForTitle(title ?? "") ?? stored;
}

export function isManagementMember(member: { category: MemberCategory; profileId: string | null }) {
  return member.category === "management" || !!member.profileId;
}

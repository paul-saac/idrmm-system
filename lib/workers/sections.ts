import { MEMBER_CATEGORIES, type EmploymentType, type MemberCategory } from "@/lib/workers/presets";

/**
 * Members in the Team's own sections — a section per employee category
 * (MEMBER_CATEGORIES' own order), then every subcontractor together,
 * whatever their trade — for a picker's labeled list (a group's form, the
 * Gantt chart's Assign picker). Empty sections are left out.
 */
export function memberSections<
  T extends { category: MemberCategory; employmentType: EmploymentType },
>(members: T[]): { key: string; label: string; members: T[] }[] {
  return [
    ...MEMBER_CATEGORIES.map((category) => ({
      key: category.value as string,
      label: category.label,
      members: members.filter(
        (member) => member.employmentType !== "subcontractor" && member.category === category.value
      ),
    })),
    {
      key: "subcontractors",
      label: "Subcontractors",
      members: members.filter((member) => member.employmentType === "subcontractor"),
    },
  ].filter((section) => section.members.length > 0);
}

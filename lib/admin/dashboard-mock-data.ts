/**
 * Placeholder data for the Admin dashboard UI.
 *
 * There is no `projects`, `daily_logs`, `material_requests`, or
 * `equipment_requests` table yet — those belong to modules that haven't
 * been built. Once they exist, replace these constants with real queries
 * (mirroring how lib/accounts/data.ts reads from `profiles`) and delete
 * this file.
 */

export const MOCK_STATS = {
  ongoingProjects: 1,
  completedProjects: 12,
  materialRequests: 4,
  equipmentRequests: 4,
};

export const MOCK_RECENT_ACTIVITY = [
  {
    id: "1",
    message: "Jane Doe submitted a daily log for April 23",
    meta: "2 hours ago · Single Detached Residential House Project",
  },
  {
    id: "2",
    message: "You approved daily log for April 22",
    meta: "Yesterday, 4:12 PM",
  },
];

export const MOCK_PENDING_APPROVALS = [
  {
    id: "1",
    title: "Daily Log - Apr 23, 2026",
    subtitle: "Submitted by Jane Doe · Single Detached Residential...",
  },
  {
    id: "2",
    title: "Material Request - Portland Cement",
    subtitle: "Requested by Jane Doe · For Foundation Works phase",
  },
  {
    id: "3",
    title: "Equipment Request - Concrete Mixer",
    subtitle: "Requested by Jane Doe · Needed Apr 25-May 5",
  },
];

export const MOCK_ACTIVE_PROJECT = {
  name: "Single Detached Residential House Project",
  address: "123 Mabini Street, Barangay San Roque, Marikina City, Metro Manila",
  completion: 47,
  budget: 810000,
  spent: 399250,
  remaining: 410750,
};

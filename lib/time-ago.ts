/** "just now", "5m ago", "3h ago", "2d ago", then the date itself. */
export function timeAgo(iso: string) {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "5 mins ago", "2 hrs ago", "Yesterday at 4:30 PM", "Oct 3 at 9:00 AM" —
 * a notification's own time. */
export function notificationTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const minutes = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  if (isSameDay(date, now)) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
}

/** Which of the bell's date filters a time falls in — "today",
 * "yesterday", or "week" (within the last 7 days), else null. */
export function dateBucket(iso: string): "today" | "yesterday" | "week" | null {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "yesterday";
  const weekAgo = new Date(now);
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(weekAgo.getDate() - 6);
  return date >= weekAgo ? "week" : null;
}

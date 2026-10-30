export function manilaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monthDate(iso: string) {
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
}

export function calendarMonth(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - first.getUTCDay() + 1));
    return { iso: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
  });
}

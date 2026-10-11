/** Business calendar boundaries must agree with the database's Amsterdam timezone. */
export function monthlyAvailabilityWindow(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(now);
  const [year, month] = today.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { today, nextMonthStart };
}

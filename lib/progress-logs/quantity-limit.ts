/** Today's entry replaces today's saved quantity; never subtract that work twice. */
export function remainingQuantity(planned: number, cumulative: number, savedToday: number): number {
  return Math.max(0, Math.round((planned - Math.max(0, cumulative - savedToday)) * 1e8) / 1e8);
}
export function exceedsQuantity(quantity: number, remaining: number): boolean {
  return quantity > remaining;
}

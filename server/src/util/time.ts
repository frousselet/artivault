/** Current unix time in whole seconds (the unit used across the schema). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

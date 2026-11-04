/** One key per user action. The API accepts 8 to 128 letters, digits, `_` or `-`. */
export function newIdempotencyKey(): string {
  return `ui-${crypto.randomUUID()}`;
}

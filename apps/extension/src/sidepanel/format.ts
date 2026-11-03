/**
 * Formats a stored price for display. The amount is a decimal string (never a float), so it is
 * shown as stored when the browser cannot format it, for example when the currency code is one
 * Intl rejects.
 */
export function formatPrice(amount: string, currency: string | null): string {
  const raw = currency === null ? amount : `${amount} ${currency}`;
  const value = Number(amount);
  if (currency === null || !Number.isFinite(value)) return raw;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return raw;
  }
}

/** Resolves a path on the dashboard origin, for example `/w/<id>/products`. */
export function dashboardHref(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

// Shared by the data modules.

// True when a database function doesn't exist yet (its migration hasn't been
// run), so callers can fall back to the older direct-table behaviour.
export function isMissingFn(error) {
  return error && (error.code === 'PGRST202' || error.code === '42883');
}

export function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  const base = error.message || String(error);
  if (error.retryAfterSeconds != null) {
    return `${base} (retry in ~${error.retryAfterSeconds}s)`;
  }
  return base;
}

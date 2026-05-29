export class TTLCache {
  constructor({ ttlMs = 10 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + Math.max(0, ttlMs),
    });
    return value;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  pruneExpired() {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export function normalizeQueryString(query = {}) {
  const params = new URLSearchParams();
  const keys = Object.keys(query).sort();
  for (const key of keys) {
    const value = query[key];
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  return params.toString();
}

export function makeCacheKey(pathname, query = {}) {
  const qs = normalizeQueryString(query);
  return qs ? `${pathname}?${qs}` : pathname;
}

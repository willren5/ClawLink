export function appendWithLimit<T>(items: T[], next: T, limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  if (items.length < limit) {
    return [...items, next];
  }

  const offset = items.length - limit + 1;
  return [...items.slice(offset), next];
}

export function appendManyWithLimit<T>(items: T[], next: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  if (next.length >= limit) {
    return next.slice(next.length - limit);
  }

  const merged = [...items, ...next];
  if (merged.length <= limit) {
    return merged;
  }

  return merged.slice(merged.length - limit);
}

export function toArray<T>(value: T | T[] | null | undefined): T[] | undefined {
  if (value === null || value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

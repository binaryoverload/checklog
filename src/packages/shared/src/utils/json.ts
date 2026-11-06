// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Reflects the return value of JSON.parse
export function safeJsonParse<T = any>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

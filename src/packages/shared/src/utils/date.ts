export function jsDateToUTCISODate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function jsDateToUTCISOTime(date: Date, { includeSeconds = true }: { includeSeconds?: boolean }): string {
  const hours = String(date.getUTCHours()).padStart(2, "0")
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")
  const seconds = String(date.getUTCSeconds()).padStart(2, "0")

  return includeSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`
}

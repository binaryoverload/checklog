export function toArray<T>(value: T | T[] | null | undefined): T[] | undefined {
  if (value === null || value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

export function diffArrays<T>(arr1: T[], arr2: T[]): { both: T[], onlyInArr1: T[], onlyInArr2: T[] } {
  const both = arr1.filter(item => arr2.includes(item))
  const onlyInArr1 = arr1.filter(item => !arr2.includes(item))
  const onlyInArr2 = arr2.filter(item => !arr1.includes(item))
  return { both, onlyInArr1, onlyInArr2 }
}

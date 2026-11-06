import type { Simplify } from "type-fest"

// Fields that can be undefined become optional
type UndefinedToOptional<T> = Simplify<
  { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
  & { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> }
>

export function filterUndefined<T extends Record<string, unknown>>(obj: T): UndefinedToOptional<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as UndefinedToOptional<T>
}

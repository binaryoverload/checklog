export function useFormState<T extends object>(initial: () => T) {
  const state = reactive(initial())
  function reset() {
    Object.assign(state, initial())
  }
  return { state, reset }
}

type StoreSpec<State, Actions extends Record<string, (...args: never[]) => void>> = {
  init(): State
  actions: { [Key in keyof Actions]: (draft: State, ...args: Parameters<Actions[Key]>) => void }
}

/** Minimal EngineStore test double for browser component specs. */
export function defineStore<State, Actions extends Record<string, (...args: never[]) => void>>(
  spec: StoreSpec<State, Actions>,
): {
  create(): {
    getSnapshot(): State
    actions: Actions
    subscribe(listener: () => void): () => void
  }
} {
  return {
    create() {
      let state = spec.init()
      const listeners = new Set<() => void>()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [
        name,
        (...args: unknown[]) => {
          const draft = structuredClone(state)
          ;(action as (draft: State, ...args: unknown[]) => void)(draft, ...args)
          state = draft
          for (const listener of listeners) listener()
        },
      ])) as Actions
      return {
        getSnapshot: () => state,
        actions,
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    },
  }
}

// ZP-507: keeps the server in step with the hearts tapped on this phone.
// Pure (the request is injected); tested in tests/loves.test.ts.
//
// One request per piece at a time. Taps while one is in flight only change
// the wanted state; when it returns, the latest wanted state is sent if the
// server does not have it yet. So quick love / un-love taps never arrive out
// of order, and only the final state matters. A failed request is not
// retried on its own (the next tap sends again).

export type LoveSend = (slug: string, on: boolean) => Promise<boolean>

export function createLoveSync({ send }: { send: LoveSend }) {
  type State = { wanted: boolean; server: boolean | null; busy: boolean }
  const pieces = new Map<string, State>()

  const pump = (slug: string, state: State) => {
    if (state.busy || state.server === state.wanted) return
    state.busy = true
    const on = state.wanted
    send(slug, on)
      .catch(() => false)
      .then((ok) => {
        state.busy = false
        if (!ok) {
          state.server = null // unknown: the next tap is sent
          return
        }
        state.server = on
        pump(slug, state)
      })
  }

  return {
    /** The visitor now wants this piece loved (true) or not (false). */
    set(slug: string, on: boolean) {
      let state = pieces.get(slug)
      if (!state) {
        state = { wanted: on, server: null, busy: false }
        pieces.set(slug, state)
      }
      state.wanted = on
      pump(slug, state)
    },
  }
}

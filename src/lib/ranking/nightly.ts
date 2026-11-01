// ZP-506 review: the steps of the nightly job (scripts/analytics-rollup.ts):
// analytics rollup, ranking, review-photo cleanup. Each runs in its own
// try/catch, so one failing step never skips the others (the cleanup always
// runs); the exit code is 1 when any step failed. Pure; tested in
// tests/ranking-nightly.test.ts.

export type NightlyStep = { name: string; run: () => Promise<Record<string, unknown>> }

type Out = { log: (line: string) => void; logError: (line: string) => void }

/** Run every step in order; one JSON line per successful step; returns the exit code. */
export async function runNightlySteps(steps: readonly NightlyStep[], out: Out = { log: console.log, logError: console.error }): Promise<number> {
  let failed = false
  for (const step of steps) {
    const started = Date.now()
    try {
      const result = await step.run()
      out.log(JSON.stringify({ job: step.name, ...result, ms: Date.now() - started }))
    } catch (error) {
      failed = true
      out.logError(`${step.name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return failed ? 1 : 0
}

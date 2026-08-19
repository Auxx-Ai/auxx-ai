// packages/lib/src/ai/kopilot/turn-budget.ts

/**
 * Kopilot's engine turn budget — the single source for the three `AgentEngine`
 * per-turn caps on every Kopilot path (the SSE route and the worker job).
 *
 * It lives next to `domain-config.ts` deliberately: that file owns this domain's
 * other limit, the per-agent `maxIterations = 30`, and the two numbers only make
 * sense read together. Before this constant existed they disagreed by more than
 * an order of magnitude and were hand-synced across two call sites.
 *
 * This module imports nothing on purpose — that is what keeps
 * `process-agent-job.ts`'s leaf-path import inert.
 *
 * ## `maxTokensPerTurn` — 1,500,000
 *
 * The framework default is `DEFAULT_MAX_TOKENS_PER_TURN = 200_000`
 * (`agent-framework/engine.ts`). Kopilot never set this knob, so it ran on that
 * default — and a turn that exceeds it yields `turn-error`, which used to make
 * the workflow-builder capability roll the whole draft graph back to its
 * pre-turn snapshot. A dozen watched, individually-persisted edits vanished.
 *
 * ### The unit, and why this number was re-derived
 *
 * The first version of this constant (2,000,000) was sized under the OLD meter,
 * which summed each LLM call's `total_tokens`. `total_tokens` includes prompt
 * tokens and the entire conversation is re-sent on every iteration, so that
 * meter charged the same prompt once per tool round-trip — superlinear in
 * iteration count rather than linear in work done. It was an iteration cap
 * wearing a token-shaped mask.
 *
 * The engine now meters **non-cached input + completion**, per LLM call, off the
 * raw `IterationUsage` records (`agent-framework/usage-metering.ts`). Re-sending
 * a cached prefix is nearly free on every provider we use, and the meter now
 * says so, which makes 2,000,000 meaningless: the same turn meters far lower.
 *
 * ### The arithmetic
 *
 * From the one observed mid-turn Kopilot call — `promptInput: 34389`,
 * `cachedInput: 19072` — read under both provider semantics, because Kopilot is
 * BYO-model and the turn can run on either shape:
 *
 * ```text
 *   Anthropic shape (prompt_tokens EXCLUDES cached reads):
 *     metered/call ≈ 34_389 + ~1_500 completion   ≈  36_000   (pessimistic:
 *                                                              assumes the cache
 *                                                              never improves)
 *   OpenAI shape   (prompt_tokens INCLUDES cached reads):
 *     metered/call ≈ (34_389 − 19_072) + ~1_500   ≈  17_000   (realistic)
 *
 *   One full-length agent run is the per-agent cap, 30 iterations:
 *     pessimistic   30 × 36_000                    = 1_080_000
 *     realistic     30 × 17_000                    =   510_000
 *
 *   Sizing rule — the budget must cover ONE full-length run even on the
 *   pessimistic reading (so the graceful `maxIterations: 30` close, never the
 *   destructive token meter, is what ends a long turn), and THREE on the
 *   realistic one (so a procedure-stepper turn with legitimate continuations
 *   still fits):
 *     max(1_080_000, 3 × 510_000) = 1_530_000  →  1_500_000
 * ```
 *
 * **Still an estimate, pending live measurement.** The per-call figures above
 * are arithmetic on a single logged `LLM cache metrics` line, not a measurement
 * of a whole turn — the `LLM complete` log redacts `usage` because its keys
 * contain "token". The `logger.warn` at the engine's budget exits is the
 * instrumentation that will settle it: it now carries both `turnTokensUsed` (the
 * provider-reported grand total) and `turnMeteredTokens` (what this cap is
 * compared against), so one real exit in OpenObserve gives the true ratio.
 *
 * ### Why not lower
 *
 * The nominal drop from 2,000,000 is modest and that is deliberate. The fix is
 * the unit, not the constant: the budget must still clear 30 iterations on the
 * *worst* provider reading, or Phase B would reintroduce the very failure it
 * exists to remove — turns dying at the meter after doing all their work.
 *
 * ### Why not higher, and why not dropped
 *
 * It is the **only** bound on a runaway `continueTurn()` reinvoke loop. The
 * engine deliberately does not reset turn usage across procedure-stepper
 * continuations, and `maxTotalIterations` counts agents rather than iterations
 * (see below), so nothing else stops that loop. At 1,500,000 a runaway is cut
 * off after roughly three full-length agent runs.
 *
 * ## `maxTotalIterations` — 100
 *
 * Long-running plans routinely chain more than five approvals (one per ticket
 * reply, etc.) and need iteration headroom for plan-step churn. Other domains
 * stay on the framework defaults.
 *
 * Note that this knob counts **agents in the route** far more than iterations —
 * the engine advances it per `assistant-message-finished`, which the query loop
 * emits once per agent run. Kopilot is a solo-agent domain (`agents: ['agent']`),
 * so 100 is effectively unreachable here. It is kept at the historical value
 * rather than tuned, because tuning a knob whose unit is wrong would only bake
 * in the confusion; the unit itself is tracked as §10.1 of
 * `plans/kopilot/workflow/20-partial-turn-survival.md`.
 *
 * ## `maxApprovalsPerTurn` — 50
 *
 * Same reasoning as `maxTotalIterations`: the framework default of 5 is far
 * below what a multi-step Kopilot plan legitimately asks for.
 */
export const KOPILOT_TURN_BUDGET = {
  maxTokensPerTurn: 1_500_000,
  maxTotalIterations: 100,
  maxApprovalsPerTurn: 50,
} as const satisfies {
  maxTokensPerTurn: number
  maxTotalIterations: number
  maxApprovalsPerTurn: number
}

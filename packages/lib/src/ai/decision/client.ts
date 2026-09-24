// packages/lib/src/ai/decision/client.ts

/** Text only; an object keeps its parts named for the model. */
export type DecisionState = string | Record<string, unknown> | unknown[]

/** A typed question: pick an option (≤255), grade on 2–10 ordered levels, or answer true/false. */
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; options: Record<string, string | null> }
  | { type: 'score'; instructions: string; levels: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }

/** An answer to one question; `level` is 1-based and `expected`/`probabilities` are null when not produced natively. */
export type DecisionAnswer =
  | {
      type: 'choice'
      choice: string
      probabilities: Record<string, number> | null
      confidence: number
    }
  | {
      type: 'score'
      level: number
      expected: number | null
      probabilities: Record<string, number> | null
      confidence: number
    }
  | { type: 'noul'; probability: number }

/** How a confidence was produced; thresholds tuned for one kind must never be applied to the other. */
export type ConfidenceKind = 'calibrated' | 'self-reported'

/** The answers to one evaluation, keyed like the questions, plus the model and usage that produced them. */
export interface DecisionResult {
  answers: Record<string, DecisionAnswer>
  confidenceKind: ConfidenceKind
  provider: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

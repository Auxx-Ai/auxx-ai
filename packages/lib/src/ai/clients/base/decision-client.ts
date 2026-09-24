// packages/lib/src/ai/clients/base/decision-client.ts

import type { DecisionQuestion, DecisionResult, DecisionState } from '../../decision/client'
import { BaseSpecializedClient } from './base-specialized-client'

/** Parameters for one decision evaluation: N typed questions about one state. */
export interface DecisionEvaluateParams {
  provider: string
  model: string
  state: DecisionState
  questions: Record<string, DecisionQuestion>
}

/** Abstract base for clients that answer typed decision questions; subclasses implement `evaluate` only. */
export abstract class DecisionClient extends BaseSpecializedClient {
  abstract evaluate(params: DecisionEvaluateParams): Promise<DecisionResult>

  invoke(params: DecisionEvaluateParams): Promise<DecisionResult> {
    return this.evaluate(params)
  }
}

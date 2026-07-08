// packages/lib/src/workflow-engine/nodes/utils/model-capability-gates.ts

import { ProviderRegistry } from '../../../ai/providers/provider-registry'
import type { ModelCapabilities } from '../../../ai/providers/types'

/** Feature flags the AI node gates on at run time. */
export interface CapabilityGateInput {
  structuredOutputEnabled: boolean
  filesEnabled: boolean
}

/**
 * Which configured features must be skipped for the resolved model, plus
 * trace-visible warnings explaining each skip.
 */
export interface CapabilityGates {
  skipStructuredOutput: boolean
  skipFiles: boolean
  warnings: string[]
}

const NO_GATES: CapabilityGates = { skipStructuredOutput: false, skipFiles: false, warnings: [] }

/**
 * Compute capability gates for an AI-node run. A feature is unsupported ONLY
 * when the model's capability flag is explicitly `false` — unknown models
 * (custom/BYO, `supports: {}`) fail open, matching the runtime's
 * `filterUnsupportedFeatures` behavior. Stored node config is never mutated;
 * gating is a run-time skip + warning.
 */
export function resolveCapabilityGates(
  modelId: string,
  input: CapabilityGateInput,
  capabilities?: ModelCapabilities | null
): CapabilityGates {
  if (!input.structuredOutputEnabled && !input.filesEnabled) return NO_GATES

  const caps =
    capabilities === undefined ? ProviderRegistry.getModelCapabilities(modelId) : capabilities
  const supports = caps?.supports
  const displayName = caps?.displayName ?? modelId

  const skipStructuredOutput = input.structuredOutputEnabled && supports?.structured === false
  const skipFiles =
    input.filesEnabled && supports?.vision === false && supports?.fileInput === false

  const warnings: string[] = []
  if (skipStructuredOutput) {
    warnings.push(`Structured output skipped — not supported by ${displayName}`)
  }
  if (skipFiles) {
    warnings.push(`File attachments skipped — not supported by ${displayName}`)
  }

  return { skipStructuredOutput, skipFiles, warnings }
}

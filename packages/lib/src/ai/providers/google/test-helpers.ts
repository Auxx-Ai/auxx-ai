// packages/lib/src/ai/providers/google/test-helpers.ts
//
// Test-only helpers for the Google provider suites. Lives beside the source
// rather than in `__tests__/` because vitest's `src/**/__tests__/**/*.ts`
// include glob treats every file in that directory as a test suite.

import type { ModelCapabilities } from '../types'
import { GOOGLE_MODELS } from './google-defaults'

/**
 * Look up a model in the Google registry, failing loudly when it is missing.
 * Keeps assertions on registry entries from silently becoming `undefined`
 * property reads when a model id is renamed or dropped.
 */
export function requireGoogleModel(modelId: string): ModelCapabilities {
  const model = GOOGLE_MODELS[modelId]
  if (!model) {
    throw new Error(`GOOGLE_MODELS has no entry for "${modelId}"`)
  }
  return model
}

/**
 * Read the first recorded argument of a mocked call, failing loudly when the
 * mock was never invoked (rather than throwing an opaque index error).
 */
export function firstCallArg<T = any>(mock: { mock: { calls: any[][] } }, label = 'mock'): T {
  const call = mock.mock.calls[0]
  if (!call) {
    throw new Error(`Expected ${label} to have been called at least once`)
  }
  return call[0] as T
}

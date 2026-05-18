// packages/lib/src/prompt-templates/__tests__/flatten.test.ts

import { describe, expect, it } from 'vitest'
import { docToText } from '../../tiptap/doc-to-text'
import { listPromptTemplates } from '../template-registry'

/**
 * Stub label resolver for the flatten snapshot. Mirrors what the runtime
 * `resolvePromptBadges` produces conceptually — `[<Kind>: <name>](id)` —
 * without depending on a live tool / EntityDefinition lookup. The snapshot
 * locks the *shape* the model sees so a chip id rename surfaces in CI.
 */
function stubResolveReference(id: string): string {
  const colon = id.indexOf(':')
  if (colon <= 0) return `[reference](${id})`
  const prefix = id.slice(0, colon)
  const rest = id.slice(colon + 1)
  if (prefix === 'tool') return `[Tool: ${rest}](${id})`
  if (prefix === 'entity') return `[Entity: ${rest}](${id})`
  return `[reference](${id})`
}

describe('prompt template flatten snapshots', () => {
  for (const template of listPromptTemplates()) {
    it(`flattens "${template.id}" stably`, () => {
      const flattened = docToText(template.prompt, { references: stubResolveReference })
      expect(flattened).toMatchSnapshot()
    })
  }
})

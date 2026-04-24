// apps/extension/src/lib/lookup.ts

/**
 * Content-script-side client for the SW's lookupByField proxy. Lets a
 * host content script check "is this person/company already in Auxx?" and
 * flip an injected button to the "Open in Auxx" state without pulling
 * the iframe trpc client into the content world.
 *
 * Failures are silent — the default button keeps saying "Add to Auxx".
 */

import type { LookupByFieldMessage } from './messaging'

type Candidate = LookupByFieldMessage['candidates'][number]

export async function lookupRecordId(
  entityDefinitionId: 'contact' | 'company',
  candidates: Candidate[]
): Promise<string | null> {
  if (candidates.length === 0) return null
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'lookupByField',
      entityDefinitionId,
      candidates,
    })
    if (!response?.ok) return null
    return (response.recordId as string | null | undefined) ?? null
  } catch {
    return null
  }
}

// packages/lib/src/dedup/emit-identity-pairs.ts
//
// The one dedup write that does NOT come from a scan.
//
// ZERO permission checks (lib-module-guide §6): this is a system-side capture,
// and who may see the resulting pair is the read path's question.

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { ok } from 'neverthrow'
import { upsertPairs } from './pairs'
import { scoreIdentityGroup } from './scoring'

/** Parameters for {@link emitPairsFromIdentityMatch}. */
export interface EmitIdentityPairsParams {
  organizationId: string
  entityDefinitionId: string
  /** Every record the ambiguous lookup returned — 2+ or this is a no-op. */
  instanceIds: string[]
  /** Where the identity came from, e.g. the connector's source key. */
  source: string
  /** The upstream id whose match was ambiguous — carried into `Signal.value`. */
  externalId: string
}

/**
 * Record a duplicate the WRITE PATH just walked past.
 *
 * The connector sink resolves an upstream record to an existing instance via its
 * secondary match keys. When that lookup returns more than one record, the sink
 * takes the first and proceeds — the loser is a silent duplicate that no
 * subsequent scan is guaranteed to find, because neither record need ever go
 * dirty again. Capturing it here is the cheapest true-positive in the whole
 * feature: the connector's own match keys already agreed the records are the
 * same customer.
 *
 * Rated `high` unaided — the signal is `identity`, which is a strong key. The
 * band comes out of `scoreIdentityGroup` + the shared weights, not from a
 * literal here, so this stays consistent with what a scan would have produced.
 *
 * Idempotent: the pair upsert conflicts on the canonical pair key, so a
 * re-running sync refreshes the row rather than duplicating it.
 *
 * @returns how many pairs were written.
 */
export async function emitPairsFromIdentityMatch(
  db: Database,
  params: EmitIdentityPairsParams
): Promise<Result<number, Error>> {
  const { organizationId, entityDefinitionId, instanceIds, source, externalId } = params
  const ids = [...new Set(instanceIds.filter(Boolean))]
  if (ids.length < 2) return ok(0)

  const pairs = scoreIdentityGroup({
    organizationId,
    entityDefinitionId,
    group: { source, appFieldKey: null, externalId, instanceIds: ids },
  })

  return upsertPairs(db, pairs)
}

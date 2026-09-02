// packages/lib/src/data-connectors/preflight/run-preflight.ts
// Composes the sweep (item 1) and classification + lookup (item 2) into the
// duplicate-SKU adoption pre-flight report
// (plans/money/design/duplicate-sku-preflight.md §6.1). Read-only, end to end —
// see the module's `__tests__/run-preflight.test.ts` for the assertion that a
// db double which throws on any write never actually throws.
//
// Deliberately stops at item 2. Persisting the verdict (item 3) and gating the
// readiness ladder on it (item 4) are NOT built here — plans/money/tasks/37
// §9 phase 0 scopes this pre-flight to its read-only core; see this module's
// `index.ts` header for what a follow-up task needs.

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { getConnector } from '../service'
import { type ClassifyVariantsResult, classifyVariants } from './classify'
import { findPartsBySkus } from './lookup'
import { type SweepProductVariantsResult, sweepProductVariants } from './sweep'

/** Input to {@link runAdoptionPreflight}. */
export interface RunAdoptionPreflightInput {
  organizationId: string
  connectorId: string
  /** Threaded to `sweepProductVariants` → `prepareConnectorFetch`. An app
   *  connector (Shopify) resolves its own connection and ignores this; pass the
   *  session user when calling from a router. Defaults to `''`. */
  userId?: string
  /** Ceiling on pages fetched before the sweep refuses to continue (see
   *  `ConnectorSweepPageCeilingError`). Unbounded when omitted. */
  maxPages?: number
}

/**
 * Swappable collaborators, for tests only. Both default to the real
 * functions — this exists solely so `run-preflight.test.ts` can substitute a
 * hand-written fake sweep/lookup and prove the composition never writes,
 * without needing a live connector credential or the Redis-backed org cache
 * `findPartsBySkus` reads through. Not part of the module's public contract;
 * a production caller never passes this.
 */
export interface RunAdoptionPreflightDeps {
  sweepProductVariants: typeof sweepProductVariants
  findPartsBySkus: typeof findPartsBySkus
}

const defaultDeps: RunAdoptionPreflightDeps = { sweepProductVariants, findPartsBySkus }

/** The full pre-flight report. */
export interface AdoptionPreflightReport {
  organizationId: string
  connectorId: string
  /** Total variants the sweep found, across the whole catalog. */
  variantCount: number
  /** Pages the sweep walked — see `SweepProductVariantsResult.pagesFetched`. */
  pagesFetched: number
  rows: ClassifyVariantsResult['rows']
  summary: ClassifyVariantsResult['summary']
}

/**
 * Run the duplicate-SKU adoption pre-flight for one connector: sweep the whole
 * `product` stream, look up every distinct non-blank SKU against existing
 * (including archived) parts, and classify every variant.
 *
 * Read-only end to end — `getConnector` is the only db call this function
 * itself makes, and it is a read. Everything downstream (`sweepProductVariants`,
 * `findPartsBySkus`) is read-only by construction (see their own docs); nothing
 * in this composition ever calls `insert`/`update`/`delete`.
 */
export async function runAdoptionPreflight(
  db: Database,
  input: RunAdoptionPreflightInput,
  deps: RunAdoptionPreflightDeps = defaultDeps
): Promise<Result<AdoptionPreflightReport, Error>> {
  const connectorResult = await getConnector(db, input.organizationId, input.connectorId)
  if (connectorResult.isErr()) {
    return err(new NotFoundError(connectorResult.error.message))
  }

  const sweepResult = await deps.sweepProductVariants(db, {
    organizationId: input.organizationId,
    userId: input.userId ?? '',
    connector: connectorResult.value,
    maxPages: input.maxPages,
  })
  if (sweepResult.isErr()) return err(sweepResult.error)
  const { variants, pagesFetched }: SweepProductVariantsResult = sweepResult.value

  let existingParts: Awaited<ReturnType<typeof findPartsBySkus>>
  try {
    const skus = variants
      .map((v) => v.sku)
      .filter((sku): sku is string => typeof sku === 'string' && sku.trim().length > 0)
    existingParts = await deps.findPartsBySkus(db, input.organizationId, skus)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }

  const { rows, summary } = classifyVariants(variants, existingParts)

  return ok({
    organizationId: input.organizationId,
    connectorId: input.connectorId,
    variantCount: variants.length,
    pagesFetched,
    rows,
    summary,
  })
}

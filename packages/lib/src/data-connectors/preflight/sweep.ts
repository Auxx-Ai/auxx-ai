// packages/lib/src/data-connectors/preflight/sweep.ts
// The read-only, full-catalog variant sweep — item 1 of the duplicate-SKU
// adoption pre-flight (plans/money/design/duplicate-sku-preflight.md §6.1).
// Pages through a connector's ENTIRE `product` stream (never a sample, §5) and
// flattens every product's projected `variants[]` subtree into one row per
// variant. No writes: built on `sweepConnectorFetch`, the paginating sibling
// of `sampleConnectorFetch` added in `../connector-runtime.ts`.

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { sweepConnectorFetch } from '../connector-runtime'
import type { ConnectorRecord } from '../connectors/types'
import type { DataConnectorRow } from '../service'

/** The stream this sweep always reads. Never configurable — the pre-flight is
 *  specifically about the product/variant catalog (design §0). */
const PRODUCT_STREAM_KEY = 'product'

/** One variant discovered by the sweep, before classification. */
export interface SweptVariant {
  /** Raw, unnormalized SKU exactly as the connector projected it. `null` when
   *  the source field was absent. Classification (`classify.ts`) does the
   *  trimming — this layer never mutates the value it read. */
  sku: string | null
  /** The variant's external id (Shopify's numeric variant id, stringified). */
  variantId: string
  /** Display title for the row; falls back to the variant id when the source
   *  projected no title. */
  title: string
  /** The owning product's external id. */
  productId: string
}

/** Input to {@link sweepProductVariants}. */
export interface SweepProductVariantsInput {
  organizationId: string
  /** Resolves the borrowed credential — see `resolveConnectorCredential`. An
   *  app connector (Shopify) ignores this and resolves its own connection;
   *  threaded through only because `prepareConnectorFetch` requires it. */
  userId: string
  connector: DataConnectorRow
  /** Ceiling on pages fetched before the sweep refuses to continue. Unbounded
   *  when omitted — see `ConnectorSweepPageCeilingError`. */
  maxPages?: number
}

/**
 * Extract one row per variant from a page of `product`-stream records.
 *
 * **Assumed projected shape** — updated 2026-09-02 for task 37's retarget of
 * the Shopify connector onto the native `product`/`part` entities
 * (`auxxai-apps/apps/shopify/src/shopify.connector.server.ts`,
 * `plans/money/tasks/37-shopify-native-retarget.md` §7.1). The SDK's own
 * connector-app fixture (`packages/sdk/__fixtures__/connector-app`) has no
 * `product` stream to check against, so this is the real, currently-shipped
 * shape rather than a fixture:
 *
 *  - the product's external id is `record.externalId`, falling back to
 *    `record.fields.shopify_id` (both are the same stringified Shopify
 *    product id today; the fallback only matters for a connector that omits
 *    `externalId`)
 *  - `record.fields.variants` is an array; each element carries `shopifyId`
 *    (the variant's external id, already stringified), `sku`, and `title` —
 *    renamed from the pre-task-37 `id` now that a contributing mapping's
 *    `sourcePath` addresses the projected record directly (no more separate
 *    Layer-A "declared field key" distinct from the raw payload path)
 *
 * A variant with no extractable id is dropped (logged nowhere — this is a pure
 * function): there is nothing to classify or link it by, and the design's
 * report is about SKUs, not about surfacing malformed source data.
 */
export function extractVariantsFromProducts(records: ConnectorRecord[]): SweptVariant[] {
  const variants: SweptVariant[] = []

  for (const record of records) {
    const fields = (record.fields ?? {}) as Record<string, unknown>
    const productId = record.externalId ?? toStringId(fields.shopify_id)
    if (!productId) continue

    const rawVariants = Array.isArray(fields.variants) ? fields.variants : []
    for (const rawVariant of rawVariants) {
      if (typeof rawVariant !== 'object' || rawVariant === null) continue
      const v = rawVariant as Record<string, unknown>
      const variantId = toStringId(v.shopifyId)
      if (!variantId) continue

      variants.push({
        sku: typeof v.sku === 'string' ? v.sku : null,
        variantId,
        title: typeof v.title === 'string' && v.title.length > 0 ? v.title : variantId,
        productId,
      })
    }
  }

  return variants
}

/** Coerce a raw id field (string or number, per the fixture types) to a non-empty string, or null. */
function toStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number') return String(value)
  return null
}

/** Result of a full-catalog sweep. */
export interface SweepProductVariantsResult {
  variants: SweptVariant[]
  /** Pages the sweep walked — surfaced so a caller/report can show catalog size,
   *  and so a follow-up job+progress design (design §8 item 4) has a number to start from. */
  pagesFetched: number
}

/**
 * Page through the connector's entire `product` stream and return every
 * variant it carries, flattened to one row each. Never a sample (design §5)
 * and never a write — see `sweepConnectorFetch` for the read-only fetch path.
 */
export async function sweepProductVariants(
  db: Database,
  input: SweepProductVariantsInput
): Promise<Result<SweepProductVariantsResult, Error>> {
  try {
    const { records, pagesFetched } = await sweepConnectorFetch(
      db,
      input.organizationId,
      input.userId,
      input.connector,
      { streamKey: PRODUCT_STREAM_KEY, maxPages: input.maxPages }
    )
    return ok({ variants: extractVariantsFromProducts(records), pagesFetched })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

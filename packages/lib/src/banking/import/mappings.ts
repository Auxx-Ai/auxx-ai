// packages/lib/src/banking/import/mappings.ts

/**
 * Saved column mappings, one per header signature
 * (plans/accounting/ui-plan.md §2.9, plans/bank-connection/05-file-import.md §4).
 *
 * ## Where these live, and why not on the import job
 *
 * The brief asks for a per-bank `BankCsvProfile`; the review's finding 10 points
 * out that a complete generic importer already exists, so what a "profile" is,
 * concretely, is the column mapping a person already made. The importer DOES
 * persist that per job (`ImportMapping` + `ImportMappingProperty`, and
 * `saveMappingTemplate` even names the mapping) - but a job is deleted when the
 * user starts over, is scoped to one upload, and carries no header signature to
 * look it up by. Recovering last month's mapping would mean scanning every job
 * in the org and re-deriving a signature from each one's stored headers.
 *
 * So the mapping is remembered in ONE org setting keyed by signature, and
 * REPLAYED into the job's own `ImportMappingProperty` rows through
 * `dataImport.saveColumnMapping` - the same procedure the wizard's own mapping
 * step calls. There is still exactly one authority for what a job's mapping is;
 * this is a prefill of it, not a second copy.
 */

import type { Database } from '@auxx/database'
import { BadRequestError } from '../../errors'
import { getOrganizationSetting, updateOrganizationSetting } from '../../settings'
import { headerSignature } from './header-signature'
import type { SavedMapping, SavedMappingColumn } from './types'

/** The one org setting these live in. Declared in `settings/catalog.ts`. */
export const BANK_IMPORT_MAPPINGS_KEY = 'banking.importMappings' as const

/**
 * How many signatures one org keeps.
 *
 * A cap rather than unbounded growth: this is a JSON blob on a settings row that
 * the org cache holds in memory, and a customer who uploads a differently-shaped
 * export every week would otherwise grow it without limit. The oldest entry is
 * evicted, which is the right one to lose - the banks a business actually uses
 * are re-uploaded monthly and keep refreshing their `savedAt`.
 */
export const MAX_SAVED_MAPPINGS = 40

/**
 * The mapping remembered for this header row, or `null`.
 *
 * Takes the HEADERS, not a signature, so the caller never computes a signature
 * with a different normaliser than the one that stored it.
 */
export async function readSavedMapping(
  db: Database,
  params: { organizationId: string; headers: readonly string[] }
): Promise<SavedMapping | null> {
  const signature = headerSignature(params.headers)
  const store = await readStore(db, params.organizationId)
  return store[signature] ?? null
}

/** Every mapping the org has remembered, newest save first. */
export async function listSavedMappings(
  db: Database,
  params: { organizationId: string }
): Promise<SavedMapping[]> {
  const store = await readStore(db, params.organizationId)
  return Object.values(store).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

/**
 * Remember a mapping against its header row.
 *
 * Overwrites the entry for the same signature: the newer mapping is the one the
 * person just corrected, and keeping a history of mappings for one header shape
 * would only pose a question ("which of these three?") that nobody can answer.
 */
export async function saveMapping(
  db: Database,
  params: {
    organizationId: string
    headers: readonly string[]
    columns: readonly SavedMappingColumn[]
    label?: string | null
  }
): Promise<SavedMapping> {
  if (params.headers.length === 0) {
    throw new BadRequestError('A mapping cannot be remembered for a file with no header row')
  }

  const signature = headerSignature(params.headers)
  const entry: SavedMapping = {
    signature,
    headers: params.headers.map((header) => String(header ?? '')),
    columns: params.columns.map((column) => ({
      columnIndex: column.columnIndex,
      targetFieldKey: column.targetFieldKey,
      resolutionType: column.resolutionType,
      isIdentifier: !!column.isIdentifier,
    })),
    savedAt: new Date().toISOString(),
    label: params.label?.trim() || null,
  }

  const store = await readStore(db, params.organizationId)
  store[signature] = entry

  const kept = Object.values(store)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
    .slice(0, MAX_SAVED_MAPPINGS)

  await updateOrganizationSetting({
    organizationId: params.organizationId,
    key: BANK_IMPORT_MAPPINGS_KEY,
    value: Object.fromEntries(kept.map((mapping) => [mapping.signature, mapping])),
    db,
  })

  return entry
}

/** Forget one remembered mapping. Answers whether there was one. */
export async function forgetMapping(
  db: Database,
  params: { organizationId: string; signature: string }
): Promise<boolean> {
  const store = await readStore(db, params.organizationId)
  if (!store[params.signature]) return false
  delete store[params.signature]
  await updateOrganizationSetting({
    organizationId: params.organizationId,
    key: BANK_IMPORT_MAPPINGS_KEY,
    value: store,
    db,
  })
  return true
}

/**
 * The stored blob, narrowed to well-formed entries.
 *
 * ⚠️ Silently drops a malformed one rather than throwing. This is a JSON column
 * a future version of this code may reshape, and one bad entry must not make
 * every OTHER remembered mapping unreachable.
 */
async function readStore(
  db: Database,
  organizationId: string
): Promise<Record<string, SavedMapping>> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: BANK_IMPORT_MAPPINGS_KEY,
    db,
  })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const store: Record<string, SavedMapping> = {}
  for (const [signature, value] of Object.entries(raw as Record<string, unknown>)) {
    const mapping = narrowMapping(signature, value)
    if (mapping) store[signature] = mapping
  }
  return store
}

function narrowMapping(signature: string, value: unknown): SavedMapping | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<SavedMapping>
  if (!Array.isArray(entry.headers) || !Array.isArray(entry.columns)) return null

  const columns = entry.columns.flatMap((column): SavedMappingColumn[] => {
    if (!column || typeof column !== 'object') return []
    const { columnIndex, targetFieldKey, resolutionType, isIdentifier } =
      column as Partial<SavedMappingColumn>
    if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex)) return []
    if (typeof resolutionType !== 'string') return []
    return [
      {
        columnIndex,
        targetFieldKey: typeof targetFieldKey === 'string' ? targetFieldKey : null,
        resolutionType,
        isIdentifier: !!isIdentifier,
      },
    ]
  })

  return {
    signature,
    headers: entry.headers.map((header) => String(header ?? '')),
    columns,
    savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date(0).toISOString(),
    label: typeof entry.label === 'string' ? entry.label : null,
  }
}

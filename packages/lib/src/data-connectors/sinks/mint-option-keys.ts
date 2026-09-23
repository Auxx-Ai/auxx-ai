// packages/lib/src/data-connectors/sinks/mint-option-keys.ts

import type { Database } from '@auxx/database'
import type { FieldOptions } from '../../custom-fields/field-options'
import { mintOrMatchOptions } from '../../custom-fields/mint-options'
import { canGrowFieldOptions, fieldAllowsNewOptions } from '../../custom-fields/ownership'

const OPTION_BEARING = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS'])

/** The slice of a `CustomField` row the grow gates and the minter read. */
export interface MintableField {
  id: string
  type: string
  systemAttribute?: string | null
  appInstallationId?: string | null
  dataConnectorId?: string | null
  options?: unknown
}

/**
 * Turn a connector's option LABELS into option keys, minting the ones the field
 * does not have yet. A label the write path could not match used to be stored
 * verbatim as its own `optionId`, so every connector-written tag rendered as an
 * unknown chip. Fields that may not grow (system selects, app- or
 * connector-owned fields, `allowNewOptions: false`) pass through untouched.
 */
export async function mintOptionKeys(
  db: Database,
  organizationId: string,
  field: MintableField | undefined,
  value: unknown
): Promise<unknown> {
  if (!field || !OPTION_BEARING.has(field.type)) return value
  const envelope = (field.options ?? {}) as FieldOptions
  if (
    !canGrowFieldOptions(field) ||
    !fieldAllowsNewOptions({ type: field.type, options: envelope })
  )
    return value
  const labels = Array.isArray(value) ? value : [value]
  if (labels.length === 0 || !labels.every((l) => typeof l === 'string' && l.trim())) return value

  // The cached option list answers the common case without the minter's row lock.
  const storedOptions = envelope.options ?? []
  const params = { fieldId: field.id, organizationId, labels }
  const preview = await mintOrMatchOptions(db, { ...params, storedOptions, dryRun: true })
  const { ids } = preview.minted === 0 ? preview : await mintOrMatchOptions(db, params)
  if (ids.length === 0) return value
  return Array.isArray(value) ? ids : ids[0]
}

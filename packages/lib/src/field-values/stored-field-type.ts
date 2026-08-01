// packages/lib/src/field-values/stored-field-type.ts

import type { FieldType } from '@auxx/database/types'

/**
 * The field types `CustomField.type` can actually hold.
 *
 * The column is the `ContactFieldType` pg enum (`database/db/schema/_shared.ts`),
 * which still lists the legacy `PHONE` member. `FieldType` — derived from
 * `FieldTypeValues` — dropped it in favour of `PHONE_INTL` (the entry is
 * commented out in `@auxx/database/enums`), but no migration ever rewrote the
 * rows: the dev database still holds `PHONE` fields. So a value read off the
 * column is `StoredFieldType`, never `FieldType`, and the gap has to be folded
 * explicitly rather than cast away.
 *
 * @see {@link toFieldType}
 * @see `search-text.ts` `LEGACY_TEXT_DB_ONLY_TYPES`, which makes the same
 *      allowance so legacy rows are not dropped from the search corpus.
 */
export type StoredFieldType = FieldType | 'PHONE'

/**
 * Fold a stored field type onto its `FieldType` counterpart.
 *
 * `PHONE` and `PHONE_INTL` route to the same `phoneConverter` (see
 * `converters/index.ts`), so the fold is behaviour-preserving for every
 * conversion, validation and formatting path — it only removes the legacy
 * spelling before the value reaches `FieldType`-typed code.
 */
export function toFieldType(stored: StoredFieldType): FieldType {
  return stored === 'PHONE' ? 'PHONE_INTL' : stored
}

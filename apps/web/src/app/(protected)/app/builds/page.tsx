// apps/web/src/app/(protected)/app/builds/page.tsx

'use client'

import { RecordsView } from '~/components/records'

/**
 * Builds list — the shared `RecordsView` for the `builds` resource
 * (plans/products/build/01-build-plan.md §3.6).
 *
 * The columns are driven entirely by the field registry, not by this file:
 * `primaryDisplayField: 'number'` pins `B-0001` as the first column and
 * `secondaryDisplayField: 'part'` supplies the subtitle, both from
 * `DISPLAY_FIELD_CONFIG`. `build_source` is the one field declared
 * `showInTable: true` while `showInPanel: false` (§1.6), so the default table
 * carries a Source column and an auto-build raised by the order trigger is
 * distinguishable at a glance from one a person raised deliberately.
 *
 * ⚠️ `number` is NULL on every build created before the numbering hook landed,
 * so the primary cell falls back to the record's own display name. Nothing here
 * needs to know that; it is why no surface in this feature formats a number
 * without a fallback.
 */
export default function BuildsPage() {
  return <RecordsView slug='builds' basePath='/app/builds' />
}

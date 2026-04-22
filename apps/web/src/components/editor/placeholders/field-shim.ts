// apps/web/src/components/editor/placeholders/field-shim.ts

import type { OrgSlug } from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'

/**
 * Synthesize a `ResourceField` for a synthetic `org:<slug>` token so
 * `FieldInputRow` can render a fallback editor for it.
 *
 * Organization has no `CustomField` rows — the placeholder resolver reads
 * its three columns (`name`, `handle`, `website`) directly off the
 * `Organization` DB row. The shim carries the minimum fields `FieldInputRow`
 * needs: `id`, `label`, `fieldType`, `type`, `required`, `capabilities`.
 */
export function shimFieldForOrg(slug: OrgSlug): ResourceField {
  const label = ORG_LABELS[slug]
  const fieldType = slug === 'website' ? 'URL' : 'TEXT'
  return {
    id: `org:${slug}` as FieldId,
    key: slug,
    label,
    type: 'string',
    fieldType,
    required: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
  }
}

const ORG_LABELS: Record<OrgSlug, string> = {
  name: 'Name',
  handle: 'Handle',
  website: 'Website',
}

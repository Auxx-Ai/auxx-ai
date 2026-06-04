// packages/lib/src/agents/bindings/available-fields.ts

import { toResourceFieldId } from '@auxx/types/field'
import {
  getCachedAppByInstallationId,
  getCachedEntityDefId,
  getCachedFieldMap,
  getCachedResourceFields,
} from '../../cache/org-cache-helpers'
import type { AvailableField } from './types'

/** Anchor entity types a chat subject provides, with their picker group labels. */
const ANCHOR_LABELS: Record<string, string> = {
  contact: 'Contact',
  participant: 'Participant',
  thread: 'Thread',
}

/**
 * Project the bindable fields for one anchor entity type (`contact` /
 * `participant` / `thread`). Emits the `self` ref first, then one entry per
 * field (built-in, custom, app-registered). App-owned fields are addressed by
 * the stable `@app:<slug>:<key>` form and surfaced even when hidden (they're
 * binding targets by design, e.g. Shopify's `customerId`).
 */
export async function availableFieldsForAnchor(
  orgId: string,
  anchor: string
): Promise<AvailableField[]> {
  const group = ANCHOR_LABELS[anchor] ?? anchor
  const out: AvailableField[] = [
    { ref: `${anchor}:self`, label: `${group} ID`, group, fieldType: 'TEXT' },
  ]

  const entityDefId = await getCachedEntityDefId(orgId, anchor)
  if (!entityDefId) return out

  const fields = await getCachedResourceFields(orgId, anchor)
  const fieldMap = await getCachedFieldMap(orgId, entityDefId)

  for (const field of fields) {
    if (field.isAppOwned) {
      const appFieldKey = fieldMap.get(field.id)?.appFieldKey
      if (!appFieldKey) continue
      const installationId = field.appInstallationId
      const app = installationId ? await getCachedAppByInstallationId(orgId, installationId) : null
      if (!app) continue
      out.push({
        ref: `${anchor}:@app:${app.slug}:${appFieldKey}`,
        label: field.label,
        group: app.title || app.slug || 'App',
        fieldType: field.fieldType ?? 'TEXT',
      })
      continue
    }

    // Non-app fields hidden from the picker (not user-facing) are skipped.
    if (field.capabilities?.hidden === true) continue

    const ref = field.resourceFieldId ?? toResourceFieldId(entityDefId, field.id)
    out.push({ ref, label: field.label, group, fieldType: field.fieldType ?? 'TEXT' })
  }

  return out
}

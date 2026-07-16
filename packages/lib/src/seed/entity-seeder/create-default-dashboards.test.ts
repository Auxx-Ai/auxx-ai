// packages/lib/src/seed/entity-seeder/create-default-dashboards.test.ts

import { describe, expect, it } from 'vitest'
import { dashboardLayoutDocSchema } from '../../dashboards/config-schemas'
import { COMPANY_FIELDS } from '../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import { DEFAULT_DASHBOARD_CONFIGS } from '../default-dashboard-configs'
import { ENTITY_INSTANCE_COLUMNS } from './constants'
import { type ResolvableEntityDefMap, resolveDashboardLayout } from './create-default-dashboards'
import type { ResolvableFieldMap } from './create-default-views'

/**
 * Build a canonical fresh-org fixture straight FROM the real system-field registries
 * (`TICKET_FIELDS`/`CONTACT_FIELDS`/`COMPANY_FIELDS`) rather than hand-copied
 * `systemAttribute` strings — a renamed or removed system field shows up here automatically as
 * a dropped-widget assertion failure below, instead of the templates silently drifting out of
 * sync with the real registries (plan 03 "Tests / verify").
 */
function buildFixture(): { entityDefMap: ResolvableEntityDefMap; fieldMap: ResolvableFieldMap } {
  const entityDefMap: ResolvableEntityDefMap = new Map([
    ['ticket', { id: 'def-ticket' }],
    ['contact', { id: 'def-contact' }],
    ['company', { id: 'def-company' }],
  ])

  const fieldMap: ResolvableFieldMap = new Map()
  const registries: [string, Record<string, { id: string; systemAttribute?: string }>][] = [
    ['ticket', TICKET_FIELDS],
    ['contact', CONTACT_FIELDS],
    ['company', COMPANY_FIELDS],
  ]
  for (const [entityType, fields] of registries) {
    for (const field of Object.values(fields)) {
      if (!field.systemAttribute) continue
      // Mirror the real seeder (`shouldCreateField`): ENTITY_INSTANCE_COLUMNS never
      // become CustomField rows — the resolver must fall back to their static ids,
      // so the fixture must NOT hand it a CustomField-shaped entry for them.
      if ((ENTITY_INSTANCE_COLUMNS as readonly string[]).includes(field.systemAttribute)) continue
      fieldMap.set(`${entityType}:${field.id}`, {
        id: `cf-${entityType}-${field.systemAttribute}`,
        systemAttribute: field.systemAttribute,
      })
    }
  }
  return { entityDefMap, fieldMap }
}

describe('resolveDashboardLayout', () => {
  it('fully resolves every default template with zero dropped widgets', () => {
    const { entityDefMap, fieldMap } = buildFixture()

    for (const [entityType, def] of Object.entries(DEFAULT_DASHBOARD_CONFIGS)) {
      if (!def) continue
      const { doc, droppedWidgets } = resolveDashboardLayout(def.layout, entityDefMap, fieldMap)
      expect(droppedWidgets, `${entityType} dropped: ${droppedWidgets.join(', ')}`).toEqual([])

      const widgetCount = doc.tabs.reduce((n, t) => n + t.widgets.length, 0)
      expect(widgetCount).toBeGreaterThan(0)

      const parsed = dashboardLayoutDocSchema.safeParse(doc)
      expect(
        parsed.success,
        parsed.success ? '' : `${entityType}: ${JSON.stringify(parsed.error!.format())}`
      ).toBe(true)
    }
  })

  it('drops a widget whose source references an entity type not yet seeded', () => {
    const { entityDefMap, fieldMap } = buildFixture()
    entityDefMap.delete('company') // simulate: company def doesn't exist on this org yet

    const companyDef = DEFAULT_DASHBOARD_CONFIGS.company!
    const { doc, droppedWidgets } = resolveDashboardLayout(
      companyDef.layout,
      entityDefMap,
      fieldMap
    )

    const totalWidgets = companyDef.layout.tabs[0]!.widgets.length
    expect(droppedWidgets.length).toBe(totalWidgets)
    expect(doc.tabs[0]!.widgets).toEqual([]) // skip-dashboard path: zero widgets survive
  })

  it('drops only the widgets referencing a field missing from the field map', () => {
    const { entityDefMap, fieldMap } = buildFixture()
    // Remove ticket status — used by the "Open Tickets"/"Closed"/"Unassigned" KPI
    // filters, the status pie, and the "Overdue Tickets" record-list filter.
    fieldMap.delete('ticket:status')

    const ticketDef = DEFAULT_DASHBOARD_CONFIGS.ticket!
    const { doc, droppedWidgets } = resolveDashboardLayout(ticketDef.layout, entityDefMap, fieldMap)

    expect(droppedWidgets.sort()).toEqual(
      ['By Status', 'Closed', 'Open Tickets', 'Unassigned', 'Overdue Tickets'].sort()
    )
    // The remaining widgets don't reference status — they survive.
    const survivingTitles = doc.tabs[0]!.widgets.map((w) => w.title).sort()
    expect(survivingTitles).toEqual(
      ['Created', 'Tickets Created', 'By Priority', 'Top Types'].sort()
    )
  })
})

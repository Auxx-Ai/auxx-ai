// packages/lib/src/seed/default-dashboard-configs.ts

import type { ResourceFieldId } from '@auxx/types/field'
import type {
  DashboardLayoutDoc,
  GridPosition,
  LayoutWidget,
  WidgetConfiguration,
  WidgetKind,
  WidgetSource,
} from '../dashboards/client'
import { SYSTEM_REF_PREFIX } from '../entity-templates/types'

/**
 * A seeded dashboard template, authored symbolically and resolved to a real
 * `DashboardLayoutDoc` per-org at seed time (`create-default-dashboards.ts`'s
 * `resolveDashboardLayout`). Structurally identical to `DashboardLayoutDoc` —
 * only the string CONTENTS of `WidgetSource.entityDefinitionId` (`@system:<entityType>`,
 * see `SYSTEM_REF_PREFIX`/`parseSymbolicRef` in `entity-templates/types.ts`) and every
 * `WidgetFieldRef` slot (`field_<systemAttribute>`, the `DEFAULT_VIEW_CONFIGS` grammar)
 * are symbolic rather than real ids. Field refs are cast through `fref()` below so the
 * templates still type-check against the real (branded) `WidgetConfiguration` union.
 */
export type SeedLayoutDoc = DashboardLayoutDoc

export type DefaultDashboardDefinition = {
  name: string
  description?: string
  icon?: { iconId: string; color?: string }
  layout: SeedLayoutDoc
}

/**
 * Cast a `field_<systemAttribute>` symbolic string through to `ResourceFieldId` so
 * templates satisfy `WidgetFieldRef` at author time. Resolved to the real id by
 * `resolveDashboardLayout` before the doc is ever persisted or validated.
 */
function fref(systemAttribute: string): ResourceFieldId {
  return `field_${systemAttribute}` as ResourceFieldId
}

/** Symbolic entity source — `@system:<entityType>`, resolved per-widget at seed time. */
function systemSource(entityType: string): WidgetSource {
  return { kind: 'entity', entityDefinitionId: `${SYSTEM_REF_PREFIX}${entityType}` }
}

function widget(
  id: string,
  title: string,
  type: WidgetKind,
  gridPosition: GridPosition,
  configuration: WidgetConfiguration
): LayoutWidget {
  return { id, title, type, gridPosition, configuration }
}

// ── ticket: "Support Overview" ──────────────────────────────────────────────
// Loose inspiration from the deleted hardcoded ticket dashboard only — no
// fidelity requirement (README decision 10, Markus 2026-07-16).

const ticketDashboard: DefaultDashboardDefinition = {
  name: 'Support Overview',
  icon: { iconId: 'ticket', color: 'blue' },
  layout: {
    globalFilters: { dateRange: 'last30d' },
    tabs: [
      {
        id: 'tab-overview',
        title: 'Overview',
        icon: null,
        widgets: [
          widget(
            'w-open-tickets',
            'Open Tickets',
            'kpi',
            { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              // "Now" number — not date-bound, so it always reflects the current queue.
              globalDateFieldRef: null,
              filters: [
                {
                  id: 'open-tickets-group',
                  logicalOperator: 'AND',
                  conditions: [
                    {
                      id: 'open-tickets-status-not-in',
                      fieldId: fref('ticket_status'),
                      operator: 'not in',
                      value: ['CLOSED', 'RESOLVED', 'CANCELLED', 'MERGED'],
                      isConstant: true,
                    },
                  ],
                },
              ],
            }
          ),
          widget(
            'w-created-tickets',
            'Created',
            'kpi',
            { column: 3, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              globalDateFieldRef: fref('created_at'),
              trend: { dateFieldRef: fref('created_at'), compare: 'previousPeriod' },
            }
          ),
          widget(
            'w-closed-tickets',
            'Closed',
            'kpi',
            { column: 6, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              globalDateFieldRef: fref('updated_at'),
              filters: [
                {
                  id: 'closed-tickets-group',
                  logicalOperator: 'AND',
                  conditions: [
                    {
                      id: 'closed-tickets-status-in',
                      fieldId: fref('ticket_status'),
                      operator: 'in',
                      value: ['CLOSED', 'RESOLVED'],
                      isConstant: true,
                    },
                  ],
                },
              ],
            }
          ),
          widget(
            'w-unassigned-tickets',
            'Unassigned',
            'kpi',
            { column: 9, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              // "Now" number — the open queue nobody owns yet.
              globalDateFieldRef: null,
              filters: [
                {
                  id: 'unassigned-tickets-group',
                  logicalOperator: 'AND',
                  conditions: [
                    {
                      id: 'unassigned-tickets-assignee-empty',
                      fieldId: fref('assigned_to_id'),
                      operator: 'empty',
                      value: null,
                      isConstant: true,
                    },
                    {
                      id: 'unassigned-tickets-status-not-in',
                      fieldId: fref('ticket_status'),
                      operator: 'not in',
                      value: ['CLOSED', 'RESOLVED', 'CANCELLED', 'MERGED'],
                      isConstant: true,
                    },
                  ],
                },
              ],
            }
          ),
          widget(
            'w-tickets-created-trend',
            'Tickets Created',
            'lineChart',
            { column: 0, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'lineChart',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('created_at'), dateGranularity: 'day' },
              area: true,
            }
          ),
          widget(
            'w-tickets-by-status',
            'By Status',
            'pieChart',
            { column: 6, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'pieChart',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('ticket_status') },
              donut: true,
              showCenterTotal: true,
            }
          ),
          widget(
            'w-tickets-by-priority',
            'By Priority',
            'barChart',
            { column: 0, row: 6, columnSpan: 4, rowSpan: 4 },
            {
              kind: 'barChart',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('ticket_priority') },
            }
          ),
          widget(
            'w-tickets-by-type',
            'Top Types',
            'barChart',
            { column: 4, row: 6, columnSpan: 4, rowSpan: 4 },
            {
              kind: 'barChart',
              source: systemSource('ticket'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('ticket_type') },
            }
          ),
          widget(
            'w-overdue-tickets',
            'Overdue Tickets',
            'recordList',
            { column: 8, row: 6, columnSpan: 4, rowSpan: 4 },
            {
              kind: 'recordList',
              source: systemSource('ticket'),
              // Overdue = due before now (`older_than_days: 0` ⇒ dueDate < now) and
              // still open; not bound to the global date range — overdue is overdue.
              globalDateFieldRef: null,
              filters: [
                {
                  id: 'overdue-tickets-group',
                  logicalOperator: 'AND',
                  conditions: [
                    {
                      id: 'overdue-tickets-due-before-now',
                      fieldId: fref('due_date'),
                      operator: 'older_than_days',
                      value: 0,
                      isConstant: true,
                    },
                    {
                      id: 'overdue-tickets-status-not-in',
                      fieldId: fref('ticket_status'),
                      operator: 'not in',
                      value: ['CLOSED', 'RESOLVED', 'CANCELLED', 'MERGED'],
                      isConstant: true,
                    },
                  ],
                },
              ],
              columns: [fref('ticket_title'), fref('ticket_status'), fref('due_date')],
              sort: { fieldRef: fref('due_date'), desc: false },
              pageSize: 6,
            }
          ),
        ],
      },
    ],
  },
}

// ── contact: "Contacts Overview" ────────────────────────────────────────────

const contactDashboard: DefaultDashboardDefinition = {
  name: 'Contacts Overview',
  icon: { iconId: 'user', color: 'indigo' },
  layout: {
    globalFilters: { dateRange: 'last30d' },
    tabs: [
      {
        id: 'tab-overview',
        title: 'Overview',
        icon: null,
        widgets: [
          widget(
            'w-total-contacts',
            'Total Contacts',
            'kpi',
            { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('contact'),
              metric: { op: 'count' },
              globalDateFieldRef: null,
            }
          ),
          widget(
            'w-new-contacts',
            'New Contacts',
            'kpi',
            { column: 3, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('contact'),
              metric: { op: 'count' },
              globalDateFieldRef: fref('created_at'),
              trend: { dateFieldRef: fref('created_at'), compare: 'previousPeriod' },
            }
          ),
          widget(
            'w-contacts-created-trend',
            'New Contacts',
            'lineChart',
            { column: 0, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'lineChart',
              source: systemSource('contact'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('created_at'), dateGranularity: 'day' },
              area: true,
            }
          ),
          widget(
            'w-contacts-by-status',
            'By Status',
            'pieChart',
            { column: 6, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'pieChart',
              source: systemSource('contact'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('contact_status') },
              donut: true,
              showCenterTotal: true,
            }
          ),
          widget(
            'w-newest-contacts',
            'Newest Contacts',
            'recordList',
            { column: 0, row: 6, columnSpan: 12, rowSpan: 5 },
            {
              kind: 'recordList',
              source: systemSource('contact'),
              // `field_company_name` (a company def field) doesn't exist ON contact —
              // the contact→company RELATIONSHIP field (`contact_company`) is the real
              // symbolic ref for "what company is this contact at" here.
              columns: [
                fref('full_name'),
                fref('primary_email'),
                fref('contact_company'),
                fref('created_at'),
              ],
              sort: { fieldRef: fref('created_at'), desc: true },
              pageSize: 10,
            }
          ),
        ],
      },
    ],
  },
}

// ── company: "Companies Overview" ───────────────────────────────────────────

const companyDashboard: DefaultDashboardDefinition = {
  name: 'Companies Overview',
  icon: { iconId: 'building-2', color: 'blue' },
  layout: {
    globalFilters: { dateRange: 'last30d' },
    tabs: [
      {
        id: 'tab-overview',
        title: 'Overview',
        icon: null,
        widgets: [
          widget(
            'w-total-companies',
            'Total Companies',
            'kpi',
            { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('company'),
              metric: { op: 'count' },
              globalDateFieldRef: null,
            }
          ),
          widget(
            'w-new-companies',
            'New Companies',
            'kpi',
            { column: 3, row: 0, columnSpan: 3, rowSpan: 2 },
            {
              kind: 'kpi',
              source: systemSource('company'),
              metric: { op: 'count' },
              globalDateFieldRef: fref('created_at'),
              trend: { dateFieldRef: fref('created_at'), compare: 'previousPeriod' },
            }
          ),
          widget(
            'w-companies-created-trend',
            'New Companies',
            'lineChart',
            { column: 0, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'lineChart',
              source: systemSource('company'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('created_at'), dateGranularity: 'day' },
              area: true,
            }
          ),
          // `industry` (SINGLE_SELECT, systemAttribute `company_industry`) is the
          // suitable categorical field the plan asks to check for at build.
          widget(
            'w-companies-by-industry',
            'By Industry',
            'pieChart',
            { column: 6, row: 2, columnSpan: 6, rowSpan: 4 },
            {
              kind: 'pieChart',
              source: systemSource('company'),
              metric: { op: 'count' },
              groupBy: { fieldRef: fref('company_industry') },
              donut: true,
              showCenterTotal: true,
            }
          ),
          widget(
            'w-newest-companies',
            'Newest Companies',
            'recordList',
            { column: 0, row: 6, columnSpan: 12, rowSpan: 5 },
            {
              kind: 'recordList',
              source: systemSource('company'),
              columns: [fref('company_website'), fref('company_industry'), fref('created_at')],
              sort: { fieldRef: fref('created_at'), desc: true },
              pageSize: 10,
            }
          ),
        ],
      },
    ],
  },
}

/**
 * Seed targets: ticket + contact + company (README decision 6, locked). Every
 * other entity — system or custom — starts at the empty state; there is no
 * entry here for them.
 */
export const DEFAULT_DASHBOARD_CONFIGS: Partial<Record<string, DefaultDashboardDefinition>> = {
  ticket: ticketDashboard,
  contact: contactDashboard,
  company: companyDashboard,
}

// packages/lib/src/seed/default-view-configs.ts

import type { ViewConfig } from '../conditions/view-config'

/**
 * A single seeded table view definition.
 * Exactly one entry per entity must set `isDefault: true` — that view becomes
 * the org's default for the resource. The rest are seeded as shared,
 * non-default views and appear alongside the default in the view switcher.
 *
 * Authoring note: column and filter `fieldId`s use the `field_${systemAttribute}`
 * symbolic form (e.g. `field_ticket_status`). The seeder rewrites these to real
 * `ResourceFieldId`s at insert time.
 */
export type DefaultViewDefinition = {
  name: string
  description?: string
  isDefault?: boolean
  config: ViewConfig
}

/**
 * Default view configurations for system entities.
 * Each entity gets one or more views; ordering controls display order in the
 * view switcher. The first non-default view appears immediately after the default.
 */
export const DEFAULT_VIEW_CONFIGS = {
  contact: [
    {
      name: 'All Contacts',
      description: 'Default view for contacts',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_full_name: true,
          field_primary_email: true,
          field_primary_phone: true,
          field_company_name: true,
          field_tags: true,
          field_created_at: true,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_tags',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_full_name'],
        },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Active Contacts',
      description: 'Contacts with status ACTIVE — hides spam and merged',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_full_name: true,
          field_primary_email: true,
          field_primary_phone: true,
          field_company_name: true,
          field_tags: true,
          field_created_at: true,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_tags',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_full_name'],
        },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [
          {
            id: 'active-contacts-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'active-contacts-status-active',
                fieldId: 'field_contact_status',
                operator: 'is',
                value: 'ACTIVE',
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Spam',
      description: 'Contacts flagged as spam',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_full_name: true,
          field_primary_email: true,
          field_primary_phone: true,
          field_company_name: true,
          field_tags: true,
          field_created_at: true,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_tags',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_full_name'],
        },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [
          {
            id: 'spam-contacts-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'spam-contacts-status-spam',
                fieldId: 'field_contact_status',
                operator: 'is',
                value: 'SPAM',
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  ticket: [
    {
      name: 'All Tickets',
      description: 'Default view for tickets',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assignee: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assignee',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Open Tickets',
      description: 'Active work queue — anything not closed, cancelled, merged, or resolved',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assignee: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assignee',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [
          {
            id: 'open-tickets-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'open-tickets-status-not-closed',
                fieldId: 'field_ticket_status',
                operator: 'not in',
                value: ['CLOSED', 'CANCELLED', 'MERGED', 'RESOLVED'],
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Closed Tickets',
      description: 'Resolved, closed, or cancelled tickets — excludes merged noise',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assignee: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assignee',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [
          {
            id: 'closed-tickets-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'closed-tickets-status-closed',
                fieldId: 'field_ticket_status',
                operator: 'in',
                value: ['CLOSED', 'RESOLVED', 'CANCELLED'],
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'High Priority',
      description: 'High and urgent priority tickets — fast triage view',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assignee: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assignee',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [
          {
            id: 'high-priority-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'high-priority-priority-in',
                fieldId: 'field_ticket_priority',
                operator: 'in',
                value: ['HIGH', 'URGENT'],
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  part: [
    {
      name: 'All Parts',
      description: 'Default view for parts',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_part_title: true,
          field_part_sku: true,
          field_part_description: true,
          field_part_quantity_available: true,
          field_part_unit_cost: true,
          field_created_at: true,
          // Hide many-to-many relationship columns — managed via drawer tabs, not the table
          field_part_vendor_parts: false,
          field_part_subparts: false,
          field_part_used_in_assemblies: false,
        },
        columnOrder: [
          'field_part_sku',
          'field_part_title',
          'field_part_description',
          'field_part_quantity_available',
          'field_part_unit_cost',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_part_sku', 'field_part_title'],
        },
        sorting: [{ id: 'field_part_sku', desc: false }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Low Stock',
      description: 'Parts at or below reorder point — needs purchasing attention',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_part_title: true,
          field_part_sku: true,
          field_part_description: true,
          field_part_quantity_available: true,
          field_part_unit_cost: true,
          field_created_at: true,
          field_part_vendor_parts: false,
          field_part_subparts: false,
          field_part_used_in_assemblies: false,
        },
        columnOrder: [
          'field_part_sku',
          'field_part_title',
          'field_part_description',
          'field_part_quantity_available',
          'field_part_unit_cost',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_part_sku', 'field_part_title'],
        },
        sorting: [{ id: 'field_part_sku', desc: false }],
        filters: [
          {
            id: 'low-stock-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'low-stock-status-in',
                fieldId: 'field_part_stock_status',
                operator: 'in',
                value: ['low_stock', 'out_of_stock'],
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Out of Stock',
      description: 'Critical purchasing view — parts with zero quantity on hand',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_part_title: true,
          field_part_sku: true,
          field_part_description: true,
          field_part_quantity_available: true,
          field_part_unit_cost: true,
          field_created_at: true,
          field_part_vendor_parts: false,
          field_part_subparts: false,
          field_part_used_in_assemblies: false,
        },
        columnOrder: [
          'field_part_sku',
          'field_part_title',
          'field_part_description',
          'field_part_quantity_available',
          'field_part_unit_cost',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_part_sku', 'field_part_title'],
        },
        sorting: [{ id: 'field_part_sku', desc: false }],
        filters: [
          {
            id: 'out-of-stock-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'out-of-stock-status-out',
                fieldId: 'field_part_stock_status',
                operator: 'is',
                value: 'out_of_stock',
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'In Stock',
      description: 'Parts with healthy inventory — what we can ship today',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_part_title: true,
          field_part_sku: true,
          field_part_description: true,
          field_part_quantity_available: true,
          field_part_unit_cost: true,
          field_created_at: true,
          field_part_vendor_parts: false,
          field_part_subparts: false,
          field_part_used_in_assemblies: false,
        },
        columnOrder: [
          'field_part_sku',
          'field_part_title',
          'field_part_description',
          'field_part_quantity_available',
          'field_part_unit_cost',
          'field_created_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_part_sku', 'field_part_title'],
        },
        sorting: [{ id: 'field_part_sku', desc: false }],
        filters: [
          {
            id: 'in-stock-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'in-stock-status-in',
                fieldId: 'field_part_stock_status',
                operator: 'is',
                value: 'in_stock',
                isConstant: true,
              },
            ],
          },
        ],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  meeting: [
    {
      name: 'All Meetings',
      description: 'Default view for meetings',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_meeting_title: true,
          field_meeting_date_time: true,
          field_meeting_type: true,
          field_meeting_company: true,
          field_meeting_contact: true,
          field_meeting_recording_url: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_meeting_title',
          'field_meeting_date_time',
          'field_meeting_type',
          'field_meeting_company',
          'field_meeting_contact',
          'field_meeting_recording_url',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_meeting_title'],
        },
        sorting: [{ id: 'field_meeting_date_time', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],
} as const satisfies Record<string, DefaultViewDefinition[]>

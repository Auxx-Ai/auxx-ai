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
          field_city: true,
          field_tags: true,
          field_created_at: true,
          // Geo fields — visible via column chooser but off by default to keep
          // the table compact. City is the high-signal field; the rest clutter.
          field_region: false,
          field_country: false,
          field_timezone: false,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_city',
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
          field_city: true,
          field_tags: true,
          field_created_at: true,
          field_region: false,
          field_country: false,
          field_timezone: false,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_city',
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
          field_city: true,
          field_tags: true,
          field_created_at: true,
          field_region: false,
          field_country: false,
          field_timezone: false,
        },
        columnOrder: [
          'field_full_name',
          'field_primary_email',
          'field_primary_phone',
          'field_company_name',
          'field_city',
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
      name: 'My Tickets',
      description: 'Tickets assigned to you — resolved per-viewer via currentUser',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assigned_to_id: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assigned_to_id',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [
          {
            id: 'my-tickets-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'my-tickets-assignee',
                fieldId: 'field_assigned_to_id',
                operator: 'is',
                value: undefined as unknown as string,
                valueSource: 'currentUser',
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
      name: 'My Open Tickets',
      description: 'Your active work queue — assigned to you and not closed',
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_ticket_title: true,
          field_ticket_number: true,
          field_ticket_status: true,
          field_ticket_priority: true,
          field_assigned_to_id: true,
          field_contact: true,
          field_created_at: true,
          field_updated_at: true,
        },
        columnOrder: [
          'field_ticket_number',
          'field_ticket_title',
          'field_ticket_status',
          'field_ticket_priority',
          'field_assigned_to_id',
          'field_contact',
          'field_updated_at',
        ],
        columnPinning: {
          left: ['_checkbox', 'field_ticket_number', 'field_ticket_title'],
        },
        sorting: [{ id: 'field_updated_at', desc: true }],
        filters: [
          {
            id: 'my-open-tickets-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'my-open-tickets-assignee',
                fieldId: 'field_assigned_to_id',
                operator: 'is',
                value: undefined as unknown as string,
                valueSource: 'currentUser',
              },
              {
                id: 'my-open-tickets-status-not-closed',
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

  work_order: [
    {
      name: 'All Work Orders',
      description: 'Default view for work orders',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_work_order_number: true,
          field_work_order_title: true,
          field_work_order_status: true,
          field_work_order_priority: true,
          field_work_order_job_type: true,
          field_work_order_contact: true,
          field_work_order_scheduled_start: true,
          field_work_order_assignee: true,
        },
        columnOrder: [
          'field_work_order_number',
          'field_work_order_title',
          'field_work_order_status',
          'field_work_order_priority',
          'field_work_order_job_type',
          'field_work_order_contact',
          'field_work_order_scheduled_start',
          'field_work_order_assignee',
        ],
        columnPinning: { left: ['_checkbox', 'field_work_order_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  service_request: [
    {
      // Kanban-by-status default (coordinator decision, 2026-07-09) — the request pipeline
      // reads naturally as a board (new → contacted → quoted → approved → converted, +
      // lost/canceled), and the M1 status set is small/stable enough to seed columns for.
      name: 'Request Pipeline',
      description: 'Default view for service requests, grouped by status',
      isDefault: true,
      config: {
        viewType: 'kanban' as const,
        kanban: {
          groupByFieldId: 'field_service_request_status',
          primaryFieldId: 'field_service_request_title',
          cardFields: [
            'field_service_request_number',
            'field_service_request_contact',
            'field_service_request_property_type',
            'field_service_request_preferred_date',
            'field_service_request_arrival_window',
          ],
          // ⚠️ VERIFY AT BUILD: kanbanConfigSchema.columnOrder is keyed by the groupBy field's
          // OPTION VALUES, not field ids (unlike every other columnOrder in this file) —
          // confirm against packages/lib/src/conditions/view-config.ts:69-75 and the kanban
          // board component before shipping. If confirmed, these are the
          // SERVICE_REQUEST_STATUS_OPTIONS values in pipeline order:
          columnOrder: ['new', 'contacted', 'quoted', 'approved', 'converted', 'lost', 'canceled'],
        },
        // Standard table-shape fields ship alongside `kanban` so the view still works when a
        // user flips it to table mode (same ViewConfig object serves both view types).
        columnVisibility: {
          field_service_request_number: true,
          field_service_request_title: true,
          field_service_request_status: true,
          field_service_request_contact: true,
          field_service_request_preferred_date: true,
          field_service_request_arrival_window: true,
        },
        columnOrder: [
          'field_service_request_number',
          'field_service_request_title',
          'field_service_request_status',
          'field_service_request_contact',
          'field_service_request_preferred_date',
          'field_service_request_arrival_window',
        ],
        columnPinning: { left: ['_checkbox', 'field_service_request_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'All Requests',
      description: 'Table view of all service requests',
      isDefault: false,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_service_request_number: true,
          field_service_request_title: true,
          field_service_request_status: true,
          field_service_request_property_type: true,
          field_service_request_contact: true,
          field_service_request_preferred_date: true,
          field_service_request_arrival_window: true,
        },
        columnOrder: [
          'field_service_request_number',
          'field_service_request_title',
          'field_service_request_status',
          'field_service_request_property_type',
          'field_service_request_contact',
          'field_service_request_preferred_date',
          'field_service_request_arrival_window',
        ],
        columnPinning: { left: ['_checkbox', 'field_service_request_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  quote: [
    {
      name: 'Quote Pipeline',
      description: 'Default view for quotes, grouped by status',
      isDefault: true,
      config: {
        viewType: 'kanban' as const,
        kanban: {
          groupByFieldId: 'field_quote_status',
          primaryFieldId: 'field_quote_title',
          cardFields: [
            'field_quote_number',
            'field_quote_contact',
            'field_quote_total',
            'field_quote_valid_until',
          ],
          // Keyed by QUOTE_STATUS_OPTIONS values, not field ids (the M1 kanban gotcha —
          // see service_request's Request Pipeline view above).
          columnOrder: ['draft', 'sent', 'approved', 'declined', 'canceled'],
        },
        // Standard table-shape fields ship alongside `kanban` so the view still works when a
        // user flips it to table mode (same ViewConfig object serves both view types).
        columnVisibility: {
          field_quote_number: true,
          field_quote_title: true,
          field_quote_status: true,
          field_quote_contact: true,
          field_quote_total: true,
          field_quote_valid_until: true,
        },
        columnOrder: [
          'field_quote_number',
          'field_quote_title',
          'field_quote_status',
          'field_quote_contact',
          'field_quote_total',
          'field_quote_valid_until',
        ],
        columnPinning: { left: ['_checkbox', 'field_quote_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'All Quotes',
      description: 'Table view of all quotes',
      isDefault: false,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_quote_number: true,
          field_quote_title: true,
          field_quote_status: true,
          field_quote_contact: true,
          field_quote_total: true,
          field_quote_valid_until: true,
        },
        columnOrder: [
          'field_quote_number',
          'field_quote_title',
          'field_quote_status',
          'field_quote_contact',
          'field_quote_total',
          'field_quote_valid_until',
        ],
        columnPinning: { left: ['_checkbox', 'field_quote_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
  ],

  // Invoices are a ledger, not a pipeline (01-ui #9) — table default, no kanban.
  invoice: [
    {
      name: 'All Invoices',
      description: 'Default view for invoices',
      isDefault: true,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_invoice_number: true,
          field_invoice_contact: true,
          field_invoice_status: true,
          field_invoice_total: true,
          field_invoice_balance: true,
          field_invoice_due_date: true,
        },
        columnOrder: [
          'field_invoice_number',
          'field_invoice_contact',
          'field_invoice_status',
          'field_invoice_total',
          'field_invoice_balance',
          'field_invoice_due_date',
        ],
        columnPinning: { left: ['_checkbox', 'field_invoice_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [],
        columnSizing: {},
        columnLabels: {},
        columnFormatting: {},
      } satisfies ViewConfig,
    },
    {
      name: 'Outstanding',
      description: 'Sent and partially paid invoices awaiting the rest of their balance',
      isDefault: false,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_invoice_number: true,
          field_invoice_contact: true,
          field_invoice_status: true,
          field_invoice_total: true,
          field_invoice_balance: true,
          field_invoice_due_date: true,
        },
        columnOrder: [
          'field_invoice_number',
          'field_invoice_contact',
          'field_invoice_status',
          'field_invoice_total',
          'field_invoice_balance',
          'field_invoice_due_date',
        ],
        columnPinning: { left: ['_checkbox', 'field_invoice_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [
          {
            id: 'outstanding-invoices-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'outstanding-invoices-status',
                fieldId: 'field_invoice_status',
                operator: 'in',
                value: ['sent', 'partially_paid'],
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
      name: 'Drafts',
      description: 'Draft invoices awaiting review before they are sent (money MI2)',
      isDefault: false,
      config: {
        viewType: 'table' as const,
        columnVisibility: {
          field_invoice_number: true,
          field_invoice_contact: true,
          field_invoice_status: true,
          field_invoice_total: true,
          field_invoice_balance: true,
          field_invoice_due_date: true,
        },
        columnOrder: [
          'field_invoice_number',
          'field_invoice_contact',
          'field_invoice_status',
          'field_invoice_total',
          'field_invoice_balance',
          'field_invoice_due_date',
        ],
        columnPinning: { left: ['_checkbox', 'field_invoice_number'] },
        sorting: [{ id: 'field_created_at', desc: true }],
        filters: [
          {
            id: 'draft-invoices-group',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'draft-invoices-status',
                fieldId: 'field_invoice_status',
                operator: 'in',
                value: ['draft'],
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
} as const satisfies Record<string, DefaultViewDefinition[]>

// packages/lib/src/seed/default-view-configs.ts

import type { ViewConfig } from '../conditions/view-config'

/**
 * Default view configurations for system entities
 * These define which columns should be visible by default
 */
export const DEFAULT_VIEW_CONFIGS = {
  contact: {
    name: 'All Contacts',
    description: 'Default view for contacts',
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
      sorting: [
        {
          id: 'field_created_at',
          desc: true,
        },
      ],
      filters: [],
      columnSizing: {},
      columnLabels: {},
      columnFormatting: {},
    } satisfies ViewConfig,
  },

  ticket: {
    name: 'All Tickets',
    description: 'Default view for tickets',
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
      sorting: [
        {
          id: 'field_updated_at',
          desc: true,
        },
      ],
      filters: [],
      columnSizing: {},
      columnLabels: {},
      columnFormatting: {},
    } satisfies ViewConfig,
  },

  part: {
    name: 'All Parts',
    description: 'Default view for parts',
    config: {
      viewType: 'table' as const,
      columnVisibility: {
        field_part_title: true,
        field_part_sku: true,
        field_part_description: true,
        field_part_quantity_available: true,
        field_part_unit_cost: true,
        field_created_at: true,
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
      sorting: [
        {
          id: 'field_part_sku',
          desc: false,
        },
      ],
      filters: [],
      columnSizing: {},
      columnLabels: {},
      columnFormatting: {},
    } satisfies ViewConfig,
  },
} as const

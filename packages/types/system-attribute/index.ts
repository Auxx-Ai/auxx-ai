// packages/types/system-attribute/index.ts

/**
 * All system attribute identifiers used across resource field definitions.
 * Grouped by resource for readability. Add new entries here when creating
 * new system fields — TypeScript will enforce usage at compile time.
 */
export const SYSTEM_ATTRIBUTES = [
  // ─── Universal fields ───────────────────────────────────────────
  'id',
  'created_at',
  'updated_at',
  'created_by_id',
  'record_id',

  // ─── Contact fields ─────────────────────────────────────────────
  'first_name',
  'last_name',
  'full_name',
  'contact_avatar',
  'primary_email',
  'phone',
  'job_title',
  'city',
  'region',
  'country',
  'timezone',
  'contact_status',
  'customer_groups',
  'notes',
  'contact_tickets',

  // ─── Ticket fields ──────────────────────────────────────────────
  'ticket_title',
  'ticket_description',
  'ticket_status',
  'ticket_number',
  'ticket_priority',
  'ticket_type',
  'due_date',
  'assigned_to_id',
  'ticket_contact',
  'parent_ticket_id',
  'ticket_child_tickets',
  'ticket_work_orders',
  'ticket_service_requests',

  // ─── Thread fields ──────────────────────────────────────────────
  'subject',
  'body',
  'from',
  'to',
  'sent',
  'thread_status',
  'read_status',
  'has_attachments',
  'has_draft',
  'first_message_at',
  'last_message_at',
  'message_count',
  'external_id',
  'free_text',
  'closed_at',
  'inbox_id',
  'assignee_id',
  'thread_tags',
  'thread_messages',
  'thread_ticket',
  // Chat visit facts (FieldValue-backed, keyed by thread.id)
  'visit_ip',
  'visit_user_agent',
  'visit_referrer',
  'visit_url',
  'visit_city',
  'visit_region',
  'visit_country',
  'visit_timezone',

  // ─── Tag fields ─────────────────────────────────────────────────
  'name',
  'title',
  'tag_color',
  'tag_emoji',
  'tag_description',
  'is_system_tag',
  'tag_parent',
  'tag_children',
  'tag_threads',
  'tag_articles',
  'tag_is_public',
  'tag_scope',

  // ─── Article fields ─────────────────────────────────────────────
  'article_title',
  'article_slug',
  'article_excerpt',
  'article_emoji',
  'article_color',
  'article_archived_at',
  'article_is_published',
  'article_has_unpublished_changes',
  'article_status',
  'article_kind',
  'article_kb',
  'article_parent',
  'article_children',
  'article_published_at',
  'article_views_count',
  'article_tags',

  // ─── Part fields ────────────────────────────────────────────────
  'part_title',
  'part_description',
  'part_sku',
  'category',
  'part_unit_price',
  'part_cost',
  'hs_code',
  'part_vendor_parts',
  'part_subparts',
  'part_used_in_assemblies',
  'part_catalog_items', // inverse of catalog_item_part

  // ─── Vendor Part fields ────────────────────────────────────────
  'vendor_part_part',
  'vendor_part_contact',
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_shipping_cost',
  'vendor_part_tariff_rate',
  'vendor_part_other_cost',
  'vendor_part_lead_time',
  'vendor_part_min_order_qty',
  'vendor_part_is_preferred',

  // ─── Subpart fields ────────────────────────────────────────────
  'subpart_parent_part',
  'subpart_child_part',
  'subpart_quantity',
  'subpart_notes',

  // ─── Stock Movement fields ─────────────────────────────────────
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_reason',
  'stock_movement_reference',
  'stock_movement_adjust_subparts',
  'stock_movement_parent_movement',
  'stock_movement_child_movements',

  // ─── Part inventory fields ────────────────────────────────────
  'part_quantity_on_hand',
  'part_stock_status',
  'part_reorder_point',
  'part_reorder_qty',
  'part_stock_movements',

  // ─── Contact inverse fields ────────────────────────────────────
  'contact_vendor_parts',
  'contact_company',
  'contact_employer',
  'contact_meetings',
  'contact_work_orders',
  'contact_service_requests',
  'contact_quotes',
  'contact_invoices', // inverse of invoice_contact

  // ─── Company fields ────────────────────────────────────────────
  'company_name',
  'company_logo',
  'company_website',
  'company_domain',
  'company_industry',
  'company_size',
  'company_annual_revenue',
  'company_founded',
  'company_headquarters',
  'company_notes',
  'company_primary_contact',
  'company_employees',
  'company_vendor_parts',
  'company_meetings',
  'company_work_orders',
  'company_enriched_at',
  'company_enrichment_status',

  // ─── Meeting fields ────────────────────────────────────────────
  'meeting_title',
  'meeting_type',
  'meeting_date_time',
  'meeting_duration_minutes',
  'meeting_location',
  'meeting_url',
  'meeting_organizer',
  'meeting_agenda',
  'meeting_notes',
  'meeting_action_items',
  'meeting_recording_url',
  'meeting_company',
  'meeting_contact',

  // ─── Work Order fields ─────────────────────────────────────────
  'work_order_number',
  'work_order_title',
  'work_order_description',
  'work_order_status',
  'work_order_priority',
  'work_order_job_type',
  'work_order_contact',
  'work_order_company',
  'work_order_address',
  'work_order_ticket',
  'work_order_request',
  'work_order_scheduled_start',
  'work_order_scheduled_end',
  'work_order_assignee',
  'work_order_completion_notes',
  'work_order_pricing_model',
  'work_order_invoice_timing',
  'work_order_quote', // owning — belongs_to quote (converted-from)
  'work_order_line_items', // inverse of line_item_work_order
  'work_order_invoices', // inverse of invoice_work_order
  'work_order_tags', // free-form TAGS — route planner regions (plans/dispatch/09-route-planner.md)

  // ─── Service Request fields ────────────────────────────────────
  'service_request_number',
  'service_request_title',
  'service_request_description',
  'service_request_property_type',
  'service_request_preferred_date',
  'service_request_alternate_date',
  'service_request_arrival_window',
  'service_request_contact',
  'service_request_address',
  'service_request_ticket',
  'service_request_status',
  'service_request_work_orders', // inverse of work_order_request — lives ON service_request
  'service_request_quotes', // inverse of quote_request

  // ─── Quote fields ─────────────────────────────────────────────
  'quote_number',
  'quote_title',
  'quote_status',
  'quote_contact',
  'quote_request',
  'quote_valid_until',
  'quote_pricing_model',
  'quote_invoice_timing',
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_name',
  'quote_tax_rate',
  'quote_subtotal',
  'quote_tax_total',
  'quote_total',
  'quote_notes',
  'quote_terms',
  'quote_line_items', // inverse of line_item_quote
  'quote_work_orders', // inverse of work_order_quote

  // ─── Line Item fields ──────────────────────────────────────────
  'line_item_name',
  'line_item_description',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_category',
  'line_item_discount',
  'line_item_sort_order',
  'line_item_visit_id',
  'line_item_catalog_item',
  'line_item_quote',
  'line_item_work_order',
  'line_item_invoice',
  'line_item_source_line_id',

  // ─── Catalog Item fields ────────────────────────────────────────
  'catalog_item_name',
  'catalog_item_description',
  'catalog_item_category',
  'catalog_item_default_unit_price',
  'catalog_item_taxable',
  'catalog_item_active',
  'catalog_item_part',
  'catalog_item_line_items', // inverse of line_item_catalog_item

  // ─── Catalog Group fields ───────────────────────────────────────
  'catalog_group_name',
  'catalog_group_description',
  'catalog_group_entries',
  'catalog_group_tax_rate_id',
  'catalog_group_discount_type',
  'catalog_group_discount_value',
  'catalog_group_active',

  // ─── Invoice fields ─────────────────────────────────────────────
  'invoice_number',
  'invoice_status',
  'invoice_contact',
  'invoice_work_order',
  'invoice_issued_at',
  'invoice_due_date',
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_name',
  'invoice_tax_rate',
  'invoice_subtotal',
  'invoice_tax_total',
  'invoice_total',
  'invoice_amount_paid',
  'invoice_balance',
  'invoice_notes',
  'invoice_terms',
  'invoice_pdf_asset',
  'invoice_visit_id',
  'invoice_public_token',
  'invoice_line_items', // inverse of line_item_invoice
  'invoice_payments', // inverse of payment_invoice

  // ─── Payment fields ─────────────────────────────────────────────
  'payment_amount',
  'payment_date',
  'payment_method',
  'payment_reference',
  'payment_note',
  'payment_invoice',
  'payment_transaction_id',

  // ─── Inbox fields ───────────────────────────────────────────────
  'inbox_name',
  'inbox_description',
  'inbox_color',
  'inbox_status',
  'inbox_default_lens',
  'inbox_is_personal',
  'inbox_owner_user_id',
  'inbox_settings',

  // ─── Signature fields ───────────────────────────────────────────
  'signature_name',
  'signature_body',
  'signature_is_default',
  'signature_visibility',
] as const

/** Union type of all valid system attribute identifiers */
export type SystemAttribute = (typeof SYSTEM_ATTRIBUTES)[number]

const SYSTEM_ATTRIBUTE_SET: ReadonlySet<string> = new Set(SYSTEM_ATTRIBUTES)

/** Runtime type guard — narrows string to SystemAttribute */
export function isSystemAttribute(value: string): value is SystemAttribute {
  return SYSTEM_ATTRIBUTE_SET.has(value)
}

/** Asserts and returns typed SystemAttribute, throws if invalid */
export function toSystemAttribute(value: string): SystemAttribute {
  if (!isSystemAttribute(value)) {
    throw new Error(`Invalid system attribute: "${value}"`)
  }
  return value
}

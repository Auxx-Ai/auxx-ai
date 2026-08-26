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
  // Column-backed interaction stamps (contact + company registries)
  'first_interaction_at',
  'last_interaction_at',

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
  'tag_ai_classify',
  'tag_template_key',

  // ─── KB fields ──────────────────────────────────────────────────
  'kb_name',
  'kb_slug',
  'kb_description',
  'kb_publish_status',
  'kb_visibility',
  'kb_articles',
  'kb_published_at',
  'kb_last_published_at',

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
  'part_image',
  'part_sku',
  'category',
  'part_kind',
  // Cost provenance. `part_cost` keeps its meaning (replacement cost — the
  // current landed cost from live vendor prices); the two below name the
  // numbers it chooses BETWEEN, and `part_cost_source` says which one won.
  // `part_unit_price` was removed here: it exposed 1 of the 4 landed-cost
  // components, had no reader, and collided with Shopify's variant price —
  // which lands in an app field instead.
  'part_purchase_cost',
  'part_rollup_cost',
  'part_cost_source',
  'part_cost',
  'hs_code',
  'part_vendor_parts',
  'part_subparts',
  'part_used_in_assemblies',
  'part_catalog_items', // inverse of catalog_item_part
  'part_product', // belongs_to product; inverse is product_parts

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
  'part_line_items', // inverse of line_item_part
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
  'contact_orders', // inverse of order_contact
  'contact_balance_due',
  'contact_uninvoiced_amount',
  'contact_billing_revision',

  // ─── Company fields ────────────────────────────────────────────
  'company_name',
  'company_logo',
  'company_website',
  'company_domain',
  'company_x_follower_count',
  'company_industry',
  'company_size',
  'company_annual_revenue',
  'company_funding_raised',
  'company_founded',
  'company_headquarters',
  'company_notes',
  'company_primary_contact',
  'company_employees',
  'company_vendor_parts',
  'company_meetings',
  'company_work_orders',
  'company_products', // inverse of product_vendor
  'company_orders', // inverse of order_company
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
  'work_order_billing_state',
  'work_order_billing_amount',
  'work_order_amount_drafted',
  'work_order_amount_invoiced',
  'work_order_uninvoiced_amount',
  'work_order_balance_due',
  'work_order_invoice_count',
  'work_order_next_invoice_date',
  'work_order_billing_revision',
  'work_order_quote', // owning — belongs_to quote (converted-from)
  'work_order_order', // owning — belongs_to order; inverse is order_work_orders
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
  'quote_pdf_asset',
  'quote_line_items', // inverse of line_item_quote
  'quote_work_orders', // inverse of work_order_quote
  'quote_public_token',
  'quote_accepted_by_name',
  'quote_accepted_at',
  'quote_decline_reason',
  'quote_deposit_type',
  'quote_deposit_value',
  'quote_photos', // scouting/quote photos gallery (plan 37b §1)

  // ─── Line Item fields ──────────────────────────────────────────
  'line_item_name',
  'line_item_description',
  'line_item_qty',
  'line_item_unit',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_optional',
  'line_item_optional_selected',
  'line_item_category',
  'line_item_discount',
  'line_item_sort_order',
  'line_item_visit_id',
  'line_item_source_line',
  'line_item_catalog_item',
  'line_item_quote',
  'line_item_work_order',
  'line_item_invoice',
  'line_item_order',
  'line_item_part', // stamped from the line's catalog item, not hand-set (08 §6.2)
  'line_item_photos', // scouting/line-level photos (plan 37b §1)

  // ─── Catalog Item fields ────────────────────────────────────────
  'catalog_item_name',
  'catalog_item_description',
  'catalog_item_category',
  'catalog_item_default_unit_price',
  'catalog_item_default_unit',
  'catalog_item_taxable',
  'catalog_item_active',
  'catalog_item_part',
  'catalog_item_cost',
  'catalog_item_markup',
  'catalog_item_line_items', // inverse of line_item_catalog_item

  // ─── Product fields ─────────────────────────────────────────────
  // The family above `part` (plans/products/01-product-family.md §1).
  // `tags` reuses the shared open-tag `category` attribute from the part
  // block, not a new one.
  'product_title',
  'product_description',
  'product_image',
  'product_vendor', // belongs_to company; inverse is company_products
  'product_type',
  'product_handle',
  'product_status',
  'product_parts', // inverse of part_product

  // ─── GL Posting fields ──────────────────────────────────────────
  // One summary journal entry pushed to the general ledger
  // (plans/auxx-lift/gap-b-quickbooks-journal-entry.md §6.2). The external
  // QuickBooks id is NOT here — it is an app-owned identity field declared in
  // the QuickBooks app's fields.ts, so it goes away with the connection.
  'gl_posting_doc_number',
  'gl_posting_posting_type',
  'gl_posting_period_key',
  'gl_posting_status',
  'gl_posting_total_debit',
  'gl_posting_posted_at',
  'gl_posting_failure_reason',

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
  'invoice_billing_kind',
  'invoice_service_period_start',
  'invoice_service_period_end',
  'invoice_visit_count',
  'invoice_progress_percent',
  'invoice_installment_name',
  'invoice_public_token',
  'invoice_photos', // scouting/invoice photos gallery, parity with quote_photos (plan 37b §1)
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

  // ─── Order fields ───────────────────────────────────────────────
  // The third TOTALLED money document beside quote and invoice
  // (plans/products/08-order-build.md §2). An order records what was SOLD, as
  // distinct from `work_order`, which records what was done. `tags` reuses the
  // shared open-tag `category` attribute, not a new one.
  'order_number',
  'order_contact',
  'order_company',
  'order_placed_at',
  'order_financial_status',
  'order_fulfillment_status',
  'order_channel', // human-set, never derived (08 §4, D18)
  'order_payment_gateways',
  'order_currency',
  'order_shipping_address',
  'order_subtotal',
  'order_discount_type',
  'order_discount_value',
  'order_tax_name',
  'order_tax_rate',
  'order_tax_total',
  'order_total',
  'order_line_items', // inverse of line_item_order
  'order_work_orders', // inverse of work_order_order

  // ─── Inbox fields ───────────────────────────────────────────────
  'inbox_name',
  'inbox_description',
  'inbox_color',
  'inbox_status',
  // RETIRED as live fields by plan 40 phase 4 (entity migration 062 drops the
  // `CustomField` rows), but they MUST stay in this union: entity migrations
  // 025 and 026 carry frozen `satisfies ResourceField` specs for them, and
  // `ResourceField.systemAttribute` is typed as `SystemAttribute`. Removing
  // these two breaks those migrations at compile time — and they still have to
  // materialize the fields for an org that has not reached 060/062 yet.
  //
  // This is the OPPOSITE of the `signature_*` precedent below, where 021 edited
  // the retired fields out of history so no `ResourceField` named them any more.
  // That was not available here: 060 READS both attributes to decide what to
  // move and which floors to project onto rows.
  'inbox_default_lens',
  'inbox_is_personal',
  'inbox_owner_user_id',
  'inbox_settings',

  // ─── Signature fields ───────────────────────────────────────────
  // `signature_is_default` and `signature_visibility` were removed by plan 36
  // (entity migration 057): visibility is now `ResourceAccess` rows, and the
  // default signature is a per-user `UserSetting` (`signature.defaultId`).
  // Migrations 021/056/057 still name those strings, but only as raw
  // `CustomField.systemAttribute` (a `text` column) literals — not as
  // `SystemAttribute` values.
  'signature_name',
  'signature_body',
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

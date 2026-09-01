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
  // The stock unit of measure every quantity recorded for the part is in
  // (on-hand, movements, BOM, ordered/received). Deliberately on the part and
  // not on a purchasing line — see `PART_FIELDS.unit`.
  'part_unit',
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
  'contact_purchase_orders', // inverse of purchase_order_contact — the BUY side
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

  // ─── Receiving: cost, date and provenance on stock_movement ──────
  // plans/purchasing/01-build-plan.md §2. Every one of these is
  // `updatable: false` — the ledger is append-only by construction, which is
  // the only reason a frozen cost can be trusted.
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_cost_basis',
  // 🛑 An account ROLE ('inventory_raw_materials'), NOT a code and never a
  // provider id. `P2` keeps provider ids out of the ledger; `G8` keeps ORG
  // NUMBERING out of it too, because `G7` makes the chart an editable
  // default. A movement is append-only and frozen at write time, so a code
  // stamped here is silently reinterpreted the day the org renumbers — and
  // the posting still balances, so nothing downstream can detect it.
  // `resolveInventoryRoleForPartKind` is the only writer;
  // `buildReceiptEntry` is the reader (`inventoryAccountRole`).
  'stock_movement_gl_account',
  'stock_movement_occurred_at', // the ACCOUNTING date; createdAt is when it was typed
  'stock_movement_vendor_part',
  'stock_movement_vendor_unit_price', // raw invoice price, before landed adders
  'stock_movement_purchase_order_line',
  'stock_movement_reverses_movement', // NOT parentMovement — that means BOM explosion
  'stock_movement_reversed_by_movements',
  'vendor_part_stock_movements', // inverse of stock_movement_vendor_part

  // ─── Purchase order ─────────────────────────────────────────────
  // plans/purchasing/01-build-plan.md §4. The header's shipping/tax/discount
  // totals plus allocationBasis + taxRecoverable are exactly
  // `allocateLandedCost`'s argument list — which is why no separate
  // `goods_receipt` header is needed.
  'purchase_order_number',
  'purchase_order_vendor',
  // The ADDRESSEE. `purchase_order_vendor` targets a `company`, and a company
  // carries no email of its own, so without this there is nobody to send the
  // order to. Mirrors `quote_contact` / `invoice_contact`.
  'purchase_order_contact',
  'purchase_order_status',
  // The two DERIVED axes the single `purchase_order_status` could not express
  // (plans/purchasing/07-purchase-order-send-and-status.md §3.3): receiving and
  // billing move independently — a prepaid order is fully billed with nothing
  // received — so each gets its own field, written by the line roll-up.
  'purchase_order_receipt_status',
  'purchase_order_billing_status',
  'purchase_order_ordered_at',
  'purchase_order_expected_at',
  'purchase_order_terms',
  'purchase_order_currency',
  'purchase_order_reference',
  'purchase_order_ship_to',
  'purchase_order_subtotal',
  'purchase_order_shipping_total',
  'purchase_order_tax_total',
  'purchase_order_discount_value',
  'purchase_order_total',
  'purchase_order_allocation_basis',
  'purchase_order_tax_recoverable',
  'purchase_order_notes',
  'purchase_order_pdf_asset', // FILE — the generated PO PDF, written only by ensureDocumentPdf
  'purchase_order_attachments', // FILE, multi — vendor confirmations, drawings, signed terms
  'purchase_order_lines', // inverse of purchase_order_line_purchase_order
  'purchase_order_bills', // inverse of vendor_bill_purchase_order
  'company_purchase_orders', // inverse of purchase_order_vendor

  // ─── Purchase order line ────────────────────────────────────────
  // `quantity_received` and `quantity_billed` are COMPUTED re-sums over the
  // rows that point here, never typed — same shape as part_quantity_on_hand,
  // and for the same reason.
  'purchase_order_line_purchase_order',
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_line_total',
  'purchase_order_line_weight',
  'purchase_order_line_sort_order',
  'purchase_order_line_stock_movements',
  'purchase_order_line_vendor_bill_lines',
  'part_purchase_order_lines', // inverse of purchase_order_line_part
  'vendor_part_purchase_order_lines', // inverse of purchase_order_line_vendor_part

  // ─── Vendor bill ────────────────────────────────────────────────
  // The third leg of three-way match. `number` is the VENDOR's invoice number
  // (their document); `internal_number` is ours.
  'vendor_bill_number',
  'vendor_bill_internal_number',
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
  'vendor_bill_status',
  'vendor_bill_billed_at',
  'vendor_bill_due_at',
  'vendor_bill_currency',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
  'vendor_bill_total',
  'vendor_bill_match_variance',
  'vendor_bill_match_notes',
  'vendor_bill_document', // FILE — the vendor's invoice as received; the phase-2 parse target
  'vendor_bill_attachments', // FILE, multi — packing slips, freight invoices, photos
  'vendor_bill_lines',
  // Payment (P12): the same six fields in both modes. What differs is who
  // writes them and whether relieving A/P is our job.
  'vendor_bill_paid_at',
  'vendor_bill_amount_paid',
  'vendor_bill_balance',
  'vendor_bill_payment_method',
  'vendor_bill_payment_reference',
  'vendor_bill_paid_source', // manual | provider | bank_import | rule — never dropped
  'vendor_bill_payment_allocations',
  'company_vendor_bills', // inverse of vendor_bill_vendor

  // ─── Vendor bill line ───────────────────────────────────────────
  'vendor_bill_line_vendor_bill',
  'vendor_bill_line_purchase_order_line', // the match key
  'vendor_bill_line_part',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price', // a BUY price
  'vendor_bill_line_line_total',
  // A CODE ('2160'), and deliberately NOT a role like
  // `stock_movement_gl_account`. This is the bookkeeper's own coding of a
  // bill line against THEIR chart, and most of a chart carries no auxx role
  // at all (16 of the 28 seeded accounts have none) — so a role here would
  // make the majority of an org's accounts uncodeable. It is typed by a
  // human and stays `updatable: true`, which is the other half of the
  // difference: nothing about it is frozen history.
  'vendor_bill_line_gl_account',
  'vendor_bill_line_sort_order',
  'part_vendor_bill_lines', // inverse of vendor_bill_line_part

  // ─── Vendor payment + allocation ────────────────────────────────
  // P13/P15: seeded, hidden and INERT. Nothing writes these until the write
  // path is built; a def with zero rows can be reshaped for free.
  'vendor_payment_vendor',
  'vendor_payment_amount',
  'vendor_payment_paid_at',
  'vendor_payment_method',
  'vendor_payment_reference',
  'vendor_payment_note',
  'vendor_payment_status',
  'vendor_payment_bank_transaction_id',
  'vendor_payment_cleared_at',
  'vendor_payment_reconciled_at',
  'vendor_payment_unallocated', // amount - SUM(allocations); non-zero = a vendor credit
  'vendor_payment_allocations',
  'vendor_payment_allocation_payment',
  'vendor_payment_allocation_vendor_bill',
  'vendor_payment_allocation_amount',
  'company_vendor_payments', // inverse of vendor_payment_vendor

  // ─── GL account (the chart) ─────────────────────────────────────
  // P1/P2: the ledger is ours and the accounting system is an EXPORTER. A
  // posting line is keyed on an account CODE; the provider's own id for an
  // account is an app-owned identity field hung off `gl_account`.
  //
  // 🛑 `gl_account` STAYS an EntityInstance while `gl_posting` /
  // `gl_posting_line` did not (decision G6, entity migration 113): postings
  // needed a composite unique index that `FieldValue` cannot express, whereas a
  // chart of accounts is a record a person maintains and `RecordIdentity` is
  // keyed on an instance and has no other addressing mode.
  'gl_account_code',
  'gl_account_name',
  'gl_account_type',
  // 🛑 There is NO `gl_account_role` here. Decision `G19` replaced that field
  // with the `GlRoleAssignment` table: a role must resolve to exactly one
  // account (enforced), but an account may serve many roles (permitted), and a
  // `unique: true` SINGLE_SELECT enforces the constraint AND its converse.
  'gl_account_is_active',

  // ─── Build / standard cost (plans/products/build/01-build-plan.md §1) ──
  // Entity migration 109. Every one of these reads NULL until the code that
  // writes it lands — there is no backfill anywhere in that migration.
  'build_number',
  'build_part',
  'build_status',
  'build_quantity_planned',
  'build_quantity_produced', // good units that entered finished goods
  'build_quantity_scrapped', // started but lost (B7) — falls out in the variance
  'build_started_at',
  'build_completed_at', // THE accounting date
  'build_material_cost',
  'build_labor_cost',
  'build_overhead_cost',
  'build_produced_value', // quantityProduced x part_standard_cost
  'build_variance_amount', // (mat+lab+ovh) - producedValue -> account 5090
  'build_movements', // inverse of stock_movement_build
  'build_reversal_of', // set on the REVERSING build (B6)
  'build_reversed_by', // inverse of build_reversal_of
  'build_posted_at', // denormalized convenience ONLY — never gate on it
  'build_notes',
  'build_order', // which order caused this build (plans/products/12 AB7)
  'build_source', // manual | order — an auto-build must be distinguishable
  // The frozen standard, deliberately separate from the live `part_cost`. The
  // three components are split because the fulfillment COGS entry has to land
  // across 5000 / 5010 / 5020, which it can only do if the finished good's
  // standard remembers its composition.
  'part_standard_material_cost',
  'part_standard_labor_cost',
  'part_standard_overhead_cost',
  'part_standard_cost', // the sum — the value every movement stamps
  'part_standard_cost_effective_at',
  // The two per-part absorption overrides (plans/money/tasks/22). The INPUTS
  // whose output is the frozen block above — NULL falls through to the org
  // rate, a stored 0 means "absorbs nothing", and unlike the frozen fields
  // these are creatable and updatable so the importer can set them in bulk.
  'part_labor_cost_per_unit',
  'part_overhead_cost_per_unit',
  'part_builds', // inverse of build_part
  'stock_movement_build', // nullable; `reference` stays as-is
  'stock_movement_qty_per_unit', // as-built BOM snapshot; NULL on a consume row = off-BOM
  'order_cancelled_at', // set, never cleared — a Shopify order can arrive cancelled
  'order_builds', // inverse of build_order
  // The drift pair (plans/products/13 Model A+). The order carries its CURRENT
  // demand fingerprint; a build carries the one that was current when it was
  // raised. Drift is the two differing — and neither field mutates a build.
  'order_build_revision',
  'build_order_revision',

  // ─── Tariff schedule (plans/money/tasks/29-tariff-schedule.md) ──
  // Entity migration 119, and INERT on deploy: a duty rate is a function of
  // (classification, origin, date) and today only the rate itself is
  // expressible, as a hand-keyed percentage on the supplier offer. These add
  // the other two and the history.
  //
  // 🛑 `tariff_code` is keyed on `(code, country)` and the two halves stay
  // SEPARATE fields. `8481.80.9005 CN` and `8481.80.9005 DE` are two records,
  // the label is composed, and a stored concatenation would have to be parsed
  // back apart for type-ahead on the code half and for "what origins have I
  // classified this code for" - which works until someone leaves a trailing
  // space.
  'tariff_code_code',
  'tariff_code_country', // ISO 3166-1 alpha-2, a seeded SINGLE_SELECT
  'tariff_code_description',
  'tariff_code_rates', // inverse of tariff_rate_tariff_code
  'tariff_code_vendor_parts', // inverse of vendor_part_tariff_code
  // The schedule. EVERY row carries a date and there is no null-means-current
  // row: "current" is `max(effectiveFrom) <= lookupDate`, and one rule answers
  // both "what is it today" and "what was it on Jan 15". For the same reason
  // there is no `effectiveTo` - the next row's start is the previous row's end,
  // and a rate that expires is an explicit row at 0.
  'tariff_rate_tariff_code',
  'tariff_rate_rate', // a PERCENTAGE; 25 means 25%, matching vendor_part_tariff_rate
  'tariff_rate_effective_from',
  'tariff_rate_authority', // nullable; blank counts as its own authority when summing
  // ⚠️ Documentation, never an input. The Chapter 99 code lets someone reconcile
  // an estimate against the broker's entry summary line by line; the arithmetic
  // never reads it.
  'tariff_rate_chapter99_code',
  'tariff_rate_note',
  // The pointer, on the OFFER and not on the part: a `tariff_code` asserts an
  // origin, so a part dual-sourced from China and Germany could hold only one.
  // The supplier offer is the only row that knows both what the thing is and
  // where it ships from.
  'vendor_part_tariff_code',

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

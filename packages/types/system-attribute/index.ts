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
  // B-lite entry conversion (plans/money/tasks/31-sub-cent-rates.md §2.9):
  // the offer's price field, never a stock or storage unit.
  'vendor_part_purchase_unit',
  'vendor_part_purchase_ratio',

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
  'contact_credit_memos', // inverse of credit_memo_contact (accounting/10 §2.1)
  'contact_balance_due',
  'contact_uninvoiced_amount',
  'contact_billing_revision',
  // plans/money/tasks/48-shopify-tax-data.md §4.4. The FLAG only: Shopify's
  // `tax_exemptions[]` was empty on every order measured, so the exemption
  // reason and the resale certificate are not available and are not tracked.
  'contact_tax_exempt',

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
  // plans/money/tasks/48-shopify-tax-data.md §4.2. Deliberately a SCALAR and
  // not a fan-out: this is what lets `buildFulfillmentEntry` use exact per-line
  // tax instead of allocating the order total pro rata across shipments.
  'line_item_tax_total',
  // plans/money/tasks/49-bulk-fulfillment-posting.md §8.4 decision 4, entity
  // migration 137. The sales channel's per-line fulfillment rollup, carried
  // NATIVE so lib never has to know a Shopify field path. Before this they
  // existed only as `@app:shopify:*` app fields, so nothing native said an
  // imported order had shipped.
  //
  // ⤵️ Their original consumer, `deriveFulfillmentLog`, is DELETED (55 §6):
  // `order_fulfillments` is now a has_many of real `fulfillment` records that
  // the connector writes directly, not a JSON log reconstructed by grouping
  // these three. They remain for their other readers.
  'line_item_fulfilled_at',
  'line_item_fulfilled_qty',
  'line_item_shipment_count',
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
  'line_item_credit_memo_lines', // inverse of credit_memo_line_line_item (accounting/10 §2.2)
  'line_item_fulfillment_lines', // inverse of fulfillment_line_line_item (plans/money/tasks/55)

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
  // Σ credit memo applications (plans/accounting/tasks/10-credit-memos.md
  // §2.3). An application posts no entry, so this is the only place the
  // invoice learns it was reduced: `syncInvoicePaymentState` writes it and
  // subtracts it from the balance.
  'invoice_amount_credited',
  'invoice_balance',
  'invoice_written_off',
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
  'invoice_credit_memos', // inverse of credit_memo_invoice - memos raised AGAINST this invoice
  'invoice_credit_applications', // inverse of credit_memo_application_invoice - credit applied TO it

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
  // Added by migration 122 (money plan 37 §8) — a merchant delivery note and a
  // stated shipping amount, folded into `order_total` alongside subtotal/tax.
  'order_note',
  'order_subtotal',
  'order_discount_type',
  'order_discount_value',
  'order_tax_name',
  'order_tax_rate',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'order_line_items', // inverse of line_item_order
  'order_tax_lines', // inverse of tax_line_order
  'order_credit_memos', // inverse of credit_memo_order (accounting/10 §2.1)
  'order_work_orders', // inverse of work_order_order
  // Added by migration 125 as a JSON array (plans/accounting/HANDOFF.md slot
  // 2G). 🛑 Entity migration 153 (plans/money/tasks/55) DROPS that JSON field
  // and recreates the SAME systemAttribute as a RELATIONSHIP has_many to the
  // new `fulfillment` entity - the owner's call was to keep the name and
  // change the type, so a `fulfillment_order` belongs_to is now the inverse
  // rather than a raw JSON cell. The premises behind the original JSON choice
  // (no independent identity, nothing links to it) are exactly what this
  // migration invalidates: Shopify assigns every fulfillment an id, and
  // `stock_movement` now links to a `fulfillment_line`.
  'order_fulfillments',
  // Added by entity migration 149. Inverse of `shipment_order`
  // (plans/apps/shipstation/shared-shipment-entities-proposal.md §6). One
  // order, many shipments: `Fulfillment.order` is singular and non-null.
  'order_shipments',

  // ─── Tax line (plans/money/tasks/48-shopify-tax-data.md §4.1) ────
  // One jurisdiction's share of one order's tax, as the sales channel computed
  // it. Records rather than a rate on the order because multi-jurisdiction is
  // the NORM: 104 of the 123 taxed orders measured carried more than one tax
  // line (§2), so a single `order_tax_rate` can represent 19 of 123.
  'tax_line_title', // the jurisdiction, e.g. "CA State Tax"
  'tax_line_rate', // as supplied; never used to compute anything
  'tax_line_price', // integer minor units, from `price_set.shop_money.amount` (§8.1)
  // 🛑 A POSTING INPUT, not decoration (§3, answered in §6.4): only a `false`
  // line credits 2200 Sales Tax Payable. A `true` line means the marketplace
  // remitted the tax and this business owes nothing.
  'tax_line_channel_liable',
  'tax_line_order', // owning side; inverse of order_tax_lines

  // ─── Credit memo (plans/accounting/tasks/10-credit-memos.md §2.1) ──
  // The mirror of an invoice: "you owe us less". ONE entity whether a person
  // issued a concession against an invoice (`native`) or the sales channel
  // already refunded the money (`channel`); `credit_memo_source` says which.
  // "Refund" was the wrong name the moment a concession is issued on an unpaid
  // invoice, because nothing is paid back.
  'credit_memo_number', // CM- series via keepOrAllocateRecordNumber; the hook is the only writer
  'credit_memo_status', // draft | issued | settled | void (§2.4)
  'credit_memo_source', // native | channel; set once on create, never editable
  'credit_memo_reason', // return | allowance | billing_error | cancellation | other
  // THE accounting date; the ledger entry is dated from this, never from ingest
  // or creation. Channel: the refund's own `created_at` at the provider.
  'credit_memo_issued_at',
  'credit_memo_note', // printed on the document; channel: the ONLY free text the payload carries
  'credit_memo_contact', // owning side; inverse of contact_credit_memos. Required
  'credit_memo_invoice', // owning side; inverse of invoice_credit_memos. Optional
  'credit_memo_order', // owning side; inverse of order_credit_memos. Optional
  'credit_memo_subtotal', // Σ line subtotals; totals hook is the only writer
  'credit_memo_tax_total', // Σ line tax totals, transcribed and never prorated
  'credit_memo_total', // subtotal + tax
  'credit_memo_amount_applied', // Σ applications; the settlement writer is the only writer
  // DERIVED, not transcribed, on the native path: Σ succeeded refund
  // transactions carrying the memo. On the channel path the connector
  // transcribes the Σ of successful refund transactions, because a Shopify
  // refund object carries no total at all. Do not rename it to a total.
  'credit_memo_amount_refunded',
  'credit_memo_balance', // total - applied - refunded; zero flips the memo to settled
  'credit_memo_lines', // inverse of credit_memo_line_credit_memo
  'credit_memo_applications', // inverse of credit_memo_application_credit_memo
  'credit_memo_pdf_asset', // the documents registry's pointerAttr, like invoice_pdf_asset
  'credit_memo_document', // a supporting attachment, like vendor_bill_document
  // The GlPosting this memo was posted into (accounting/25 §4.1). A denormalized
  // backlink, TEXT and not a relationship: GlPosting is a Drizzle table with no
  // EntityDefinition to point at. Once memos batch, the entry's lines no longer
  // name the memo, so this stamp is the ONLY way back to the ledger card.
  'credit_memo_gl_posting',

  // ─── Credit memo line (10 §2.2) ─────────────────────────────────
  'credit_memo_line_description', // printed; defaults to the line item's name when linked
  'credit_memo_line_qty',
  'credit_memo_line_unit_price', // a per-each RATE, like line_item_unit_price
  'credit_memo_line_subtotal', // integer minor units
  // Channel: bind from `total_tax_set.shop_money.amount` (a STRING), never
  // the sibling `total_tax` (a NUMBER). The payload is inconsistent about
  // money types and the numeric path is where a 100x bug lived.
  'credit_memo_line_tax_total',
  // Provider-NEUTRAL disposition, never Shopify's `restock_type` token. The
  // precedent for getting this wrong is migration 132 renaming
  // `1200 Shopify Clearing`. Null on a concession or remainder line.
  'credit_memo_line_disposition',
  'credit_memo_line_credit_memo', // owning side; inverse of credit_memo_lines
  'credit_memo_line_line_item', // owning side; inverse of line_item_credit_memo_lines. Optional
  'credit_memo_line_sort_order', // what LINE_SCHEMAS sorts on

  // ─── Credit memo application (10 §2.3) ──────────────────────────
  // One row per "this much of this memo went against this invoice". NOT a
  // PaymentAllocation: an application is not money and posts no entry; the
  // invoice learns of it through `invoice_amount_credited`.
  'credit_memo_application_credit_memo', // owning side; inverse of credit_memo_applications
  'credit_memo_application_invoice', // owning side; inverse of invoice_credit_applications
  'credit_memo_application_amount', // > 0, <= memo balance, <= invoice balance at the time
  'credit_memo_application_applied_at',

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
  // Nullable, updatable: false, filterable: true - all of task 50's netting
  // (plans/money/tasks/55). Mirrors stock_movement_purchase_order_line.
  'stock_movement_fulfillment_line',
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

  // ─── 1099 / W-9 (plans/accounting/HANDOFF.md slot 2K) ────────────
  'company_tax_classification',
  'company_tin',
  'company_w9_on_file',
  'company_is_1099_eligible',
  'company_default_1099_box',

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
  // The second fact about an account beyond its statement classification
  // (task 13 §3, pulled forward by task 15 §5): bank | accounts_receivable |
  // accounts_payable | credit_card | inventory | fixed_asset |
  // cost_of_goods_sold | other. Optional; null means nothing to say.
  'gl_account_subtype',
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
  'build_source', // manual | order | batch — an auto-build must be distinguishable
  // The DEMAND period a `batch` build claims, half-open (start inclusive, end
  // exclusive), entity migration 124. NULL on manual and order-raised builds.
  //
  // 🛑 NOT when the build happened. A batch build carries no orders (plan 44
  // §6.2 rejected the relation), so coverage is answered by netting ordered
  // quantity against built quantity per (part, period) — and a build created in
  // September covering January demand has to say January, which
  // `build_completed_at` cannot, because that is the accounting date and says
  // September.
  'build_period_start',
  'build_period_end',
  'build_batch_run',
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

  // ─── Bank deposit (plans/accounting/tasks/06-deposit-grouping.md) ──
  // Entity migration 125. Five cheques banked together arrive at the bank as
  // ONE line, so without this grouping the bank feed can only ever code a
  // receipt and never match it.
  //
  // ⚠️ NOT a customer deposit. `2350 Customer Deposits` is money taken before
  // delivery, a liability, and lives on `PaymentTransaction`. Say "bank
  // deposit" in full.
  //
  // 🛑 `bank_deposit_bank_transaction_id` is bare TEXT and copies
  // `vendor_payment_bank_transaction_id` by name AND semantics, so the bank
  // feed's matcher has one shape to look for. Both convert to a RELATIONSHIP
  // together once the `bank_transaction` def exists.
  'bank_deposit_number', // RecordSequence `DEP-0001`; the posting's docNumber keys on it
  'bank_deposit_date', // THE accounting date
  'bank_deposit_bank_account', // the GL account CODE the entry POSTED to, frozen at build time
  'bank_deposit_bank_account_record', // the bank account it was banked INTO; belongs_to bank_account
  'bank_deposit_reference',
  'bank_deposit_status', // pending | cleared
  'bank_deposit_total', // integer minor units; must equal the sum of the payments
  'bank_deposit_payments', // inverse of payment_bank_deposit
  'bank_deposit_bank_transaction_id',
  'bank_deposit_cleared_at',
  'bank_deposit_reconciled_at',
  'bank_deposit_gl_posting_id', // denormalized backlink; the posting is the authority
  'bank_deposit_pdf_asset', // the rendered deposit slip
  'payment_bank_deposit', // owning side — one deposit per payment, enforced on write

  // ─── Payout (HANDOFF §11.5 item 1) ──────────────────────────────
  // One gateway settlement: the batch of charges it paid out, and the entry it
  // became. Entity migration 133.
  //
  // 🛑 The record exists for `payout_number` before anything else.
  // `buildPayoutEntry` refuses a bare `po_…` — 27 characters against a
  // 21-character document-number cap — and cannot key on a date instead,
  // because two payouts can settle in one day.
  //
  // ⚠️ `payout_gross` / `payout_fees` / `payout_net` describe only the charges
  // auxx RECOGNISED. `payout_deposited` is the whole transfer that reached the
  // bank, and `payout_unrecognised_net` is the difference — money the gateway
  // settled that auxx has no payment for, credited to `2450 Unidentified
  // Receipts`.
  'payout_number', // RecordSequence `PAY-0001`; the posting's periodKey
  'payout_gateway_id', // `po_…`; every line's sourceId and THE idempotency key
  'payout_status', // in_transit | paid | failed | reversed
  'payout_paid_at', // THE accounting date
  'payout_currency',
  'payout_deposited', // integer minor units; the whole transfer, the cash leg
  'payout_gross', // recognised gross; what is relieved from card clearing
  'payout_fees', // what the PROCESSOR withheld, not the Connect application fee
  'payout_net', // recognised gross less recognised fees
  'payout_unrecognised_net', // settled charges auxx has no payment for, net
  'payout_unrecognised_count',
  'payout_gl_posting_id', // denormalized backlink; the posting is the authority
  'payout_bank_transaction_id', // the bank_deposit / vendor_payment twin, by name and meaning
  'payout_destination', // the gateway's own external-account id (brief 13 §2.3), never last4
  // 🛑 Set only when the payout could not be posted for lack of a confirmed
  // bank-account identity. Never a role; naming the payout, the destination and
  // the remedy (brief 13 §2.3).
  'payout_blocked_reason',

  // ─── Bank feed (plans/bank-connection/02-connection-architecture.md §6) ──
  // Entity migration 125. `bank_account` is where the feed meets the chart of
  // accounts; `bank_transaction` is a CONTRIBUTING-mode target whose fields
  // split into two groups that nothing may cross.
  //
  // 🛑 `bank_account_gl_account` is a GL account CODE as TEXT, not a
  // relationship — every GL pointer in the money subsystem is (decision `P2`),
  // and one later migration converts them all together.
  'bank_account_name',
  'bank_account_institution',
  'bank_account_last4', // TEXT: a leading zero is part of the number
  'bank_account_type', // depository (asset) | credit (a liability whose signs invert)
  'bank_account_currency',
  'bank_account_gl_account', // the CODE this account maps to. THE point of the entity
  'bank_account_feed_start_date', // earliest date we TRUST
  'bank_account_coverage_from', // earliest date we HOLD
  'bank_account_coverage_gaps', // [{ from, to }]; a balance sheet over a hole is silent and wrong
  'bank_account_connector_id', // a POINTER at DataConnector, never a copy of its health
  'bank_account_status', // manual | connected | disconnected
  // 🛑 A WRITE-ONCE high-water mark, never cleared. The only term in the
  // bank-account removal gate: false deletes, true archives
  // (plans/bank-connection/08-removing-a-bank-account.md §5.1)
  'bank_account_has_posted',
  // 🛑 The Stripe `ba_…` / `card_…` destination id, confirmed once by a person.
  // Never matched on last4 (brief 13 §2.3): a four-digit string is strong
  // evidence and not proof, and two accounts at one bank can share it.
  'bank_account_stripe_external_account_id',
  'bank_account_transactions', // inverse of bank_transaction_bank_account
  'bank_account_deposits', // inverse of bank_deposit_bank_account_record

  // ─── Payment gateway (task 13 §5.3) ──────────────────────────────
  // A record carrying its clearing account, never a role. Entity migration
  // 146. `payment_gateway_handles` is a SET (TAGS): two rails arrive under
  // two spellings each (`authorize_net`/`authorize.net`, `Affirm`/`affirm`).
  'payment_gateway_name',
  'payment_gateway_handles',
  // 🛑 The `gl_account` id this gateway settles into, TEXT with no foreign
  // key - the same call `bank_account_gl_account` makes.
  'payment_gateway_clearing_account',
  'payment_gateway_fee_account',
  'payment_gateway_settlement_source', // stripe | shopify_payments | manual
  'payment_gateway_status', // active | closed
  'payment_gateway_last_settlement_at',

  // Connector-owned (raw). The feed may correct any of these.
  'bank_transaction_external_id', // the dedupe key, across BOTH the feed and file import
  'bank_transaction_bank_account',
  'bank_transaction_posted_at', // transacted_at, not posted_at — the economic event
  'bank_transaction_description', // raw; Stripe FC gives no merchant name and no categories
  // 🛑 SIGNED integer minor units — the one signed money column in the books,
  // because it mirrors the bank. The LEDGER lines are still unsigned.
  'bank_transaction_amount',
  'bank_transaction_bank_status', // pending | posted | void AT THE BANK, not the fetch
  'bank_transaction_match_key', // normalised description; the primary categorisation signal
  'bank_transaction_import_batch_id',
  'bank_transaction_source', // feed | import

  // Auxx-owned (review). The connector may never write any of these.
  'bank_transaction_review_status',
  'bank_transaction_gl_account',
  'bank_transaction_matched_record_id', // half of one polymorphic pointer
  'bank_transaction_matched_record_type',
  'bank_transaction_exclude_reason',
  'bank_transaction_reviewed_at',
  'bank_transaction_reviewed_by_user_id',
  'bank_transaction_gl_posting_id', // also the freeze marker: raw fields stop moving
  'bank_transaction_rule_id',

  // Suggestion (HANDOFF slot 3C). Written by suggestFromHistory / evaluateRules.
  'bank_transaction_suggested_gl_account',
  'bank_transaction_suggested_record_id', // half of one polymorphic pointer (a transfer)
  'bank_transaction_suggested_record_type',
  'bank_transaction_suggestion_reason', // one explainable sentence, e.g. "last 6 -> 6100"
  'bank_transaction_suggestion_source', // history | rule | transfer

  // bank_rule (HANDOFF slot 3C, migration 125). Suggest-from-history is the
  // PRIMARY mechanism (bank plan 03 §4); a rule is the opt-in, ordered layer on
  // top of it. bankAccount/counterpartBankAccount/contact are entity-instance id
  // pointers as TEXT, not RELATIONSHIPs - see bank-rule-fields.ts for why.
  'bank_rule_name',
  'bank_rule_enabled',
  'bank_rule_auto_apply', // an auto-applied rule posts WITHOUT review, off by default
  'bank_rule_priority',
  'bank_rule_match_field', // description | matchKey
  'bank_rule_match_operator', // contains | equals | starts_with | regex
  'bank_rule_match_value',
  'bank_rule_amount_min',
  'bank_rule_amount_max',
  'bank_rule_direction', // in | out | any
  'bank_rule_bank_account', // scope to one account; any account when empty
  'bank_rule_action', // code | exclude | transfer
  'bank_rule_gl_account',
  'bank_rule_counterpart_bank_account',
  'bank_rule_contact',
  'bank_rule_memo',
  'bank_rule_applied_count',
  'bank_rule_last_applied_at',

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
  // DERIVED, never typed: `{code} {country}`, stamped by a hook on every write
  // to either leg. It exists so the display name and the importers' relation
  // match have ONE text field that names the whole `(code, country)` identity -
  // a relation column matches on one field, and matching on `code` alone
  // resolves `8481.80.9005` to CN and DE interchangeably (task 30 §8). Nothing
  // parses it back apart; the two legs stay the source of truth.
  'tariff_code_label',
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

  // ─── Journal entry (plans/accounting/tasks/02-manual-journal-entry.md) ──
  // Entity migration 125. The DRAFT of a hand-authored posting, and the holder
  // of the opening trial balance (HANDOFF decision 6.7).
  //
  // 🛑 `journal_entry_number` is also the entry's `periodKey`, which is why it
  // is hook-issued and never updatable: `doc-number.ts` keys `manual_journal` on
  // the record number rather than on a date, because many entries can post in
  // one day and a date key would make the second collide with the first on the
  // claim's unique index.
  'journal_entry_number',
  'journal_entry_date', // a DATE - no time, no zone. The accounting date.
  'journal_entry_memo',
  'journal_entry_status', // draft | posted | reversed. Written by the post/reverse path only
  // manual | opening_balance | recurring_template | recurring. Set once, and it
  // is the single authority for the posting type the entry becomes.
  'journal_entry_kind',
  // The DRAFT lines as JSON, the `inbox_settings` shape. The POSTED lines are
  // normalised in `GlPostingLine`, which is what every report reads; a second
  // normalised copy would be two sources of truth for what the entry says.
  'journal_entry_lines',
  'journal_entry_attachment',
  // TEXT, not a relationship: `GlPosting` is a Drizzle table (decision G6) and
  // there is no `EntityDefinition` to point at. The audit direction that matters
  // runs the other way - every line carries `sourceType: 'journal_entry'`.
  'journal_entry_gl_posting_id',
  // The `RecurrenceRule` that generated this entry, and the slot it fills
  // (task 21 §1.4). TEXT on both: the rule is a Drizzle table, and the
  // occurrence date is a SLOT IDENTITY rather than the accounting date - the
  // two are hashed together into the posting's `periodKey`, so neither may move
  // once written.
  'journal_entry_recurrence_rule_id',
  'journal_entry_occurrence_date',

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

  // ─── Shipment and parcel ───────────────────────────────
  // Native, app-agnostic, both hidden (`isVisible: false`). Entity migration
  // 149 (plans/apps/shipstation/shared-shipment-entities-proposal.md §6).
  // A `shipment` is one dispatch of goods; a `parcel` is one physical box with
  // one tracking number, which is the grain the customer actually asks about.
  // There is deliberately no `label` entity: a void and reprint is lifecycle on
  // the parcel, not a record of its own.
  'shipment_number',
  // The active label's master parcel tracking number, denormalized onto the
  // shipment: `computeDisplayValue` reads a field on the ROW, and a tracking
  // number otherwise lives only on a `parcel`.
  'shipment_master_tracking_number',
  // DERIVED roll-up over the shipment's active (non-voided) parcels, computed
  // by the connector and never hand-set. See `ShipmentStatus` for the
  // precedence order.
  'shipment_status',
  'shipment_carrier', // fedex | ups | usps
  'shipment_service', // the carrier's own service name, as supplied
  'shipment_ship_date',
  'shipment_parcel_count',
  'shipment_parcels', // inverse of parcel_shipment, has_many, onDelete cascade
  'shipment_order', // inverse of order_shipments
  // Label-level money and documents, added by entity migration 151
  // (plans/apps/shipstation/shipstation-status-and-linking-plan.md §7). Both
  // amounts are CURRENCY, which is an INTEGER MINOR-UNIT amount; the provider
  // sends a decimal and the connector multiplies, because the mapping layer has
  // no transform hook. Only the live (non-voided) label's values arrive, since
  // voiding refunds the label.
  'shipment_cost',
  'shipment_insurance_cost',
  'shipment_insurance_claim',
  // A capability URL: it fetches unauthenticated and carries the customer's
  // name and address, so treat the value as a bearer secret.
  'shipment_label_url',

  // Parcel. `parcel_tracking_number` is the cross-app match key: the carrier
  // apps find the box by it, so it is treated as unique (§8b).
  'parcel_tracking_number',
  'parcel_sequence', // box N of M, as the label prints it
  'parcel_is_master', // the master tracking number of a multi-box label
  // ShipStation reports weight in OUNCES (one 3-box label returned 1280,
  // 464 and 704) and dimensions in INCHES, so neither unit field is decorative.
  'parcel_weight',
  'parcel_weight_unit',
  'parcel_length',
  'parcel_width',
  'parcel_height',
  'parcel_dim_unit',
  // The label lifecycle, kept OUT of `parcel_status` on purpose: that is what
  // lets one shared status vocabulary describe both grains.
  'parcel_voided',
  'parcel_voided_at',
  // Carrier-app owned from here down. `parcel_status` is the normalized
  // `ParcelTrackingStatus`; the raw pair beside it is what the carrier said.
  'parcel_status',
  'parcel_status_code',
  'parcel_status_description',
  'parcel_estimated_delivery',
  'parcel_delivered_at',
  'parcel_received_by', // signature name, when the carrier reports one
  'parcel_shipment', // inverse of shipment_parcels

  // ─── Fulfillment and fulfillment line (plans/money/tasks/55) ────
  // Replaces `order_fulfillments` as a JSON array with real records, so
  // revenue posts from a row instead of a collapsed min/max/sum. Both hidden
  // (`isVisible: false`), no route folder. Entity migration 153.
  'fulfillment_order', // owning side; inverse of order_fulfillments (same name, new type)
  'fulfillment_sequence', // 1-based within the order, ship-date order
  'fulfillment_shipped_at', // THE accounting date; never Shopify's updated_at
  'fulfillment_status', // open | success | cancelled | error | failure, mirrors Shopify
  'fulfillment_cancelled_at', // when a relief reversal is written; not shippedAt
  'fulfillment_name', // the display field; nullable in type, never absent in practice
  'fulfillment_tracking_number',
  'fulfillment_tracking_company',
  'fulfillment_tracking_url',
  'fulfillment_subtotal', // integer minor units; was subtotalMinor
  'fulfillment_total', // integer minor units; was totalMinor
  'fulfillment_shipping_recognised', // freight recognised once, on the first dispatch
  // TEXT, not a RELATIONSHIP - GlPosting is a Drizzle table with no
  // EntityDefinition to point at. credit_memo_gl_posting is the precedent.
  'fulfillment_gl_posting',
  'fulfillment_doc_number',
  'fulfillment_recorded_at',
  'fulfillment_lines', // inverse of fulfillment_line_fulfillment, has_many, onDelete cascade
  // Nullable, one-sided belongs_to the logistics fact (brief §2.2) - opportunistic
  // tracking-number match, no field on shipment points back, and nothing in
  // relief or posting may read it.
  'fulfillment_shipment',
  'fulfillment_line_fulfillment', // owning side; inverse of fulfillment_lines
  'fulfillment_line_line_item', // owning side; inverse of line_item_fulfillment_lines
  'fulfillment_line_quantity', // units shipped in THIS dispatch, never cumulative
  // COMPUTED, re-SUMmed over stock_movement_fulfillment_line - the exact
  // mirror of purchase_order_line_quantity_received.
  'fulfillment_line_quantity_relieved',
  'fulfillment_line_stock_movements', // inverse of stock_movement_fulfillment_line

  // Returned material, the damage evidence and the salvage
  // (plans/money/tasks/54-returns.md section 3). Three grains: one `return`
  // per shipment back, one `return_line` per sold line PER CONDITION, and a
  // `return_part_line` tree that is the warehouse's teardown checklist.
  'return_number', // RMA-000N, minted by the RecordSequence hook like CM-
  'return_status', // PHYSICAL lifecycle only; money is derived from the memos
  'return_origin', // closed single-select: a return has exactly one origin
  'return_reason', // TAGS, ours and user-extensible; Shopify's enum is apparel
  'return_contact', // NULLABLE and load-bearing: a dock pallet has no known sender
  'return_order',
  'return_ticket',
  'return_requested_at',
  'return_received_at',
  'return_inspected_at',
  'return_closed_at',
  'return_sender_name_raw', // what the shipping label says, before identification
  'return_sender_address_raw',
  'return_inbound_carrier',
  'return_inbound_tracking',
  'return_label_provided',
  'return_label_cost',
  'return_goods_value', // transcribed: what the returned items sold for
  'return_credited_amount', // rolled up from the linked memos; derived, never typed
  'return_withheld_amount', // goodsValue - creditedAmount; no GL effect
  'return_withheld_reason', // the sentence that goes in the chargeback rebuttal
  'return_photos',
  'return_lines',
  'return_credit_memos', // inverse; the FK is on the memo, which is created first
  'return_evidence_pack_asset', // written only by the generator

  'return_line_return',
  'return_line_line_item',
  'return_line_part', // denormalized, and the BOM root for the salvage tree
  'return_line_quantity',
  'return_line_customer_reason',
  'return_line_customer_note',
  'return_line_condition_grade',
  'return_line_liability', // customer_damage vs shipping_damage is what is fought about
  'return_line_inspection_notes',
  'return_line_inspected_by',
  'return_line_inspected_at',
  'return_line_photos',
  'return_line_part_lines',

  'return_part_line_return_line',
  'return_part_line_parent', // SELF-REFERENTIAL; this is the tree
  'return_part_line_children',
  'return_part_line_part',
  'return_part_line_quantity', // prefilled from the BOM, editable, splittable
  'return_part_line_status', // good | damaged | scrap | missing | undecided
  'return_part_line_salvage_percent', // the input to the frozen unit cost
  'return_part_line_unit_cost', // standard x percent, frozen; the standard is re-rolled
  'return_part_line_sort_order',
  'return_part_line_movement', // set only on rows that produced a return_in

  // Inverse halves on existing definitions. Both sides are declared because an
  // unlinked relationship accepts writes and reads empty forever (migration 149).
  'contact_returns',
  'order_returns',
  'ticket_returns',
  'line_item_return_lines',
  'part_return_lines',
  'part_return_part_lines',
  'credit_memo_return', // owning side: the FK is on the memo
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

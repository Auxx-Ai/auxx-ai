// packages/lib/src/settings/catalog.ts
// Code-declared catalog of every org/user setting. Entries are FieldType/FieldOptions-shaped
// so the write path reuses the field-value validation machinery (`normalizeSettingValue`) and
// the frontend can render any setting with the generic `FieldInputAdapter`. See
// plans/settings/v2/README.md for the full design.

import type { FieldType } from '@auxx/database/types'
import type { FieldOptions } from '../custom-fields/field-options'
// The option list for the `accounting.paymentRoute.*` keys, owned by the module
// that reads them (`resolvePaymentRoute`) rather than restated here - a second
// copy of the three destinations would let a form offer a value the resolver
// does not recognise, which falls back silently.
import { PAYMENT_ROUTE_SETTING_OPTIONS } from '../money/bank-deposits/route'
import type { SettingScope, SettingValue } from './types'

/**
 * A single catalog entry — metadata for one setting key.
 */
export interface SettingConfig {
  /** Grouping/filtering + the `OrganizationSetting.scope` DB column value. */
  scope: SettingScope
  /** `'org'` = admins only; `'user'` = users may override the org value. */
  access: 'org' | 'user'
  fieldType: FieldType
  options?: FieldOptions
  defaultValue: SettingValue
  description?: string
}

/**
 * Sidebar layout settings — UI-state blobs written by code, not forms. Records
 * sidebar layout (`sidebar.entities.*`) is org-wide and admin-editable; mail
 * sidebar layout (`sidebar.inboxes`/`sidebar.views`/…) is per-user.
 */
const sidebarSettings = {
  'sidebar.inboxes': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: {}, // Record of inbox IDs to visibility settings
    description: 'Visibility settings for shared inboxes',
  },
  'sidebar.inboxOrder': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: [], // Array of inbox IDs in order
    description: 'Order of shared inboxes in sidebar',
  },
  'sidebar.personalItems': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: [
      { id: 'inbox', name: 'Inbox', visible: true, order: 0 },
      { id: 'drafts', name: 'Drafts', visible: true, order: 1 },
      { id: 'sent', name: 'Sent', visible: true, order: 2 },
    ],
    description: 'Personal sidebar items visibility and order',
  },
  'sidebar.views': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: {}, // Record of view IDs to visibility settings
    description: 'Visibility settings for mail views',
  },
  'sidebar.viewsOrder': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: [], // Array of view IDs in order
    description: 'Order of mail views in sidebar',
  },
  'sidebar.groupVisibility': {
    scope: 'SIDEBAR',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: { personal: true, views: true, shared: true },
    description: 'Visibility settings for sidebar groups (Me, Views, Shared)',
  },
  // Records sidebar layout is org-wide (shared by everyone, admin-editable).
  'sidebar.entities.order': {
    scope: 'SIDEBAR',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: [],
    description: 'Order of root-level Records sidebar nodes (interleaved folder + entity IDs)',
  },
  'sidebar.entities.visibility': {
    scope: 'SIDEBAR',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: {},
    description: 'Visibility settings for entity definitions in the Records sidebar',
  },
  'sidebar.entities.groupVisible': {
    scope: 'SIDEBAR',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Visibility of the Records group in sidebar',
  },
  'sidebar.entities.folders': {
    scope: 'SIDEBAR',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: [], // Array<{ id: string; title: string }>
    description: 'Folder definitions for the Records sidebar',
  },
  'sidebar.entities.folderItems': {
    scope: 'SIDEBAR',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: {}, // Record<folderId, entityId[]>
    description: 'Ordered entity IDs within each Records sidebar folder (membership + order)',
  },
} satisfies Record<string, SettingConfig>

/**
 * Catalog of every org/user setting. Keys are not free strings — {@link SettingKey}
 * is derived from this object so the union can never drift from the definitions
 * (same spirit as `SystemAttribute`, but derived rather than hand-listed).
 *
 * `appearance.*` keys (logo/primaryColor/secondaryColor/font) are deliberately
 * absent — dead inventory removed by v2 (see plan §Deletions). They return
 * only if/when the Appearance page returns.
 */
export const SETTINGS_CATALOG = {
  'onboarding.gettingStarted': {
    scope: 'ONBOARDING',
    access: 'org',
    fieldType: 'JSON',
    // GettingStartedState — { dismissedAt: string | null; manualCompletions: string[] }
    defaultValue: { dismissedAt: null, manualCompletions: [] },
    description: 'Getting-started checklist state (dismissal + manual completions)',
  },

  'onboarding.dispatchGettingStarted': {
    scope: 'ONBOARDING',
    access: 'org',
    fieldType: 'JSON',
    // GettingStartedState — { dismissedAt, manualCompletions, wizardCompletedAt }
    defaultValue: { dismissedAt: null, manualCompletions: [], wizardCompletedAt: null },
    description: 'Dispatch getting-started state (wizard + checklist dismissal/completions)',
  },

  'onboarding.accountingGettingStarted': {
    scope: 'ONBOARDING',
    access: 'org',
    fieldType: 'JSON',
    // GettingStartedState — { dismissedAt, manualCompletions, wizardCompletedAt }
    //
    // ⚠️ Only the DISMISSAL and the wizard stamp live here. Every goal is a live
    // signal computed per call (`getting-started/signals.ts`), which is what
    // keeps task 12's rule — readiness is derived on read, never stored, because
    // a stored flag goes stale the moment somebody changes a rate.
    defaultValue: { dismissedAt: null, manualCompletions: [], wizardCompletedAt: null },
    description: 'Accounting getting-started state (wizard + checklist dismissal/completions)',
  },

  'notification.emailDigest': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Receive daily email digest',
  },
  'notification.sound.newMessage': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Play a sound when a new message arrives (email + chat)',
  },
  'notification.sound.bell': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Play a sound for notification-bell alerts (mentions, approvals)',
  },
  'notification.approval.email': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'Email me when a workflow needs my approval, and when it is about to expire (it still appears in Approvals either way)',
  },
  'notification.dispatch.email': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'Email me when a visit I was dispatched to is rescheduled, canceled, or reassigned (in-app alerts always fire)',
  },
  'notification.dispatch.dailyDigest': {
    scope: 'NOTIFICATION',
    access: 'user',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Email me a daily digest of my scheduled visits',
  },

  'dashboard.defaultView': {
    scope: 'DASHBOARD',
    access: 'user',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'kanban',
    description: 'Default dashboard view',
    options: {
      options: [
        { value: 'kanban', label: 'Kanban' },
        { value: 'list', label: 'List' },
        { value: 'calendar', label: 'Calendar' },
      ],
    },
  },

  // ── COMMUNICATION ──────────────────────────────────────────
  'email.internalDomains': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'TAGS',
    defaultValue: [],
    description: 'List of domains considered internal to the organization',
  },
  'email.partnerDomains': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'TAGS',
    defaultValue: [],
    description: 'List of domains considered as partner domains',
  },
  'company.autoCreate': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Automatically create and link companies from inbound/outbound message domains',
  },
  'compose.defaultIntegrationId': {
    scope: 'COMMUNICATION',
    access: 'user',
    fieldType: 'TEXT',
    defaultValue: null,
    description: 'Default sending channel for new compose drafts',
  },
  // The default signature is PER-USER, not per-org (plan 36 §12.2). It used to be
  // the org-global `signature_is_default` FieldValue, and switching a default meant
  // WRITING TO ANOTHER MEMBER'S RECORD to unset theirs — which 403s the moment
  // signatures are `baselineAtCreate: true`. Worse, an org-global pointer can name a
  // signature most members cannot see, so the composer would try to stamp an
  // inaccessible signature onto their draft. Storing it here dissolves the problem
  // instead of working around it: `UserSetting` is already keyed on
  // (userId, organizationId, key), so `signature.setDefault` asserts `view` on the
  // target and writes ONLY the caller's row. `signature.getDefault` re-checks
  // viewability on read, so a pointer left dangling by a delete or an un-share
  // degrades to "no default" rather than a 403 mid-compose. `access: 'user'` with no
  // org twin is deliberate — there is no org-level default to inherit.
  'signature.defaultId': {
    scope: 'COMMUNICATION',
    access: 'user',
    fieldType: 'TEXT',
    defaultValue: null,
    description: "This member's default email signature (EntityInstance id)",
  },
  'email.unsubscribeOn1to1Replies': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'Add a List-Unsubscribe header to human-sent 1:1 email replies (off by default — ' +
      'support threads should not necessarily carry an unsubscribe link). Automated/' +
      'scheduled/sequence sends always include it.',
  },
  // Automated-send rate limits (machine-mail plan Phase 3) — guardrails against
  // auto-reply loops. Human sends are never limited.
  'email.automation.maxPerRecipientPerHour': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 2,
    description:
      'Max automated emails to a single recipient per hour (0 disables). Loops hop ' +
      'threads, so this per-address cooldown is the primary loop breaker.',
  },
  'email.automation.maxPerOrgPer15Min': {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 30,
    description:
      'Circuit breaker: max automated emails across the organization per 15 minutes ' +
      '(0 disables). Tripping it blocks automated sends and notifies admins.',
  },
  // Post-connect retroactive prompt (mail-filters plan §7 / D18). A freshly
  // connected mailbox backfills with filters off, so once the sync completes we
  // ASK whether to apply them — never do it automatically. This records the
  // inbox ids this member has waved away. PER-USER on purpose: it is a nudge on
  // someone's screen, and one admin dismissing it must not hide the prompt from
  // the colleague who would have said yes.
  'mailFilters.retroactivePromptDismissed': {
    scope: 'COMMUNICATION',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: [],
    description: 'Inbox ids this member dismissed the "apply filters retroactively" prompt for',
  },
  // Post-sync classification prompt (07-mail-reclassification-plan.md §3.4).
  // Mirrors `mailFilters.retroactivePromptDismissed` and for the same reason:
  // the banner is a nudge on ONE person's screen, so one member waving it away
  // must not hide it from the colleague who would have said yes.
  //
  // ⚠️ Two prompts must never stack (07 §3.4). When both are pending for an
  // inbox the FILTER prompt wins — it is the older feature and its action
  // mutates routing, whereas this one only labels. That precedence lives in the
  // component, not here; this entry only declares storage.
  'mailClassification.retroactivePromptDismissed': {
    scope: 'COMMUNICATION',
    access: 'user',
    fieldType: 'JSON',
    defaultValue: [],
    description: 'Inbox ids this member dismissed the "classify existing mail" prompt for',
  },
  // AI mail classification opt-in (mail-classification plan §5). A LIST of inbox
  // ids, never a boolean: "classify everything" must not be expressible.
  //
  // ⚠️ ORG-scoped storage, but authoring authority is PER INBOX and follows the
  // mail model, never admin rank (filters-plan invariant 7) — the same gate that
  // governs authoring a filter on that inbox. A personal mailbox is its owner's
  // alone and an admin must never be able to switch inference on over it
  // (invariant 11). The router asserts; this catalog entry only declares storage.
  mailClassificationInboxIds: {
    scope: 'COMMUNICATION',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: [],
    description: 'Inbox ids whose inbound mail the AI classifier may read and categorise',
  },

  ...sidebarSettings,

  // ── RECORDING ──────────────────────────────────────────────
  'recording.enabled': {
    scope: 'RECORDING',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Enable meeting recording feature',
  },
  'recording.botProvider': {
    scope: 'RECORDING',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'recall',
    description: 'Bot provider for meeting recordings',
    options: { options: [{ value: 'recall', label: 'Recall.ai' }] },
  },
  'recording.defaultBotName': {
    scope: 'RECORDING',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: 'Auxx Recorder',
    description: 'Bot display name shown in meetings',
  },
  'recording.defaultConsentMessage': {
    scope: 'RECORDING',
    access: 'org',
    fieldType: 'TEXT',
    options: { multiline: true },
    defaultValue: 'This meeting is being recorded by Auxx.',
    description: 'Chat message sent when bot joins a meeting',
  },
  'recording.captureVideo': {
    scope: 'RECORDING',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Record video in addition to audio',
  },
  'recording.autoRecord': {
    scope: 'RECORDING',
    access: 'user',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'none',
    description: 'Auto-record preference for meetings',
    options: {
      options: [
        { value: 'all', label: 'All meetings' },
        { value: 'external', label: 'External only' },
        { value: 'none', label: 'None' },
      ],
    },
  },

  // ── KOPILOT ────────────────────────────────────────────────
  'kopilot.modelId': {
    scope: 'KOPILOT',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'Default model for master Kopilot in provider:model format (e.g. anthropic:claude-opus-4-7). null = system default.',
  },
  'kopilot.toolsets': {
    scope: 'KOPILOT',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: [{ slug: 'auxx:*', enabled: true, source: 'auto_default' }],
    description:
      'Per-toolset enable/disable + per-tool overrides for master Kopilot (native auxxai toolsets only). Supports glob slugs (e.g. auxx:*).',
  },
  'kopilot.appAccounts': {
    scope: 'KOPILOT',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: {},
    description: 'Per-app explicit workspace cred for master Kopilot. Missing = off.',
  },

  // ── MONEY (quoting, money MQ1 build spec §G.1) ──────────────────
  // `organization.currency` deliberately stays GENERAL — org-wide, not a documents.* key
  // (02-document-settings.md decision) — even though it's edited on the Documents page.
  'organization.currency': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: 'USD',
    description:
      'Organization-wide currency code — consumed by the money cluster, documents and Stripe rails (NOT the CURRENCY field layer, which reads options.currencyCode)',
  },
  'organization.weekStart': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'monday',
    description:
      'First day of the business week — consumed by the availability editor and dispatch calendar',
    options: {
      options: [
        { value: 'monday', label: 'Monday' },
        { value: 'sunday', label: 'Sunday' },
        { value: 'saturday', label: 'Saturday' },
      ],
    },
  },
  'organization.use24HourTime': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Display times in 24-hour format instead of AM/PM',
  },
  // Dispatch auto-sync (plans/dispatch/20-route-times-sync.md §5) — GENERAL like the other
  // org-wide operational switches; Phase 3 is schema-free, no new scope.
  'dispatch.routes.autoApplyTimes': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'When on, reordering a route automatically re-chains scheduled times for provisional ' +
      'stops (confirmed times hold as anchors)',
  },
  // Dispatch board visible-hour window (plan 41) — crops the hour axis of ALL board time-grid
  // views (day/week/resource/timeline) to working hours instead of a dead 0-24 grid. Unset
  // (null) = auto-derive from the org weekly working-hours template ± 2h buffer; the client also
  // unions in any real visit's hours so nothing outside the window is ever clipped.
  'dispatch.board.visibleHourStart': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: null,
    description:
      'Board time-grid start hour (0-24). Unset = automatic — derived from working hours ' +
      '± 2h buffer.',
  },
  'dispatch.board.visibleHourEnd': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: null,
    description:
      'Board time-grid end hour (0-24). Unset = automatic — derived from working hours ' +
      '± 2h buffer.',
  },
  // Dispatch board off-day column hiding (plan 42) — drops the week/timeline day columns for
  // off-work days that have no scheduled visits; a booked off-day stays visible automatically, and
  // a per-device "Show all days" toggle reveals the empties when scheduling into one.
  'dispatch.board.hideEmptyOffDays': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'Hide day columns for off-work days with no scheduled visits (week + timeline views). ' +
      'Booked off-days stay visible.',
  },

  // ── DOCUMENTS (quote/invoice PDF + email settings, money MQ2 build spec §A) ──────────────
  // `documents.taxRates` moved here from GENERAL (money MQ1 §G.1 shipped it under GENERAL —
  // "no DDL for MQ1"); the DOCUMENTS scope + per-field flattening below is the settings
  // refactor ([02-document-settings.md]) landing with the Documents settings page (MQ2).
  // See data-migrations/migrations/036-documents-taxrates-scope.ts for the row backfill.
  'documents.taxRates': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'JSON',
    // Array<{ id: string; name: string; rate: number; isDefault?: boolean }> — documents
    // SNAPSHOT name+rate at pick time; editing a rate never rewrites existing documents.
    defaultValue: [],
    description: 'Org tax rate presets for the quote/invoice line builder tax picker',
  },
  'documents.business': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'JSON',
    // { companyName?, address?: {line1,line2?,city,zip,region?,country}, phone?, email?,
    //   website?, taxId?: {label,value} } — ONE blob, bespoke form section (02 shape).
    defaultValue: {},
    description: 'Business identity block printed on quote/invoice PDFs',
  },
  'documents.businessGeocode': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'JSON',
    // { lat, lng, geocodedAt, addressHash } — `addressHash` = sha1 of sorted-key JSON of the
    // business address; `resolveRouteStart` (route-planner/depot.ts) re-geocodes lazily when
    // the stored hash differs from the current address (route-planner build contract item 3).
    defaultValue: {},
    description: 'Cached geocode of the business address — route planner depot (org fallback)',
  },
  'documents.logo': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'JSON',
    // { assetId, url } — MediaAsset ref, bespoke upload cell (§F.3).
    defaultValue: null,
    description: 'Logo image printed on quote/invoice PDFs',
  },
  'documents.accentColor': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: '',
    description: 'Hex accent color for quote/invoice PDF branding',
  },
  'documents.paperSize': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    // US Letter is the default: the dispatch/field-service customer base is US-first, and an
    // org that never opens Documents settings should get PDFs that print on the paper it owns.
    defaultValue: 'letter',
    description: 'Paper size for quote/invoice PDF rendering',
    options: {
      options: [
        { value: 'a4', label: 'A4' },
        { value: 'letter', label: 'Letter' },
      ],
    },
  },
  'documents.dateFormat': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'MMM d, yyyy',
    description: 'Date format for dates printed on quote/invoice PDFs',
    options: {
      options: [
        { value: 'MMM d, yyyy', label: 'MMM d, yyyy (Jan 5, 2026)' },
        { value: 'MM/dd/yyyy', label: 'MM/dd/yyyy (01/05/2026)' },
        { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy (05/01/2026)' },
        { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd (2026-01-05)' },
      ],
    },
  },
  'documents.quote.defaultTerms': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    options: { multiline: true },
    defaultValue: '',
    description: 'Default terms text prefilled on new quotes',
  },
  'documents.quote.validDays': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 30,
    description: 'Default number of days a new quote is valid for (prefills validUntil)',
  },
  'documents.quote.footerText': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: '',
    description: 'Footer text printed on quote PDFs',
  },
  'documents.quote.lineDisplay': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'full',
    description: 'Line item detail level on quote PDFs',
    options: {
      options: [
        { value: 'full', label: 'Full detail' },
        { value: 'amount_only', label: 'Amount only' },
      ],
    },
  },
  'documents.quote.showDescriptions': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Show line item descriptions on quote PDFs',
  },
  'documents.quote.acceptancePageEnabled': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'Master switch for the public quote acceptance page (v5 build spec 01) — off, the ' +
      'public page 404s and the quote email keeps PDF-only behavior',
  },
  'documents.quote.allowDecline': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Show the Decline action on the public quote acceptance page',
  },
  'documents.quote.requireSignature': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Require the customer to type their full name to accept a quote',
  },
  'documents.quote.autoConvertOnAccept': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Automatically convert an accepted quote into a work order',
  },
  'documents.quote.depositType': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'none',
    description:
      "Org default deposit type — prefills new quotes' deposit fields (quote_deposit_type)",
    options: {
      options: [
        { value: 'none', label: 'None' },
        { value: 'percent', label: 'Percent' },
        { value: 'fixed', label: 'Fixed amount' },
      ],
    },
  },
  'documents.quote.depositValue': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 0,
    description:
      'Org default deposit value — percent (0-100) or a currency amount (50 = $50.00) ' +
      'depending on depositType; prefills new quotes',
  },
  'documents.receiptEmail.enabled': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'Email an org-branded receipt to the customer when they pay a deposit or invoice online ' +
      '(plans/dispatch/money/15) — off, no receipt is sent',
  },
  'documents.invoice.dueDays': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 30,
    description: 'Default number of days an invoice is due after issue (MI1 consumes)',
  },
  'documents.invoice.allowPartialPayments': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'Let customers pay a custom amount (not just the full balance) on the public pay page',
  },
  'documents.invoice.partialPaymentMinPercent': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 10,
    description:
      'Minimum payment as a percent of the current balance, when partial payments are allowed',
  },
  'documents.invoice.autoEnabled': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'Master switch for automated invoice drafts (MI2) — off, every trigger no-ops; ' +
      'manual gather is unaffected',
  },
  'documents.invoice.defaultTiming': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'per_visit_completed',
    description: 'What NEW quotes/jobs start as for invoice timing (MI2)',
    options: {
      options: [
        { value: 'per_visit_completed', label: 'Per visit completed' },
        { value: 'on_completion', label: 'On job completion' },
        { value: 'as_needed', label: 'As needed' },
      ],
    },
  },
  'documents.invoice.dateBasis': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'visit_date',
    description:
      'issuedAt policy for auto-drafts (MI2): visit/occurrence date vs generation date — ' +
      'dueDate always counts from generation day',
    options: {
      options: [
        { value: 'visit_date', label: 'Visit / occurrence date' },
        { value: 'creation_date', label: 'Generation date' },
      ],
    },
  },
  'documents.invoice.paymentInstructions': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    options: { multiline: true },
    defaultValue: '',
    description: 'Payment instructions printed on invoice PDFs (MI1 consumes)',
  },
  'documents.invoice.footerText': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: '',
    description: 'Footer text printed on invoice PDFs (MI1 consumes)',
  },
  'documents.invoice.lineDisplay': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'full',
    description: 'Line item detail level on invoice PDFs (MI1 consumes)',
    options: {
      options: [
        { value: 'full', label: 'Full detail' },
        { value: 'amount_only', label: 'Amount only' },
      ],
    },
  },
  'documents.invoice.showDescriptions': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Show line item descriptions on invoice PDFs (MI1 consumes)',
  },
  'documents.invoice.showPaymentHistory': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description: 'Show payment history on invoice PDFs (MI1 consumes)',
  },

  // ── QuickBooks invoice sync (plans/dispatch/37e-quickbooks-invoice-sync.md P1) ──────────
  'quickbooks.syncInvoices': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'When on, sending an Auxx invoice mirrors it into QuickBooks Online.',
  },
  'quickbooks.defaultIncomeAccountId': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description: 'QBO income account id used when auto-creating service items.',
  },

  // ── QuickBooks general-ledger posting (plans/auxx-lift/gap-b-execution-plan.md) ─────────
  'quickbooks.postJournalEntries': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    // Off by default, and deliberately a separate switch from `syncInvoices`:
    // a journal entry hits the financial statements directly, with no invoice or
    // payment to reconcile it against. Turning on invoice sync must never turn
    // this on as a side effect.
    defaultValue: false,
    description:
      'When on, accrual summaries are posted to the QuickBooks general ledger as journal entries.',
  },

  // ── The general-ledger period lock (plans/money/tasks/10-the-poster.md §3) ──────────────
  //
  // `'2026-07'` closes July and everything before it; empty/unset means nothing
  // is closed yet. `packages/lib/src/postings/periods.ts` owns the comparison
  // (`isPeriodLocked` / `assertPeriodOpen`) and takes the lock as an argument;
  // `postings/period-lock.ts` is the one place that turns this row into that
  // argument.
  //
  // NOTE: there is no pattern validation on a `TEXT` setting. `FieldOptions` has
  // no such member, so the shape is NOT enforced here. `resolvePeriodLock`
  // therefore validates on read and fails CLOSED: a value that is not `YYYY-MM`
  // throws rather than degrading to "nothing is closed", because the degraded
  // reading would let an entry into a month an accountant has already filed.
  //
  // Scoped `DOCUMENTS` to match its nearest neighbour, the GL posting switch
  // directly above. There is no LEDGER or ACCOUNTING member in the `SettingScope`
  // pg enum and adding one is a Drizzle migration this task deliberately does not
  // carry, exactly as the `manufacturing.*` block below says of MANUFACTURING.
  'ledger.lockedThroughMonth': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'TEXT',
    // Null, not `''`: nothing has been closed until an accountant says so, and a
    // default that locked anything would refuse the first entry ever posted.
    defaultValue: null,
    description:
      'The last accounting month closed to new general-ledger postings, YYYY-MM. ' +
      'Postings into that month or earlier are refused. Unset = nothing is closed.',
  },

  // ── Accounting setup / opening baseline (plans/money/tasks/12-accounting-setup.md §2) ───
  //
  // The opening baseline every organization needs before it can close its first
  // month. Task 12 builds the wizard that WRITES these; `postings/opening-baseline.ts`
  // is the reader that consumes them.
  //
  // Flat scalar keys, NOT one `JSON` blob. `fieldType: 'JSON'` exists, but its
  // users are the `sidebar.*` keys — UI-state blobs written by code, not forms.
  // This is a form, so its precedent is `documents.invoice.*` and
  // `manufacturing.*`: sibling scalars get `normalizeSettingValue` validation and
  // `SettingsFieldRow` rendering for free, and the catalog stays the schema of
  // record instead of a hand-rolled `v:` field.
  //
  // Scoped GENERAL, following the `manufacturing.*` precedent above: there is no
  // ACCOUNTING value in the `SettingScope` pg enum (`_shared.ts:520` — thirteen
  // values, none of them) and adding one is a Drizzle migration this phase
  // deliberately does not carry.
  //
  // 🛑 Every value below ships NULL except `setupState`. A null opening balance
  // means "not configured" and must never collapse to `0` — `0` is a legitimate
  // opening balance (a business with no WIP at cutover has exactly that), so the
  // two readings are not interchangeable. This is the same rule
  // `loadAbsorptionRates` follows for the absorption rates, and for the same
  // reason: a null read as zero absorbs nothing while looking like it worked.
  // `readOpeningBaseline` fails CLOSED on a null rather than defaulting.
  //
  // ⚠️ `CURRENCY` values here are integer MINOR units, and the catalog cannot
  // enforce that: `normalizeSettingValue` routes `CURRENCY` through
  // `fieldValueSchemas.number`, which only rejects a non-finite number. So
  // `12.5` would be accepted on write. `readOpeningBaseline` therefore validates
  // integrality itself on read, the same way `resolvePeriodLock` validates the
  // `TEXT` period lock the catalog cannot pattern-check.

  // 🛑 THE GATE ON THE WHOLE BASELINE. `readOpeningBaseline` refuses unless this
  // reads `finalized`, so a half-filled wizard cannot value a journal entry.
  //
  // The opening baseline and book timezone also freeze at the first accounting
  // claim, because changing either rewrites the arithmetic behind an entry that
  // has already posted. That gate is an ordinary "does a posting exist" check,
  // NOT a row lock — an earlier design took `SELECT … FOR UPDATE` on this row
  // inside the posting transaction and it was dropped deliberately. It is
  // technically race-able and the race is accepted: it needs two actors inside
  // the same few hundred milliseconds of a once-a-month operation, and the
  // claimed entry records the baseline it actually used in `assertions.before`
  // on its draft envelope, so the outcome is discoverable in the ledger rather
  // than silent. The ledger is the audit trail; a lock is not the only thing
  // that can be one.
  'accounting.setupState': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    // The only key with a non-null default: an organization that has never
    // opened the wizard is genuinely in `draft`, and every posting path refuses
    // until it says `finalized`.
    defaultValue: 'draft',
    options: {
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'finalized', label: 'Finalized' },
      ],
    },
    description:
      'Whether the accounting opening baseline has been finalized. Postings are refused ' +
      'while it is draft. Posting is refused until this reads finalized.',
  },
  // Parsed by `postings/periods.ts`'s `parsePeriodKey` and required to be a
  // MONTH key. As with `ledger.lockedThroughMonth`, there is no pattern
  // validation on a `TEXT` setting — `FieldOptions` has no such member — so the
  // shape is validated on read, and fails closed.
  'accounting.cutoffPeriod': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'The last month closed in the previous accounting system, YYYY-MM. Subledger activity ' +
      'after it values the general ledger; the opening balances cover everything before it.',
  },
  // 🛑 NO UTC FALLBACK. `periodKeyForDate` defaults to UTC because its callers
  // have already normalized; this setting has no such caller. A receipt logged
  // at 7pm on January 31 in `America/New_York` is already February 1 in UTC, so
  // an org whose zone was quietly assumed posts a month's edge activity into the
  // wrong period — invisible except at a close, and uncorrectable once the
  // period is locked. Unset fails closed.
  'accounting.bookTimeZone': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'The IANA timezone the books are kept in, e.g. America/New_York. Period keys are ' +
      'derived in it. Unset refuses to post rather than assuming UTC.',
  },

  // The frozen auxx.ai snapshot: the December 31 physical count valued at
  // CPA-approved costs. This is the valuation layer that intentionally uncosted
  // historical movements cannot supply, and it is what `readOpeningBaseline`
  // returns. Integer minor units.
  'accounting.openingRawMaterials': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      'Opening 1310 Raw Materials balance at the cutoff, integer minor units, from the ' +
      'December 31 physical count at CPA-approved costs. Unset = not configured, not zero.',
  },
  'accounting.openingWip': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      'Opening 1320 Work in Process balance at the cutoff, integer minor units. Typically 0 ' +
      'at cutover. Unset = not configured, not zero.',
  },
  'accounting.openingFinishedGoods': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      'Opening 1330 Finished Goods balance at the cutoff, integer minor units, from the ' +
      'December 31 physical count at CPA-approved costs. Unset = not configured, not zero.',
  },

  // The provider's side of the same three balances, plus the reference to the
  // journal entry that booked them there. Existing QuickBooks organizations are
  // the primary case, so the wizard IMPORTS rather than assumes — and neither
  // number silently overrides the other. The wizard shows the difference and
  // refuses to finalize until they agree: a difference falling into January's
  // balancing plug would classify a cutover problem as January COGS, and the
  // auxx.ai number alone would let the provider and the subledger disagree
  // silently from day one.
  //
  // ⚠️ These are PROVENANCE. `readOpeningBaseline` deliberately does not read
  // them — the reconciliation is the wizard's gate, and once it passes there is
  // one agreed set of balances, which is the `accounting.opening*` set above.
  'accounting.qboOpeningRawMaterials': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      "The accounting provider's opening raw-materials balance at the cutoff, integer minor " +
      'units. Reconciled against the auxx.ai snapshot before setup can be finalized.',
  },
  'accounting.qboOpeningWip': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      "The accounting provider's opening work-in-process balance at the cutoff, integer minor " +
      'units. Reconciled against the auxx.ai snapshot before setup can be finalized.',
  },
  'accounting.qboOpeningFinishedGoods': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      "The accounting provider's opening finished-goods balance at the cutoff, integer minor " +
      'units. Reconciled against the auxx.ai snapshot before setup can be finalized.',
  },
  // Not a `GlPosting`. The opening entry was built and booked in the provider,
  // its retained-earnings leg uses an account the default chart deliberately
  // does not seed, and `month_end_inventory` would be a false posting type for a
  // zero-line sentinel auxx.ai never posted. So the link is a reference string.
  'accounting.qboOpeningJournalRef': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'Reference to the opening journal entry in the accounting provider, for audit trail. ' +
      'Not an auxx.ai posting — auxx.ai did not book it.',
  },

  // Who finalized the baseline and when. Written by the wizard's finalize step,
  // not by a form field.
  'accounting.setupFinalizedAt': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'DATETIME',
    defaultValue: null,
    description:
      'When the accounting opening baseline was finalized, ISO 8601. Stamped by the wizard; ' +
      'not a user-facing field.',
  },
  'accounting.setupFinalizedByUserId': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'The user who finalized the accounting opening baseline. Stamped by the wizard; not a ' +
      'user-facing field.',
  },

  // ── Where payments land (plans/accounting/tasks/06-deposit-grouping.md §2.3) ──
  //
  // 🛑 **Three rails get three treatments, and getting one wrong silently
  // breaks bank matching for every payment on it.** A cheque is banked in a
  // batch and arrives at the bank as one line among several, so it must sit in
  // `undeposited_funds` until a deposit groups it. An ACH arrives alone and
  // matches its own bank line, so it goes straight to cash. A card settles as a
  // NET payout days later, so it goes to a clearing account and the payout
  // entry drains it. Post a cheque straight to cash and the account is right in
  // total and wrong line by line - which is exactly the state in which nothing
  // reconciles and nobody can say why.
  //
  // Declared once, per METHOD, rather than inferred per payment: the rule is a
  // property of the rail, and `PaymentMethod` (`money/types.ts`) is the enum
  // that names it. `resolvePaymentRoute` in `money/bank-deposits/route.ts` is
  // the single reader.
  //
  // ⚠️ `other` defaults to `undeposited_funds` on purpose. It is the unknown
  // rail, and undeposited funds is the SAFE unknown: money sits visible in a
  // clearing account until somebody banks it, rather than being asserted into
  // cash the bank has never seen.
  'accounting.paymentRoute.cash': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'undeposited_funds',
    options: { options: [...PAYMENT_ROUTE_SETTING_OPTIONS] },
    description:
      'Where a cash payment lands in the ledger. Cash is banked in a run, so it defaults to ' +
      'undeposited funds and reaches cash only when a bank deposit groups it.',
  },
  'accounting.paymentRoute.check': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'undeposited_funds',
    options: { options: [...PAYMENT_ROUTE_SETTING_OPTIONS] },
    description:
      'Where a cheque payment lands. Five cheques banked together are ONE bank line, so a ' +
      'cheque must group through undeposited funds or it can never be matched.',
  },
  'accounting.paymentRoute.card': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'clearing',
    options: { options: [...PAYMENT_ROUTE_SETTING_OPTIONS] },
    description:
      'Where a card payment lands. A card settles as a net payout, so it goes to a clearing ' +
      'account that the payout entry drains. Never to undeposited funds.',
  },
  'accounting.paymentRoute.bank': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'cash',
    options: { options: [...PAYMENT_ROUTE_SETTING_OPTIONS] },
    description:
      'Where an ACH or wire payment lands. It arrives alone and matches its own bank line, ' +
      'so it goes straight to cash and is never grouped.',
  },
  'accounting.paymentRoute.other': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'undeposited_funds',
    options: { options: [...PAYMENT_ROUTE_SETTING_OPTIONS] },
    description:
      'Where a payment of any other method lands. Defaults to undeposited funds: the safe ' +
      'unknown is money visible in a clearing account, not cash the bank has never seen.',
  },

  // ── Remembered statement-import column mappings ────────────────────────────
  //
  // Keyed by the SIGNATURE of a file's header row (`banking/import/
  // header-signature.ts`), which is what replaces the bank plan's per-bank
  // `BankCsvProfile`: no CSV standard exists, every bank invents its own
  // columns, and shipping profiles for two banks would serve two banks. A
  // mapping remembered against the header row a person already mapped serves
  // the long tail from the first upload.
  //
  // ⚠️ Written by code, never by a form. `banking.importMappings` is a prefill
  // of the job's own `ImportMappingProperty` rows, not a second authority for
  // them - the replay goes through `dataImport.saveColumnMapping`, the same
  // procedure the wizard's mapping step calls.
  'banking.importMappings': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: {},
    description:
      'Column mappings remembered per statement-file header signature, so the next upload of ' +
      'the same export prefills instead of asking again.',
  },

  // ── Manufacturing absorption rates (plans/products/build/01-build-plan.md §1.4) ─────────
  //
  // Per-UNIT, not per-hour: the merchant supplies a percentage split of a
  // payroll total, not timesheets, so there are no routings, work centres or
  // labour tickets behind these two numbers.
  //
  // 🛑 Both SHIP EMPTY (`null`). The actual figures are still open (build
  // README §5 Q3), and nothing reads them until `rollStandardCost` lands in
  // phase 1 — at which point a NULL rate must read as "no absorption", never as
  // zero-by-accident. Scoped GENERAL like the other org-wide operational
  // numbers; there is no MANUFACTURING value in the `SettingScope` pg enum and
  // adding one would need a Drizzle migration this phase deliberately does not
  // carry.
  //
  // ⚠️ Conversion cost applies only to a `subassembly` or `finished_good`
  // (README B11). Applying these rates to a purchased `component` capitalises
  // labour that was never spent and overstates 1310 Raw Materials.
  'manufacturing.assemblyLaborCostPerUnit': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      'Absorbed direct labour per assembled unit, integer minor units: ' +
      '(annual payroll x assembly%) / expected annual units. Unset = no labour absorption.',
  },
  'manufacturing.overheadCostPerUnit': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CURRENCY',
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    defaultValue: null,
    description:
      'Applied overhead per assembled unit, integer minor units: total annual factory ' +
      'overhead / expected annual units. Unset = no overhead absorption.',
  },
  // ⚠️ A FIRST standard only. `ensureStandardCost` writes exclusively where
  // `part_standard_cost IS NULL`, so this can never restate a part that already
  // has a standard: a supplier price change moves `part_cost` (live replacement
  // cost) and leaves the standard where the last roll put it. Re-valuing on-hand
  // inventory stays the manual roll's job
  // (plans/money/tasks/15-costing-usability.md §1 and §2a).
  //
  // On by default: without it a newly priced part shows "Not rolled" next to
  // every action that refuses without a standard, which is the state 205 of 206
  // parts in the dev org were found in. An org running a strict standard-cost
  // discipline turns it off and keeps rolling by hand.
  'manufacturing.autoRollFirstStandard': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: true,
    description:
      'When on, adding or changing a supplier price gives an unvalued part (and its parents) ' +
      'a first standard cost. It only ever sets a standard that is missing, and never ' +
      'overwrites one that already exists.',
  },

  // ── Order-triggered auto-build (plans/products/12-order-triggered-build.md §5.4) ────────
  //
  // Scoped GENERAL, following the `manufacturing.*` precedent directly above:
  // there is no INVENTORY value in the `SettingScope` pg enum and adding one is
  // a Drizzle migration this phase does not carry. The enum's existing
  // `INVENTORY_BRIDGE` member is NOT reused — it is the dead scope of the v9
  // bridge deleted in #1941, and naming the bridge's replacement after the
  // bridge is worse than a generic scope.
  'inventory.autoBuildFromOrders': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    // Off by default. Turning it on starts production automatically, which is a
    // business decision nobody should acquire by upgrading.
    defaultValue: false,
    description:
      'When on, creating an order raises a planned build for each ordered part that has a ' +
      'bill of materials.',
  },
  // 🛑 Written by the settings write path, not by a form: flipping
  // `inventory.autoBuildFromOrders` on stamps this with the moment it happened
  // (AB8). Orders placed before it are never built — without it, switching this
  // on against a Shopify back-fill fires a build for every historical order at
  // once. Re-stamped on every off->on transition, so a switch turned off for
  // three months does not reopen those three months when it comes back.
  'inventory.autoBuildEnabledAt': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'DATETIME',
    defaultValue: null,
    description:
      'When auto-build was last switched on, ISO 8601. Orders placed before it are never ' +
      'built. Stamped automatically; not a user-facing field.',
  },
  // ⚠️ ONE legal value today, on purpose (AB5). A planned build writes no stock
  // movements, which is what lets this trigger ship before a single standard
  // cost has been rolled. `completed` becomes selectable in phase 4, once
  // `part_kind` is set on the parts that are actually built — offering it now
  // would abort `completeBuild` on the first auto-run, on every order.
  'inventory.autoBuildStatus': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'planned',
    options: { options: [{ value: 'planned', label: 'Planned' }] },
    description: 'The status an automatically raised build lands in.',
  },
  // 🛑 The DEFAULT is the safe value (AB4). `all_stock_levels` builds a lift that is already
  // crated on the shelf, which gives you two lifts and one order.
  'inventory.autoBuildStockRule': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'out_of_stock_only',
    options: {
      options: [
        { value: 'out_of_stock_only', label: 'Out of stock only' },
        { value: 'all_stock_levels', label: 'All stock levels' },
      ],
    },
    description:
      'Whether an auto-build is raised for a part whose quantity on hand already covers the ' +
      'ordered quantity.',
  },
} satisfies Record<string, SettingConfig>

/**
 * Every valid setting key, derived from {@link SETTINGS_CATALOG} so it can
 * never drift from the definitions.
 */
export type SettingKey = keyof typeof SETTINGS_CATALOG

/** Narrow an arbitrary string to a known {@link SettingKey}. */
export function isSettingKey(value: string): value is SettingKey {
  return value in SETTINGS_CATALOG
}

// packages/lib/src/settings/catalog.ts
// Code-declared catalog of every org/user setting. Entries are FieldType/FieldOptions-shaped
// so the write path reuses the field-value validation machinery (`normalizeSettingValue`) and
// the frontend can render any setting with the generic `FieldInputAdapter`. See
// plans/settings/v2/README.md for the full design.

import type { FieldType } from '@auxx/database/types'
import type { FieldOptions } from '../custom-fields/field-options'
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

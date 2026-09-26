// packages/lib/src/settings/catalog.ts
// Code-declared catalog of every org/user setting. Entries are FieldType/FieldOptions-shaped
// so the write path reuses the field-value validation machinery (`normalizeSettingValue`) and
// the frontend can render any setting with the generic `FieldInputAdapter`. See
// plans/settings/v2/README.md for the full design.

import type { FieldType } from '@auxx/database/types'
// The fiscal-year months are owned by the module that consumes them. `reports/fiscal-year.ts` is pure and
// already client-safe (`postings/client.ts` exports `fiscalYearStart`), so the
// months live beside the function that consumes them rather than in a split-out
// file of their own.
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
} from '../accounting/reports/fiscal-year'
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

  // ── QuickBooks general-ledger posting (plans/auxx-lift/gap-b-execution-plan.md) ─────────
  //
  // The two settings keys that used to configure the invoice document mirror (plan
  // 37e, "P1") were deleted 2026-09-10: the mirror was retired on MK's decision
  // (accounting brief 14's DECIDED block), not as cleanup. This is now the only
  // QuickBooks export switch, and auxx composes journal entries and this is what
  // pushes them.
  // Plan 67 §5.5: this switch now gates every native object type (Sales
  // Receipt, Invoice, Payment, Credit Memo, Refund Receipt, Deposit, Bill),
  // not only journal entries - renaming it to an export-wide switch is a
  // follow-up, not done here.
  'quickbooks.postJournalEntries': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'When on, accrual summaries are posted to the QuickBooks general ledger as journal entries.',
  },

  // ── The general-ledger period lock (plans/money/tasks/10-the-poster.md §3) ──────────────
  //
  // `'2026-07'` closes July and everything before it; empty/unset means nothing
  // is closed yet. `packages/lib/src/accounting/ledger/periods/periods.ts` owns the comparison
  // (`isPeriodLocked`) and takes the lock as an argument;
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
      'Reviewed through: the last accounting month marked reviewed, YYYY-MM. ' +
      'Later postings into it are listed on Closeout. Unset = nothing is reviewed.',
  },

  // ── Accounting setup / opening baseline (plans/money/tasks/12-accounting-setup.md §2) ───
  //
  // The accounting setup. Scoped GENERAL, following the `manufacturing.*` precedent:
  // there is no ACCOUNTING value in the `SettingScope` pg enum.

  // The gate every posting path reads; written only by `finalizeAccountingSetup`.
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
  // Written once by `ensureGuestContact` (task 79 §4.1) and read on every order
  // create, so it is a cached `orgSettings` hit rather than a query.
  'accounting.guestContactId': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'The `contact` instance standing in as the customer on an order that has none — one ' +
      'system record per org, minted when accounting is provisioned. Unset leaves guest ' +
      'orders customerless, the way they were before.',
  },

  // 🔑 A DEFAULT, unlike the two keys above, and deliberately. January is what
  // every report assumed before this key existed, so an org that never touches
  // it reads exactly as it did. It is also not frozen after the first posting:
  // the cutoff and the timezone are frozen because they change a posted entry's
  // `txnDate`/`periodKey`, and this one touches no stored column at all — it
  // only moves where a READ splits prior years from this year
  // (`docs/accounting-architecture-guide.md` §12.1).
  'accounting.fiscalYearStartMonth': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: String(DEFAULT_FISCAL_YEAR_START_MONTH),
    options: { options: [...FISCAL_YEAR_START_MONTH_OPTIONS] },
    description:
      'The month the fiscal year starts in. Every report resets revenue and expense accounts ' +
      'at this boundary and rolls everything before it into retained earnings. Changing it ' +
      're-frames the reports; it rewrites no posted entry.',
  },

  // TARGET §3: gate 2, the export. `exportMode` and `exportModeCutover` decide
  // only the grain postings leave in; the books underneath are identical in
  // every mode. Read by `postings/export-settings.ts`'s `readExportSettings`.
  'accounting.exportMode': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'transaction',
    options: {
      options: [
        { value: 'transaction', label: 'Transaction' },
        { value: 'summary', label: 'Summary' },
      ],
    },
    description:
      'How postings leave for the accounting provider. Transaction sends one object per ' +
      'posting; Summary sends one object per period, store and payment rail. A switch applies ' +
      'to every posting not yet batched; a batch already built keeps the mode it was built in.',
  },
  'accounting.exportModeCutover': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      'Export from, YYYY-MM-DD. Postings dated before this date are never exported, in either ' +
      'mode.',
  },
  // Per avenue: off holds a posted entry's batch for release, on sends it on its own.
  'accounting.autoSend.fulfillment': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a fulfillment entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.receipt': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a customer receipt entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.refund': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a refund entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.creditMemo': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a credit memo entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.invoice': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send an invoice entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.expenseBill': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send an expense bill entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.payout': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a payout entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.bankDeposit': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a bank deposit entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.journal': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a journal entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.vendorPayment': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'Send a vendor payment or vendor refund entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.vendorCredit': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send a vendor credit entry to the provider as soon as it posts.',
  },
  'accounting.autoSend.inventory': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description: 'Send an inventory entry to the provider as soon as it posts.',
  },
  // Summary-mode grain, per avenue that has one. `payout`, `bankDeposit` and
  // `journal` are absent - TARGET §3 says they are inherently one object each.
  // A shipment never carries a payout id, so fulfillment offers no `payout` grain (101 E7).
  'accounting.summaryGrain.fulfillment': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
      ],
    },
    description: 'How many fulfillment postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.receipt': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many customer receipt postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.refund': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many refund postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.creditMemo': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many credit memo postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.invoice': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many invoice postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.expenseBill': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many expense bill postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.vendorPayment': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many vendor payment postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.vendorCredit': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many vendor credit postings roll into one Summary-mode export object.',
  },
  'accounting.summaryGrain.inventory': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'day',
    options: {
      options: [
        { value: 'day', label: 'One object per day' },
        { value: 'month', label: 'One object per month' },
        { value: 'payout', label: 'Payout (falls back to day until payout ids are stamped)' },
      ],
    },
    description: 'How many inventory postings roll into one Summary-mode export object.',
  },

  // Brief 19 section 4.6: provenance for the opening trial balance fill. Both
  // keys start with `accounting.opening`, so `isFrozenSetupSettingKey` freezes
  // them by PREFIX with no edit to `FROZEN_SETUP_SETTING_KEYS` - not a
  // coincidence to rely on quietly, which is why it is said here too.
  'accounting.openingSource': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: 'manual',
    description:
      'Whether the opening trial balance was typed by hand or suggested from a connected ' +
      'accounting provider. "Provider" means seeded from, not equal to: a person may edit ' +
      'every row afterward and this value does not change. Starts with accounting.opening, so ' +
      'it freezes by prefix once the ledger holds a standing entry.',
    options: {
      options: [
        { value: 'manual', label: 'Manual' },
        { value: 'provider', label: 'Provider' },
        { value: 'none', label: 'None' },
      ],
    },
  },
  // The decision, kept separate from `accounting.openingSource`'s provenance: a
  // business whose books begin at the cutover has no opening entry to make, and
  // an empty grid cannot tell that apart from one nobody has filled in yet.
  'accounting.openingFromNothing': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    defaultValue: false,
    description:
      'The organization declares it started trading at the cutoff and carries no opening ' +
      'balances. Suppresses the "nothing entered" refusal on the opening trial balance; an ' +
      'entered-but-unbalanced grid is still refused. Starts with accounting.opening, so it ' +
      'freezes by prefix once the ledger holds a standing entry.',
  },
  'accounting.openingSourceAsOf': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      "The date the connected accounting provider's balance sheet was read at, when the " +
      'opening trial balance was seeded from one (YYYY-MM-DD, the cutover date). Starts with ' +
      'accounting.opening, so it freezes by prefix the same way accounting.openingSource does.',
  },
  // Answered once on the opening inventory difference screen, after finalize (111 Q19), so it
  // is the one `accounting.opening*` key the setup freeze exempts (`FROZEN_SETUP_SETTING_KEYS`).
  'accounting.openingInventoryInBooks': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'SINGLE_SELECT',
    defaultValue: null,
    options: {
      options: [
        { value: 'revaluation', label: 'It was on the old books, at a different value' },
        { value: 'opening_equity', label: 'It was never on the old books' },
      ],
    },
    description:
      'Where the inventory your parts describe stood on the old books at the cutover. ' +
      'Revaluation posts each opening inventory difference against Inventory Revaluation; ' +
      'Opening Balance Equity posts it against Opening Balance Equity. Unset refuses to post.',
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

  // ── How far the inbound provider sync has genuinely read (20 §7.3) ─────────
  //
  // The accounting firm posts December's depreciation in February. auxx's
  // December balance sheet is INCOMPLETE until the sync runs and restates it,
  // and then it silently changes. A statement that changes two months after the
  // reader last looked at it, with nothing on the page saying so, is the whole
  // trust problem brief 20 §7.3 names, so every statement of an org with a
  // connected provider renders this date, and says outright when its own range
  // ends after it.
  //
  // 🛑 **Written by `syncProviderLedger` ONLY, and only for a chunk that
  // actually succeeded.** It is not a preference and there is no truthful hand
  // edit of it: the value is a claim about what was read off another system,
  // and a person typing a later date makes every statement understate its own
  // incompleteness in the one direction that matters. That is why it is in
  // `setting.ts`'s `ROUTER_OWNED_ORG_SETTING_KEYS`. Unlike
  // `accounting.setupFinalizedAt`, which is also code-stamped but is read by
  // nothing that renders a number.
  //
  // ⚠️ **Deliberately NOT frozen.** `FROZEN_SETUP_SETTING_KEYS` freezes the
  // `accounting.opening` PREFIX plus five named keys, and this key is caught by
  // neither, and correctly so. Every other accounting setup key freezes once the
  // ledger holds an entry because a posted entry was computed from it; this one
  // is computed FROM the ledger, changes on every sync forever, and only ever
  // moves on an org that by definition holds postings. Freezing it would stop
  // the first sync after the first entry and leave the marker permanently
  // stale, which is the failure it exists to prevent.
  'accounting.providerSyncedThrough': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'TEXT',
    defaultValue: null,
    description:
      "The last date the connected accounting provider's general ledger was read through " +
      'without a refusal, YYYY-MM-DD. Stamped by the provider sync; a statement whose range ' +
      'ends after it is incomplete. Not a user-facing field.',
  },

  // ── The inbound sync's walk position and cadence (55 §4.4, §5.1) ───────────
  //
  // 🛑 **The `providerSync.` prefix is load-bearing, not a naming preference.**
  // `updateOrganizationSetting` takes `withAccountingCommitLock` - a per-org
  // advisory TRANSACTION lock - for every key starting `accounting.` or
  // `ledger.`. `SyncStateStore.save()` runs after EVERY slice, so an
  // `accounting.`-prefixed blob would grab the org-wide accounting lock at each
  // checkpoint and serialize the whole walk against every posting, acceptance
  // and close that org is doing while it runs. Neither key is caught by
  // `FROZEN_SETUP_SETTING_KEYS` (the `accounting.opening` prefix plus five
  // named keys), which is correct: both change on every run forever.
  'providerSync.state': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: null,
    description:
      "Where the inbound provider sync's walk is, plus the current and last run's counters. " +
      'Written by the sync after every slice and read by the sync panel; not a user-facing ' +
      'field. How far is VOUCHED for is a different value - accounting.providerSyncedThrough.',
  },
  // Registered ahead of its reader (unit 8) so the scheduler needs no catalog
  // change: nothing reads this key today.
  'providerSync.schedule': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'JSON',
    defaultValue: null,
    description:
      'Cadence for the inbound provider sync, a ScheduledTriggerConfig (workflows/cron-pattern). ' +
      'Null means the manual button is the only door. Nothing reads it yet.',
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
  // 111 D23/Q14. The settings write path keeps this and `inventory.autoBuildFromOrders`
  // mutually exclusive: turning one on turns the other off, and a batch asking for both is refused.
  'inventory.backflush': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'CHECKBOX',
    options: { variant: 'switch' },
    defaultValue: false,
    description:
      'When on, a nightly job writes one completed build per made part per day for whatever ' +
      'sales drove below zero. Cannot be on together with order-raised auto-builds: turning ' +
      'this on turns that off, and the reverse.',
  },
  // ── MRP planning (plans/mrp/08-implementation-plan.md §6) ─────────────────────────────
  // GENERAL for the same reason as `inventory.*` above: `SettingScope` has no INVENTORY value.
  'mrp.aduWindowDays': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 90,
    description: 'How many days of consumption history the plan averages to get daily usage.',
  },
  'mrp.defaultLeadTimeFactor': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: null,
    description:
      'Lead-time factor for parts without their own. Unset = automatic — derived from each ' +
      "part's lead-time class.",
  },
  'mrp.defaultVariabilityFactor': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: null,
    description:
      'Variability factor for parts without their own. Unset = automatic — derived from how ' +
      "much each part's consumption varies.",
  },
  'mrp.runRetentionDays': {
    scope: 'GENERAL',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 90,
    description: 'How many days of past plan runs are kept before they are deleted.',
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

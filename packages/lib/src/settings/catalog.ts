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
    description: 'Organization-wide currency code — consumed by CURRENCY display + totals docs',
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
    defaultValue: 'a4',
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
  'documents.invoice.dueDays': {
    scope: 'DOCUMENTS',
    access: 'org',
    fieldType: 'NUMBER',
    defaultValue: 30,
    description: 'Default number of days an invoice is due after issue (MI1 consumes)',
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

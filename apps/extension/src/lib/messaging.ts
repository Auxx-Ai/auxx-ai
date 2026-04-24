// apps/extension/src/lib/messaging.ts

import { z } from 'zod'

/**
 * Wire format for every message that crosses a context boundary
 * (page main world ↔ service worker ↔ iframe ↔ external auxx.ai tab).
 *
 * Adding a new message type means: add it to `ExternalMessageSchema`, then
 * handle the new variant in the relevant listener — TS will fail every
 * consumer that hasn't been updated.
 */

// ─── Operations the SW can ask the page to perform ─────────────
export const PageOperationSchema = z.enum([
  'showFrame',
  'hideFrame',
  'toggleFrame',
  'prewarm',
  'parseGmail',
  'parseLinkedIn',
  'parseLinkedInCompany',
  'parseSalesNavigator',
  'parseTwitterProfile',
  'parseTwitterSearch',
  'parseFacebook',
  'parseInstagramProfile',
])
export type PageOperation = z.infer<typeof PageOperationSchema>

// ─── Iframe → SW: forward an op to the active tab ──────────────
export const InvokeMessageSchema = z.object({
  type: z.literal('invoke'),
  operation: PageOperationSchema,
  args: z.array(z.unknown()).optional(),
})
export type InvokeMessage = z.infer<typeof InvokeMessageSchema>

// ─── SW → Iframe broadcast ─────────────────────────────────────
// Sent every time the panel becomes (or is requested to become) visible,
// so the iframe knows to re-parse against the current tab state instead
// of showing stale phase after SPA navigation.
export const PanelOpenedBroadcastSchema = z.object({
  type: z.literal('panelOpened'),
  tabId: z.number().optional(),
})
export type PanelOpenedBroadcast = z.infer<typeof PanelOpenedBroadcastSchema>

// Fired whenever `chrome.tabs.onUpdated` reports a URL change for a tab.
// SPA navigations (LinkedIn profile→profile via pushState) don't trigger
// a `status: 'loading'` reload, so the iframe would otherwise sit on the
// stale parse. On this broadcast the iframe bumps its reboot token and
// re-reads the active tab URL.
export const TabNavigatedBroadcastSchema = z.object({
  type: z.literal('tabNavigated'),
  tabId: z.number(),
  url: z.string(),
})
export type TabNavigatedBroadcast = z.infer<typeof TabNavigatedBroadcastSchema>

// ─── Content script → SW: dedup lookup ────────────────────────
// Lets in-page buttons flip to "Open in Auxx" state without pulling in the
// iframe tRPC client. SW proxies a single `record.lookupByField` query to
// auxx.ai with the extension's cookie jar; failure is silent (button just
// stays on "Add to Auxx").
export const LookupByFieldMessageSchema = z.object({
  type: z.literal('lookupByField'),
  entityDefinitionId: z.enum(['contact', 'company']),
  candidates: z.array(
    z.object({
      systemAttribute: z.enum(['external_id', 'primary_email', 'domain', 'company_domain']),
      value: z.string(),
    })
  ),
})
export type LookupByFieldMessage = z.infer<typeof LookupByFieldMessageSchema>

// ─── External (auxx.ai) → SW ───────────────────────────────────
// Only `version` today — auth state lives on the server and is fetched
// directly by the iframe via `/api/extension/session`.
export const ExternalMessageSchema = z.object({
  type: z.literal('version'),
})
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>

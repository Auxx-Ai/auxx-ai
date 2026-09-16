// packages/lib/src/ai/kopilot/capabilities/ledger/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { ACCOUNTING_LEDGER_PAGE } from './client'
import { createGetLedgerStatusTool } from './tools/get-ledger-status'

export { ACCOUNTING_LEDGER_PAGE } from './client'

/**
 * Ledger-console capability (`/app/accounting`).
 *
 * The console's module rail used to render four groups of live data - the
 * balance sweep and its duplicate findings, processor fee treatment per rail,
 * and what posted this month. None of them was an action, and a rail whose
 * content reads the same every day teaches people to stop looking at it. The
 * rail is now two nav items (Closeout, Sync queue); the numbers moved here,
 * where they are answered on demand instead of standing on screen.
 *
 * One tool, not four, deliberately: the four reads were four blocks of ONE
 * picture - "where do the books stand this month" - and splitting them into
 * four tool calls would make the model take four round trips to answer the
 * question anybody actually asks.
 */
export function createLedgerCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: ACCOUNTING_LEDGER_PAGE,
    tools: [createGetLedgerStatusTool(getDeps)],
    systemPromptAddition: (ctx) => buildPrompt(ctx),
    capabilities: ({ toolNames }) =>
      toolNames.has('get_ledger_status')
        ? [
            'Report where the books stand: balance, duplicate bank movements, processor fees, and what posted this month',
          ]
        : [],
  }
}

function buildPrompt({ toolNames }: SystemPromptAdditionContext): string {
  if (!toolNames.has('get_ledger_status')) return ''

  return [
    '## The ledger console',
    '',
    'The user is on the accounting ledger at `/app/accounting`, looking at ONE accounting month. The month is in the page toolbar and in the URL as `?month=YYYY-MM`; it is not bound into your context, so when a question is about "this month" and you do not know which, ask before guessing.',
    '',
    '`get_ledger_status` answers where the books stand. It is read-only: it posts nothing, closes no month and pushes nothing to a connected accounting system.',
    '',
    'State what it returns as facts, not as alarms. "0 discrepancies out of 412 postings checked" is the ordinary reading of healthy books; a payment rail that bills its fees separately and last booked one two months ago may simply bill quarterly. Never tell the user a month cannot be closed on the strength of this read - the close has its own refusals, and they are rendered on the page.',
    '',
    'A `null` figure means the question was not put (usually because no month was passed), never zero. Say so rather than reporting it as "none".',
  ].join('\n')
}

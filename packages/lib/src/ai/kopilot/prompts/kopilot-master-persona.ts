// packages/lib/src/ai/kopilot/prompts/kopilot-master-persona.ts

/**
 * Master Kopilot identity line. Static across all orgs and turns.
 *
 * The per-org capabilities list ("## What you can help with") is rendered
 * separately by `sections/master-capabilities.ts` so the identity line
 * stays in the tier-1 cache prefix. The shared `## House rules` lives in
 * `sections/house-rules.ts` and runs for every agent (master + user-authored).
 */
export const KOPILOT_MASTER_IDENTITY =
  'You are Kopilot, an AI assistant inside Auxx — an email-support and CRM platform.'

// packages/lib/src/ai/kopilot/capabilities/purchasing-intake/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { INTAKE_DRAFT_REF_KIND } from './tools/intake-session'
import { createProposeDraftTool } from './tools/propose-draft'
import { createResolveLinesTool } from './tools/resolve-lines'

/**
 * Page key for purchase-order intake — the resolve step of
 * `plans/money/tasks/38-purchase-order-from-a-document.md` §4.
 *
 * ⚠️ `registry.ts` warns that an unregistered page string "resolves to the same
 * set *by accident* and reads like scoping while doing nothing", so this one is
 * registered for real in `ai/agent-framework/effective-runtime.ts` — the
 * builder every autonomous/worker run resolves its tools from, which is where
 * the intake job runs (§3.3).
 */
export const PURCHASING_INTAKE_PAGE = 'purchasing.intake'

/**
 * The ONLY global tools this page keeps (§4.2's keep list).
 *
 * 🛑 This is an allow-list, applied through `excludeGlobalTools`' predicate
 * form, and that choice is deliberate. A deny-list of today's write tools is
 * correct only until the next global tool lands — and app-backed and MCP tools
 * also register under `__global__`, built at runtime from whatever the org has
 * installed, so no hand-written deny-list can name them at all. An intake run
 * inheriting an installed app's write tool is exactly the failure the strip
 * list exists to prevent.
 *
 * As of this writing the predicate strips, from the native global pool:
 *   writes    create_entity, update_entity, bulk_update_entity, create_note,
 *             create_task, upsert_learned_article
 *   mail      find_threads, get_thread_detail, list_drafts, list_tags,
 *             reply_to_thread, start_new_conversation, update_thread
 *   tasks     list_tasks
 *   history   list_notes, list_field_changes, get_entity_history,
 *             list_transcripts_for_entity, get_transcript
 *   directory list_members, list_groups
 *   knowledge search_docs, search_knowledge, get_article, list_articles
 *   chat UX   suggest_replies, plan_create, plan_update_step
 * plus every app- and MCP-backed tool. `getExcludedGlobalToolNames(page)`
 * reports the live answer; this list is the reader's summary, not the source.
 */
export const PURCHASING_INTAKE_KEPT_GLOBAL_TOOLS: ReadonlySet<string> = new Set([
  // §5.1's vendor match, and the model's own look at a candidate part.
  'search_entities',
  // The validated filter grammar over the shared operator catalog — every tier
  // is expressible in it, which is why three bespoke read tools were deleted.
  'query_records',
  'get_entity',
  'list_entities',
  'list_entity_fields',
])

/**
 * Page capability for reading a vendor's quote into a drafted purchase order.
 *
 * Two tools, because the globals already do the rest (§4.2): `search_entities`
 * and `query_records` cover vendor lookup and catalogue reads, so the three
 * wrappers the first draft of the brief declared — `search_parts`,
 * `get_vendor_catalogue`, `resolve_vendor` — were deleted rather than built.
 * What survives earns its place on batching and provenance, not on the query.
 *
 * 🛑 The load-bearing property of this page is that **the model never performs a
 * write**. It reads a document and calls tools that answer questions; the one
 * tool that persists anything persists a draft that no downstream code reads
 * until a person presses a button (§2). `excludeGlobalTools` is what holds that
 * up — without it the page inherits `create_entity` / `update_entity` and the
 * model can write records outside the draft.
 *
 * The draft rides in the session refs as an `intakeDraft` reference, exactly the
 * way `agents-builder` carries its `agent`, so no tool takes a draftId argument
 * that could be aimed at another org's draft (§4.1).
 */
export function createPurchasingIntakeCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: PURCHASING_INTAKE_PAGE,
    tools: [createResolveLinesTool(getDeps), createProposeDraftTool(getDeps)],
    excludeGlobalTools: (toolName: string) => !PURCHASING_INTAKE_KEPT_GLOBAL_TOOLS.has(toolName),
    systemPromptAddition: INTAKE_PROMPT,
    capabilities: [
      "Read a vendor's quote into a drafted purchase order — vendor matched, lines matched to parts",
    ],
  }
}

const INTAKE_PROMPT = `## Reading a vendor quote

You are turning one vendor document into a DRAFT purchase order. Nothing you do
creates a purchase order: a person reviews the draft and presses the button.

The document has already been transcribed onto the draft in session context
(reference kind \`${INTAKE_DRAFT_REF_KIND}\`). Do not re-read or re-type what it
printed — descriptions, quantities, prices, totals and quantity breaks are on the
draft and are read from there.

Work in three steps:

1. **The vendor.** Call \`search_entities\` against COMPANIES with the company name
   from the quote. A purchase order is placed with an organisation, never a
   person, so the vendor is a company record and never a contact. If that returns nothing, try the email domain. Read the
   candidates and pick one; a single value that a human confirms on the review
   screen is the one place your judgement beats a ladder.

2. **The lines.** Call \`resolve_lines\` ONCE with the whole quote and the vendor
   you picked. It runs the deterministic ladder and returns a tier per line.
   \`vendor_sku\` and \`sku\` link on their own; \`fuzzy\` never does, and \`none\`
   means nothing matched. Do not second-guess a tier by issuing your own
   \`query_records\` searches — the tier is what the review screen shows as the
   reason a line linked, and a link you made by hand records nothing.

3. **The draft.** Call \`propose_draft\` last, once. Supply only decisions: the
   vendor, a part for a line you resolved yourself, a \`foldedInto\` for a line
   that is not an ordered part, a price break index. It ends the turn.

Freight, small-order surcharges, tooling and packaging are NOT purchase order
lines — a line needs a part, and inventing a part called "Freight" puts a fiction
in the catalogue. Fold them into \`shipping\` or \`tax\` instead.

A line you cannot resolve is a normal outcome, not a failure. Leave it
unresolved, and say in your reply which lines need a person. Never invent a part,
never guess a price, and never reconcile the vendor's printed total against the
sum of their lines — if those disagree, that disagreement is shown, not fixed.`

export { INTAKE_DRAFT_REF_KIND } from './tools/intake-session'

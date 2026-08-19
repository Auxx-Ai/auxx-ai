// packages/lib/src/ai/kopilot/prompts/sections/block-catalog.ts

import type { AgentSurface } from '../../../../agents/client'
import { INTERACTIVE_ONLY, type PromptSection } from './types'

const BUILDER_SURFACE: ReadonlySet<AgentSurface> = new Set(['builder'])

/**
 * Rich-block catalog section. Schemas sourced from a specific tool
 * (e.g. `auxx:draft-list` needs `list_drafts`; `auxx://doc/<slug>` needs
 * `search_docs`/`search_knowledge`; `auxx:app-install` needs the
 * `notInstalled` array `list_app_blocks` returns) are dropped when those tools aren't
 * resolved for this turn — otherwise the model is invited to emit blocks
 * it can't populate.
 *
 * `auxx:*` fences and `auxx://` links only render in the in-app builder
 * renderer, so this is gated to the `builder` surface — it never reaches a
 * chat (plain-text) or email turn, where it would contradict the medium's
 * formatting rule.
 */
export const blockCatalog: PromptSection = {
  id: 'block-catalog',
  modes: INTERACTIVE_ONLY,
  surfaces: BUILDER_SURFACE,
  stability: 'static',
  render: (ctx) => {
    const has = (name: string) => ctx.toolNames.has(name)
    const hasDrafts = has('list_drafts')
    const hasDocs = has('search_docs') || has('search_knowledge')
    const hasAppBlocks = has('list_app_blocks')

    const draftListSchema = hasDrafts
      ? `

#### \`auxx:draft-list\`
\\\`\\\`\\\`auxx:draft-list
{"draftIds": ["thread:<threadId>", "draft:<draftId>"]}
\\\`\\\`\\\`
- IDs come from \`list_drafts\` only. \`thread:\` rows open the thread; \`draft:\` rows open the composer.`
      : ''

    const appInstallSchema = hasAppBlocks
      ? `

#### \`auxx:app-install\`
\\\`\\\`\\\`auxx:app-install
{"appSlug": "ups"}
\\\`\\\`\\\`
- Offers an app this workspace has NOT installed. Emit it when a capability the user asked for shows up in \`list_app_blocks\`' \`notInstalled\` — name in prose what the app would give them, then one block per app.
- \`appSlug\` is copied verbatim from a tool result. Never invent one: a slug that is not in the catalog renders as unavailable instead of an install button.
- Installing is the user's click, not your action. Say what the app unlocks and stop there; do not report it as installed or build on it.`
      : ''

    const docInlineExample = hasDocs ? `\n  [Connect Gmail](auxx://doc/<slug>)` : ''
    const docInlineNote = hasDocs
      ? `For docs, use the \`slug\` from \`search_docs\` or the \`docSlug\` from \`search_knowledge\`.`
      : ''

    const draftListFenceMention = hasDrafts
      ? `, \`auxx:thread-list\`, \`auxx:task-list\`, \`auxx:draft-list\``
      : `, \`auxx:thread-list\`, \`auxx:task-list\``

    return `## Rich Blocks

Embed UI cards in your final reply as fenced code blocks with an \`auxx:<type>\` tag. The fence JSON carries only IDs copied verbatim from tool results — the server fills in display data. Never re-type record content. The \`auxx:<type>\` language tag is mandatory; a bare fence renders as code. Empty results go in prose, not an empty block. Read tools return data for you to reason over — they don't render UI. Write tools surface their outcome through their own approval card; don't re-embed a block for the action.

**Syntax:**
\\\`\\\`\\\`auxx:<type>
<valid JSON with IDs from tool results>
\\\`\\\`\\\`

### ID format

A \`recordId\` is the literal \`recordId\` from a tool result: \`<entityDefinitionId>:<entityInstanceId>\` — one colon, two segments. Example: \`"i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du"\`. Never prepend an apiSlug, label, or other prefix.

\`threadId\` and \`taskId\` are single opaque strings (no colon).

**Inline \`@[…]\` chip references are not recordIds.** Prompts and agent personas may contain flattened chips of the form \`[reference](<id>)\` where \`<id>\` is one of:

- \`entity:<entityDefinitionId>\` — a record *type*, not an instance. \`entity:ticket\` means "a ticket record" (whichever one is in context), not a specific ticket id.
- \`field:<entityDefinitionId>:<fieldId>\` — a field on an entity type (e.g. \`field:ticket:status\`). Use \`list_entity_fields\` to get the real field ids. Path form for relationship traversals: \`field:<rootDef>:<rootField>::<targetDef>:<targetField>\`.
- \`tool:<name>\` — a tool by name, e.g. \`tool:get_thread_detail\`.

Never pass \`entity:…\`, \`field:…\`, or \`tool:…\` strings where a recordId is expected. Real recordIds have no prefix word — just two opaque segments separated by one colon.

### Block schemas

#### \`auxx:entity-list\`
\\\`\\\`\\\`auxx:entity-list
{"recordIds": ["<defId>:<instId>", "<defId>:<instId>"]}
\\\`\\\`\\\`
- Default for any list of records. For a single record, use \`auxx:entity-card\`.
- Filter to what you actually mean — don't dump tangential search matches.

#### \`auxx:entity-card\`
\\\`\\\`\\\`auxx:entity-card
{"recordId": "<defId>:<instId>"}
\\\`\\\`\\\`

#### \`auxx:thread-list\`
\\\`\\\`\\\`auxx:thread-list
{"threadIds": ["<threadId>", "<threadId>"]}
\\\`\\\`\\\`

#### \`auxx:task-list\`
\\\`\\\`\\\`auxx:task-list
{"taskIds": ["<taskId>", "<taskId>"]}
\\\`\\\`\\\`${draftListSchema}

#### \`auxx:plan-steps\`
\\\`\\\`\\\`auxx:plan-steps
{"steps": [{"label": "Step", "status": "running", "detail": "optional"}]}
\\\`\\\`\\\`
- Mirror the latest plan from \`plan_create\` / \`plan_update_step\` verbatim. Status: \`pending\` | \`running\` | \`completed\` | \`failed\`. No step ids in the fence.

#### \`auxx:table\`
Use only for (a) side-by-side comparison of 2–3 records (one column per record, one row per field) or (b) ad-hoc tabular data that isn't a record list. Plain record lists use \`auxx:entity-list\`.
Schema: \`{ columns: [{label, align?}], rows: [[{text, recordId?, type?, actorId?, tags?, href?}]] }\`. Every cell needs \`text\`. \`type\`: \`date\` | \`tags\` | \`email\` | \`phone\` | \`currency\` | \`number\`. Max ~20 rows.${appInstallSchema}

### Inline references — \`auxx://\` links

Inside running prose, link a single record/actor/thread/task as a markdown link with an \`auxx://\` href:

  [Robert Miller](auxx://record/<defId>:<instId>)
  [Markus Klooth](auxx://actor/user:<userId>)
  [Support Team](auxx://actor/group:<groupId>)
  [Re: Quick question](auxx://thread/<threadId>)
  [Follow up Friday](auxx://task/<taskId>)${docInlineExample}

IDs are the same verbatim values used in fences. ${docInlineNote}

- **Actor** (\`auxx://actor/user:<id>\` or \`group:<id>\`) = workspace teammate. **Record** (\`auxx://record/<defId>:<instId>\`) = CRM entity. A contact is a record, not an actor.
- Single mention in prose → inline link. Two or more → fence (\`auxx:entity-list\`${draftListFenceMention}).`
  },
}

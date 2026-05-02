// packages/lib/src/ai/kopilot/prompts/block-catalog.ts

export const BLOCK_CATALOG = `
## Rich Blocks

Inside your final reply, embed rich UI cards by writing fenced code blocks
with the \`auxx:<type>\` language tag. The fence JSON should contain only IDs
that came from tool results — the server fills in display data automatically.
Never re-type record subjects, field values, or other record content.

**Syntax:**
\\\`\\\`\\\`auxx:<type>
<valid JSON with IDs from tool results>
\\\`\\\`\\\`

### ID format (STRICT)

A \`recordId\` is the literal value of the \`recordId\` field from a tool
result — nothing more, nothing less. Format: \`<entityDefinitionId>:<entityInstanceId>\`
— exactly **one** colon, **two** segments.

- ✅ CORRECT: \`"i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du"\`
- ❌ WRONG: \`"tickets:i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du"\` (apiSlug prefix)
- ❌ WRONG: \`"ticket:lk6jz2jsyiqwusswhrf187du"\` (label instead of entityDefinitionId)
- ❌ WRONG: \`"lk6jz2jsyiqwusswhrf187du"\` (missing entityDefinitionId)

The entity catalog's \`apiSlug\` and \`label\` are for TOOL ARGUMENTS only
(e.g. \`search_entities\`). They must NEVER appear inside a block's
\`recordId\` / \`recordIds\`. If a tool returned \`"recordId": "abc:xyz"\`,
copy exactly \`"abc:xyz"\` — do not re-prefix, re-wrap, or normalize.

\`threadId\` and \`taskId\` are single opaque strings (no colon). Copy
verbatim from tool results — never construct them.

### Block schemas

#### \`auxx:entity-list\`
\\\`\\\`\\\`auxx:entity-list
{"recordIds": ["<defId>:<instId>", "<defId>:<instId>"]}
\\\`\\\`\\\`
- Use for **two or more** records. For a single record, prefer \`auxx:entity-card\`.
- Filter intermediate search results to what you actually mean. Example: \`search_entities("Carolin Klooth")\` returns Carolin, Lutz, Christoph (all match on last name). If the user asked specifically about Carolin, emit \`auxx:entity-card\` with just Carolin's recordId — do NOT include Lutz or Christoph just because they were in the search payload.

#### \`auxx:entity-card\`
\\\`\\\`\\\`auxx:entity-card
{"recordId": "<defId>:<instId>"}
\\\`\\\`\\\`
- Use for a **single** record. For two or more, use \`auxx:entity-list\`.

#### \`auxx:thread-list\`
\\\`\\\`\\\`auxx:thread-list
{"threadIds": ["<threadId>", "<threadId>"]}
\\\`\\\`\\\`

#### \`auxx:task-list\`
\\\`\\\`\\\`auxx:task-list
{"taskIds": ["<taskId>", "<taskId>"]}
\\\`\\\`\\\`

#### \`auxx:table\`
Schema: \`{ columns: [{label, align?}], rows: [[{text, recordId?, type?, actorId?, tags?, href?}]] }\`.
\\\`\\\`\\\`auxx:table
{
  "columns": [
    {"label": "Field"},
    {"label": "Emily Garcia"},
    {"label": "Michael Williams"}
  ],
  "rows": [
    [{"text": "Status"}, {"text": "Active", "type": "tags", "tags": [{"label": "Active", "color": "green"}]}, {"text": "Churned", "type": "tags", "tags": [{"label": "Churned", "color": "red"}]}],
    [{"text": "Email"}, {"text": "emily@acme.com", "type": "email"}, {"text": "michael@globex.com", "type": "email"}]
  ]
}
\\\`\\\`\\\`
- Every cell needs \`text\`. Optional hints: \`recordId\`, \`href\`, \`actorId\`, \`type\` (\`date\`|\`tags\`|\`email\`|\`phone\`|\`currency\`|\`number\`), \`tags\`.
- Max ~20 rows. For larger sets, summarize in prose.

### Rules
- **The \`auxx:<type>\` language tag is mandatory** — a bare fence renders as code.
- **Copy IDs EXACTLY from tool results.** Never invent an ID.
- **One block per fence.** Blocks and prose can interleave freely.
- **Empty results go in prose,** not an empty block.

### Inline references — \`auxx://\` links

For lightweight references **inside prose** (a name in a sentence, not a list),
write a markdown link with an \`auxx://\` href. They render as inline chips
with hover-card previews and click-through:

  [Robert Miller](auxx://record/<defId>:<instId>)
  [Markus Klooth](auxx://actor/user:<userId>)
  [Support Team](auxx://actor/group:<groupId>)
  [Re: Quick question](auxx://thread/<threadId>)
  [Follow up Friday](auxx://task/<taskId>)
  [Connect Gmail](auxx://doc/<slug>)

The IDs are the **same verbatim values** you would put in a fence — for
records, the colon-joined \`<defId>:<instId>\` recordId from a tool result.
For actors, the verbatim \`actorId\` (\`user:<id>\` or \`group:<id>\`) from
any tool result that mentions an actor (Owner / Assignee / createdBy
fields, \`list_members\` / \`list_groups\` results). For threads and
tasks, the opaque id string. For docs, the \`slug\` from \`search_docs\`
results or the \`docSlug\` from \`search_knowledge\`. Copy verbatim —
never construct.

**Actor (\`auxx://actor/...\`) vs record (\`auxx://record/...\`).**
- \`actor\` is for **workspace members and groups** — people who use Auxx
  with you. ActorIds always start with \`user:\` or \`group:\`.
- \`record\` is for **CRM entity records** — contacts, companies, deals,
  tickets, products, etc. RecordIds are \`<defId>:<instId>\`.
- A "contact" is NOT an actor; link contacts as \`auxx://record/...\`. A
  workspace teammate is NOT a record; link them as \`auxx://actor/...\`.

**When to use inline links vs fences:**
- Mentioning a single record/thread/task **by name in running prose** → inline link.
- Listing 2+ records/threads/tasks → use a fence (\`auxx:entity-list\`, \`auxx:thread-list\`, \`auxx:task-list\`).
- Single record where the user wants a full preview card → \`auxx:entity-card\` fence.

Inline links read naturally:
"I drafted a reply to [Robert Miller](auxx://record/i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du) on the [pricing thread](auxx://thread/abc123); assigned the follow-up to [Markus](auxx://actor/user:JR28eYz582CHqZN5SFlVrEnXErXmunaj)."
`

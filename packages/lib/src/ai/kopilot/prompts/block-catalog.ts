// packages/lib/src/ai/kopilot/prompts/block-catalog.ts

export const BLOCK_CATALOG = `
## Rich Blocks

Inside \`submit_final_answer.content\`, embed rich UI cards by writing fenced
code blocks with the \`auxx:<type>\` language tag. The fence JSON should
contain only IDs that came from tool results — the server fills in display
data automatically. Never re-type record subjects, field values, or other
record content.

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
`

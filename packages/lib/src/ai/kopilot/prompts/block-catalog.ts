// packages/lib/src/ai/kopilot/prompts/block-catalog.ts

export const BLOCK_CATALOG = `
## Rich Blocks

You MUST embed rich UI components using fenced code blocks with the \`auxx:<type>\` language tag.
The language tag on the opening fence is REQUIRED — without it the frontend renders raw JSON.

**Syntax:**
\\\`\\\`\\\`auxx:<type>
<valid JSON>
\\\`\\\`\\\`

### Available block types

#### \`auxx:entity-list\` — List of entity records
Use when showing multiple records from search_entities or query_records results that contain recordIds. Do NOT use for count-only results (no recordIds) — present counts as plain text instead.
\\\`\\\`\\\`auxx:entity-list
[{"recordId": "defId:instId1"}, {"recordId": "defId:instId2"}]
\\\`\\\`\\\`

#### \`auxx:entity-card\` — Single entity record card
Use when referencing one specific record (contact, company, ticket).
\\\`\\\`\\\`auxx:entity-card
{"recordId": "entityDefinitionId:entityInstanceId"}
\\\`\\\`\\\`

#### \`auxx:thread-list\` — Email threads
Use when showing thread search results.
\\\`\\\`\\\`auxx:thread-list
[{"id": "...", "subject": "...", "status": "open|archived|spam|trash", "lastMessageAt": "ISO8601", "sender": "email", "isUnread": true, "messageCount": 3, "assigneeId": "...", "tagIds": ["..."]}]
\\\`\\\`\\\`

#### \`auxx:draft-preview\` — Email draft preview
ONLY use after draft_reply tool returned a result.
\\\`\\\`\\\`auxx:draft-preview
{"draftId": "...", "threadId": "...", "to": ["email"], "cc": ["email"], "body": "full draft body", "subject": "..."}
\\\`\\\`\\\`

#### \`auxx:kb-article\` — Knowledge base article
\\\`\\\`\\\`auxx:kb-article
{"id": "...", "title": "...", "excerpt": "first ~200 chars of article"}
\\\`\\\`\\\`

#### \`auxx:plan-steps\` — Execution plan summary
\\\`\\\`\\\`auxx:plan-steps
{"steps": [{"label": "Search for threads", "status": "completed|failed|running|pending", "detail": "optional result note"}]}
\\\`\\\`\\\`

#### \`auxx:action-result\` — Action confirmation
\\\`\\\`\\\`auxx:action-result
{"action": "assign_thread", "success": true, "summary": "Thread assigned to Sarah"}
\\\`\\\`\\\`

#### \`auxx:table\` — Data table
Use when presenting structured tabular data such as entity field comparisons, multi-record summaries, or query results with multiple columns.
Prefer entity-list when simply listing records. Use table when showing specific field values across columns.
Schema: single object with columns and rows.
\\\`\\\`\\\`
{
  "columns": [
    {"label": "Field"},
    {"label": "Emily Garcia"},
    {"label": "Michael Williams"}
  ],
  "rows": [
    [{"text": "Status"}, {"text": "Active", "type": "tags", "tags": [{"label": "Active", "color": "green"}]}, {"text": "Churned", "type": "tags", "tags": [{"label": "Churned", "color": "red"}]}],
    [{"text": "Assignee"}, {"text": "Sarah Chen", "actorId": "user:abc123"}, {"text": "—"}],
    [{"text": "Email"}, {"text": "emily@acme.com", "type": "email"}, {"text": "michael@globex.com", "type": "email"}]
  ]
}
\\\`\\\`\\\`
- Each cell is an object with \`text\` (required — display value for all cell types).
- Optional rich rendering hints (copy from tool result field metadata when available):
  - \`"recordId": "defId:instId"\` — clickable entity link. Copy from tool results — never fabricate.
  - \`"href": "https://..."\` — external link.
  - \`"actorId": "user:userId"\` — renders user/group avatar badge. Include \`text\` as fallback name.
  - \`"type": "date"\` — renders human-friendly date. Pass ISO string in \`text\`.
  - \`"type": "tags", "tags": [{"label": "Active", "color": "green"}]\` — renders colored badges.
  - \`"type": "email"\` — renders clickable mailto link.
  - \`"type": "phone"\` — renders clickable tel link.
  - \`"type": "currency"\` or \`"type": "number"\` — right-aligned formatting.
- When tool results include field metadata (type, actorId, tags, recordId), copy them into the cell object.
- For relationship fields with multiple records (\`recordIds\` array), create one cell per record using each \`recordId\`. Do NOT reuse the parent entity's recordId for relationship cells.
- \`columns[].align\` is optional, defaults to \`"left"\`. Options: \`"left"\`, \`"center"\`, \`"right"\`.
- Maximum ~20 rows. For larger result sets, summarize or paginate with text.

#### \`auxx:docs-results\` — Documentation search results
Use when presenting help center or developer documentation search results from search_docs.
\\\`\\\`\\\`auxx:docs-results
{"articles": [{"title": "Gmail Integration", "url": "https://docs.auxx.ai/help/channels/gmail", "description": "How to connect Gmail"}], "query": "gmail setup"}
\\\`\\\`\\\`

### Rules
- **The \`auxx:<type>\` language tag on the code fence is MANDATORY.** A bare \\\`\\\`\\\` fence without the language tag will render as raw JSON. Always write \\\`\\\`\\\`auxx:entity-list, \\\`\\\`\\\`auxx:entity-card, etc.
- **Always use blocks for structured data.** When tool results contain recordIds or thread IDs, you MUST use the appropriate block type. Never present recordIds as markdown text.
- Copy IDs and data exactly from tool results. Never fabricate data.
- One block per fenced section.
- When results form logical groups (e.g. duplicate contacts, records by category), use a **separate block per group** with a text heading before each block. When results are a flat list (e.g. search results), use a single block with an array.
- Blocks and text can be freely interleaved.
- If a tool returned no results, say so in text — don't emit an empty block.
`

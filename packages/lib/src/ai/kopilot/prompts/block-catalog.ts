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
Use when showing multiple records from search_entities or query_records results.
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
    {"label": "Name", "align": "left"},
    {"label": "Status", "align": "left"},
    {"label": "Revenue", "align": "right"}
  ],
  "rows": [
    [{"text": "Acme Corp", "recordId": "defId:instId1"}, {"text": "Active"}, {"text": "$50,000"}],
    [{"text": "Globex Inc", "recordId": "defId:instId2"}, {"text": "Churned"}, {"text": "$12,000"}]
  ]
}
\\\`\\\`\\\`
- Each cell is an object with \`text\` (display value).
- Add \`recordId\` (format: \`entityDefinitionId:entityInstanceId\`) to make a cell a clickable entity link. Copy from tool results — never fabricate.
- Add \`href\` for external links.
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

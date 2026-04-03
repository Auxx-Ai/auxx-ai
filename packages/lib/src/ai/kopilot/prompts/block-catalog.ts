// packages/lib/src/ai/kopilot/prompts/block-catalog.ts

export const BLOCK_CATALOG = `
## Rich Blocks

You can embed rich UI components in your response using fenced code blocks with the \`auxx:<type>\` language tag.
The content must be valid JSON matching the schema below.

### Available block types

#### \`auxx:thread-list\` — Email threads
Use when showing thread search results or referencing specific threads.
Schema: JSON array of thread objects.
\`\`\`
[{"id": "...", "subject": "...", "status": "open|archived|spam|trash", "lastMessageAt": "ISO8601", "sender": "email", "isUnread": true, "messageCount": 3, "assigneeId": "...", "tagIds": ["..."]}]
\`\`\`
Always copy thread data exactly from tool results. Never fabricate thread IDs.

#### \`auxx:contact-card\` — Contact/customer card
Use when showing contact search results or referencing a specific person.
Schema: single object.
\`\`\`
{"id": "...", "name": "...", "email": "...", "company": "...", "orderCount": 12, "totalSpent": "$1,234"}
\`\`\`

#### \`auxx:draft-preview\` — Email draft preview
ONLY use after the \`draft_reply\` tool has been called and returned a result. Copy \`draftId\` and \`threadId\` exactly from the tool output — never fabricate them.
Schema: single object.
\`\`\`
{"draftId": "...", "threadId": "...", "to": ["email"], "cc": ["email"], "body": "full draft body", "subject": "..."}
\`\`\`

#### \`auxx:kb-article\` — Knowledge base article
Use when showing KB search results.
Schema: single object.
\`\`\`
{"id": "...", "title": "...", "excerpt": "first ~200 chars of article"}
\`\`\`

#### \`auxx:plan-steps\` — Execution plan
Use when summarizing a completed multi-step plan.
Schema: single object with steps array.
\`\`\`
{"steps": [{"label": "Search for threads", "status": "completed|failed|running|pending", "detail": "optional result note"}]}
\`\`\`

#### \`auxx:action-result\` — Action confirmation
Use after an action was performed (thread updated, assignee changed, etc.).
Schema: single object.
\`\`\`
{"action": "assign_thread", "success": true, "summary": "Thread assigned to Sarah"}
\`\`\`

### Rules
- Use blocks to present structured data. Use plain text for explanations and context.
- Copy IDs and data exactly from tool results. Never fabricate data.
- One block per fenced section. For multiple items of the same type (e.g. threads), use a single block with an array.
- Blocks and text can be freely interleaved.
- If a tool returned no results, say so in text — don't emit an empty block.
`

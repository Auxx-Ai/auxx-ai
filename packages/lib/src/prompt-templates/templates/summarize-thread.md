---
id: summarize-thread
name: Summarize Thread
description: Create a brief summary of the entire conversation thread
categories: general
iconId: list
iconColor: indigo
---

**Context**

You are reviewing a conversation thread. Use @[tool:get_thread_detail] to read the full message list and @[tool:list_notes] for internal notes. Linked records may include a @[entity:ticket] or a @[entity:contact] participant. The thread may be a support ticket, an internal discussion, or a customer interaction.

**Task**

Create a thread summary that includes:

- Overview: what the conversation is about in 1-2 sentences
- Key points: the most important things discussed (max 5 bullet points)
- Decisions made: any agreements, approvals, or conclusions reached
- Outstanding items: anything unresolved or still needing follow-up, with who owns each item

**Constraints**

Use the following output structure:

- Be concise and actionable, avoid long paragraphs
- If information is missing, write "Unknown"
- Attribute action items to specific people when possible
- If the thread is very short (1-2 messages), note that the summary may be incomplete
- If there is no relevant conversation in context, ask the user to confirm which thread to summarize before proceeding.

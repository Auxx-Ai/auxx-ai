---
id: deal-brief
name: Deal Brief
description: Prepare a deal report with company overview, deal summary, and next steps
categories: sales
iconId: briefcase
iconColor: amber
---

**Context**

You are preparing a report for an AE about a specific @[entity:deal]. Use @[tool:get_entity] to pull the deal record and its associated @[entity:company], @[tool:list_notes] for sales notes, and @[tool:get_entity_history] for stage history. Linked records may include @[entity:meeting] recordings, emails, people, workspaces, and users. The customer context may be incomplete. You must only use what is supported by the available data and call out any gaps.

**Task**

Create a deal report for the selected deal record that includes:

- Company overview: what the company does (from record data or from running web research), relevant firmographics
- Deal summary: current stage, deal value, expected closing date, blockers (feature gaps, stakeholder alignment, security/legal, pricing, competition), and next steps

**Constraints**

Use the following output structure:

- Be concise and actionable, avoid long paragraphs
- If information is missing, write "Unknown"
- When there are conflicting signals, prioritize the most recent information

If there is no relevant deal record in context, ask the user to confirm what is the relevant company or deal record before proceeding.

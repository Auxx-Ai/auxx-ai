---
id: account-research
name: Account Research
description: Research a company using public web sources and produce a company brief
categories: sales
iconId: building
iconColor: blue
---

**Context**

You are researching a specific @[entity:company] using public web sources. Start with @[tool:search_knowledge] for any internal notes the org has already captured on the account, then fall back to public sources — the company's official website, trustworthy business websites, recent news from reputable publications.

**Task**

Produce a company research brief that includes:

- Snapshot: what the company does in 1-2 sentences
- Firmographics: Industry / Category, HQ location, company size, funding status
- GTM motion: PLG, sales-led, or enterprise
- Recent news: max 4-5 bullet points summarizing meaningful announcements in the last 90 days such as product launches, funding, acquisitions, leadership changes, layoffs, or regulatory updates
- Key figureheads: 4-5 bullet points on executive roles
- Competitive landscape: 1-2 sentences on their main competitors

**Constraints**

Use the following output structure:

- Be concise and actionable, avoid long paragraphs
- If information is missing, write "Unknown"
- When there are conflicting signals, prioritize the most recent information
- If the company name is ambiguous, state the ambiguity and list the top 3 likely matches
- If the company record doesn't have a domain, or the user doesn't provide one, try to find it using external web search
- If there is no relevant company name or company record in context, ask the user to confirm what the relevant company is before proceeding.

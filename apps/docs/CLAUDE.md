# Documentation Guide for AI Assistants

This guide provides specific instructions for creating and maintaining documentation in the Auxx.ai docs application powered by Fumadocs.

## Overview

The docs application serves as the central knowledge base for Auxx.ai, containing:
- User guides and tutorials
- API documentation
- Developer resources
- System architecture documentation

### Tech Stack
- **Framework**: Fumadocs (MDX-based documentation framework)
- **Runtime**: Next.js 15.4 with App Router
- **Content Format**: MDX (Markdown with JSX components)
- **Styling**: TailwindCSS

### Directory Structure
```
apps/docs/
├── content/docs/       # All documentation MDX files
├── src/
│   ├── app/           # Next.js app directory
│   └── lib/           # Utility functions and source configuration
├── source.config.ts   # Fumadocs MDX configuration
├── BLOCKS.md          # Available MDX blocks/components reference
└── CLAUDE.md          # This file
```

## Available Blocks & Components

See `BLOCKS.md` for a complete reference of all MDX components available for use in documentation files, including usage examples and registration status.

## Creating Documentation

### File Naming Conventions
- Use **kebab-case** for all MDX files (e.g., `getting-started.mdx`, `api-reference.mdx`)
- Group related documents in subdirectories
- Use `index.mdx` for section landing pages

### MDX File Structure

Every MDX file MUST include frontmatter:

```mdx
---
title: Page Title            # Required: Display title
description: Brief summary   # Required: SEO description (150-160 chars)
---

# Main Content Heading

Your documentation content here...
```

### Content Organization Patterns

1. **Logical Grouping**: Organize by feature or user journey
   ```
   content/docs/
   ├── getting-started/
   │   ├── index.mdx
   │   ├── installation.mdx
   │   └── configuration.mdx
   ├── features/
   │   ├── email-integration.mdx
   │   └── shopify-sync.mdx
   └── api/
       ├── authentication.mdx
       └── endpoints.mdx
   ```

2. **Progressive Disclosure**: Start simple, add complexity gradually
3. **Task-Based Structure**: Organize around user tasks and goals

## Fumadocs-Specific Instructions

### Built-in Components

Fumadocs provides interactive components. Use them to enhance documentation:

```mdx
import { Card, Cards } from 'fumadocs-ui/components/card'

<Cards>
  <Card title="Quick Start" href="/docs/getting-started">
    Get up and running in 5 minutes
  </Card>
  <Card title="API Reference" href="/docs/api">
    Detailed API documentation
  </Card>
</Cards>
```

### Navigation Configuration

To add sections to the sidebar, create a `meta.json` file in the directory:

```json
{
  "title": "Section Name",
  "pages": [
    "introduction",
    "installation",
    "configuration"
  ]
}
```

### Frontmatter Schema

The frontmatter is validated by Fumadocs. Available fields:
- `title` (required): Page title
- `description` (required): SEO description
- `icon`: Icon name for sidebar
- `full`: Full-width layout (true/false)

## Content Writing Guidelines

### Tone and Voice
- **Clear and Direct**: Use simple language, avoid jargon
- **Action-Oriented**: Start with verbs (e.g., "Configure", "Install", "Deploy")
- **Helpful**: Anticipate questions and provide solutions
- **Consistent**: Maintain uniform terminology throughout

### Code Examples

Always provide practical, runnable examples:

```mdx
```typescript
// Import the API client
import { api } from '~/trpc/react'

// Use the mutation
const sendReply = api.ticket.reply.useMutation()
```
```

### Heading Hierarchy
- **H1 (#)**: Page title (one per page)
- **H2 (##)**: Main sections
- **H3 (###)**: Subsections
- **H4 (####)**: Details (use sparingly)

### Links and References
- **URL pattern**: Pages are served at `/{category}/{slug}`, NOT `/docs/{category}/{slug}`. For example, `content/docs/getting-started/create-account.mdx` is served at `/getting-started/create-account`.
- Use these paths for internal links: `[Getting Started](/getting-started/create-account)`
- Use descriptive link text, avoid "click here"
- Link to relevant sections for deeper exploration

## Common Documentation Tasks

### Adding a New Documentation Page

1. Create the MDX file in appropriate directory:
   ```bash
   touch content/docs/features/new-feature.mdx
   ```

2. Add required frontmatter:
   ```mdx
   ---
   title: New Feature Guide
   description: Learn how to use the new feature in Auxx.ai
   ---
   ```

3. Write content following the guidelines above

4. Update `meta.json` if needed to include in navigation

### Creating a New Section

1. Create directory:
   ```bash
   mkdir content/docs/new-section
   ```

2. Create `index.mdx` for section landing:
   ```mdx
   ---
   title: Section Overview
   description: Introduction to this section
   ---
   
   # Section Name
   
   Brief introduction...
   
   <Cards>
     <!-- Link to subsections -->
   </Cards>
   ```

3. Add `meta.json` for navigation:
   ```json
   {
     "title": "New Section",
     "pages": ["index", "page1", "page2"]
   }
   ```

### Updating Navigation Structure

Edit the `meta.json` files to reorder or reorganize pages. The order in the `pages` array determines sidebar order.

## Quality Standards

### Documentation Completeness Checklist
- [ ] Clear, descriptive title
- [ ] Accurate description (150-160 characters)
- [ ] Introduction explaining the purpose
- [ ] Step-by-step instructions where applicable
- [ ] Code examples for technical content
- [ ] Links to related documentation
- [ ] Troubleshooting section for common issues

### SEO Considerations
- Use descriptive, keyword-rich titles
- Write compelling descriptions for search results
- Include relevant keywords naturally in content
- Use proper heading hierarchy

### Accessibility Requirements
- Provide alt text for images
- Use semantic HTML elements
- Ensure sufficient color contrast
- Write descriptive link text

### Before Publishing
1. **Review** content for accuracy and completeness
2. **Test** all code examples
3. **Verify** all links work correctly
4. **Check** formatting and readability
5. **Validate** frontmatter schema

## Important Notes

- **DO NOT** create documentation without explicit user request
- **ALWAYS** use MDX format for documentation files
- **FOLLOW** the existing structure and patterns
- **MAINTAIN** consistency with existing documentation style
- **TEST** interactive components before using them

## Quick Reference

### File Template
```mdx
---
title: [Clear, Descriptive Title]
description: [150-160 character description for SEO]
---

# [Title]

Brief introduction paragraph explaining what this document covers.

## Prerequisites

What users need before starting.

## Main Content

Step-by-step instructions or detailed explanation.

### Subsection

Additional details as needed.

## Next Steps

<Cards>
  <Card title="Related Topic" href="/docs/related">
    Brief description
  </Card>
</Cards>
```

This guide ensures consistent, high-quality documentation that serves Auxx.ai users effectively.

## Taking Screenshots with Chrome DevTools MCP

Use the **Chrome DevTools MCP** (not Playwright) to capture 2x Retina screenshots of the Auxx.ai web app for documentation. Chrome DevTools MCP supports `deviceScaleFactor` for high-DPI output.

### Login Credentials

Use the e2e test credentials from `packages/e2e/.env`:
- **URL**: `http://localhost:3000`
- **Email**: (see `DEFAULT_LOGIN` in `packages/e2e/.env`)
- **Password**: (see `DEFAULT_PASSWORD` in `packages/e2e/.env`)

### Screenshot Workflow

1. **Set viewport with 2x DPR** for Retina-quality screenshots:
   ```
   mcp__chrome-devtools__emulate({
     viewport: { width: 1440, height: 900, deviceScaleFactor: 2 }
   })
   ```

2. **Navigate** to the target page:
   ```
   mcp__chrome-devtools__navigate_page({ url: 'http://localhost:3000/app/...' })
   ```

3. **Hide the Next.js dev overlay** before every screenshot. Run this after each `navigate` call since it resets on page load:
   ```
   mcp__chrome-devtools__evaluate_script({
     function: `() => {
       const s = document.createElement('style');
       s.textContent = 'nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast], #__next-build-indicator, button[aria-label="Open issues overlay"], button[aria-label="Collapse issues badge"], button[aria-label="Open Next.js Dev Tools"] { display: none !important; } :has(> button[aria-label="Open issues overlay"]) { display: none !important; }';
       document.head.appendChild(s);
       document.querySelectorAll('nextjs-portal').forEach(el => el.remove());
       document.querySelectorAll('*').forEach(el => { if (el.textContent === 'vdev' && el.children.length === 0) el.style.display = 'none'; });
     }`
   })
   ```

4. **Take the screenshot** and save to `apps/docs/public/images/`:
   ```
   mcp__chrome-devtools__take_screenshot({
     format: 'png',
     filePath: '/Users/mklooth/Sites/auxxai/apps/docs/public/images/<name>.png'
   })
   ```

5. **Reference in MDX** using the standard image syntax:
   ```mdx
   ![Alt text describing the screenshot](/images/<name>.png)
   ```

### Interacting with Pages

To click elements (e.g., buttons, links), first take a snapshot to get element UIDs:
```
mcp__chrome-devtools__take_snapshot()
mcp__chrome-devtools__click({ uid: '<element-uid>' })
```

### Image Naming Convention

Use kebab-case descriptive names:
- `inbox-empty-state.png` — Inbox with no messages
- `integrations-page.png` — Add new integration page
- `settings-general.png` — General settings page
- `workflows-page.png` — Workflows overview
- `login-page.png` — Sign-in page

### Important Notes

- **Use Chrome DevTools MCP** — it supports `deviceScaleFactor: 2` for 2x Retina images (2880x1800 from a 1440x900 viewport). Playwright MCP's headless Chrome ignores DPR.
- **Always hide the dev overlay** after every `navigate` — it resets on each page load
- **Save all images** to `apps/docs/public/images/`
- **Use ImageZoom** — all `![](...)` images auto-zoom on click (configured in `mdx-components.tsx`)
- **Alt text is required** for accessibility
- The login flow requires two steps: enter email, then enter password on the next screen
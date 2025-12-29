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
└── CLAUDE.md          # This file
```

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
- Use relative paths for internal links: `[Getting Started](/docs/getting-started)`
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
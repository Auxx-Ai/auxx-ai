# Documentation Blocks Reference

**Created**: March 9, 2026
**Fumadocs UI**: v15.7.8
**Config file**: `apps/docs/src/mdx-components.tsx`

All blocks available for use in MDX documentation files. Blocks marked with **Registered** are ready to use. Blocks marked with **Available** need to be added to `mdx-components.tsx` first.

---

## Currently Registered Blocks

These are configured in `apps/docs/src/mdx-components.tsx` and ready to use in any MDX file.

---

### Callout

**Status**: Registered (via `defaultMdxComponents`)
**Import**: `fumadocs-ui/components/callout`

Highlighted message block for tips, warnings, errors, and notes.

```mdx
<Callout title="Important">
  This is a default callout.
</Callout>

<Callout type="warn" title="Warning">
  Be careful with this action.
</Callout>

<Callout type="error" title="Error">
  Something went wrong.
</Callout>

<Callout type="info" title="Note">
  Additional information here.
</Callout>
```

**Types**: `info` | `warn` | `error` (default is `info`)

---

### Card / Cards

**Status**: Registered (via `defaultMdxComponents`)
**Import**: `fumadocs-ui/components/card`

Grid of linked cards for navigation or feature highlights.

```mdx
<Cards>
  <Card title="Getting Started" href="/getting-started">
    Set up your account in minutes
  </Card>
  <Card title="API Reference" href="/developer/api-reference">
    Complete API documentation
  </Card>
</Cards>
```

**Card props**:
- `title` (required) — Card heading
- `href` (optional) — Link destination
- `icon` (optional) — Icon component

---

### Tabs / Tab

**Status**: Registered
**Import**: `fumadocs-ui/components/tabs`

Tabbed content switcher. Great for showing alternatives (e.g., different languages, platforms).

```mdx
<Tabs items={['Gmail', 'Outlook']}>
  <Tab value="Gmail">
    Connect your Gmail account via OAuth...
  </Tab>
  <Tab value="Outlook">
    Connect your Outlook account via OAuth...
  </Tab>
</Tabs>
```

**Tabs props**:
- `items` — Array of tab labels
- `defaultIndex` (optional) — Default active tab index
- `groupId` (optional) — Sync tab selection across instances with same ID

---

### Accordion / Accordions

**Status**: Registered
**Import**: `fumadocs-ui/components/accordion`

Collapsible sections for FAQ-style or optional content.

```mdx
<Accordions type="single">
  <Accordion title="What is Auxx.ai?">
    Auxx.ai is an AI-powered email support platform for Shopify businesses.
  </Accordion>
  <Accordion title="How does billing work?">
    We offer monthly and annual plans. See our pricing page for details.
  </Accordion>
</Accordions>
```

**Accordions props**:
- `type` — `"single"` (one open at a time) or `"multiple"` (many open)

**Accordion props**:
- `title` (required) — The clickable heading

---

### Banner

**Status**: Registered
**Import**: `fumadocs-ui/components/banner`

Top-of-page announcement or notification banner.

```mdx
<Banner id="new-feature">
  New: AI auto-replies are now available on all plans!
</Banner>
```

**Props**:
- `id` (required) — Unique identifier (used for dismiss persistence)

---

### Code Blocks

**Status**: Registered (via `defaultMdxComponents`)

Standard fenced code blocks with Shiki syntax highlighting. Supports all common languages.

````mdx
```typescript title="example.ts"
const api = new AuxxClient({ apiKey: 'your-key' })
const tickets = await api.tickets.list()
```
````

**Features**:
- Syntax highlighting (Shiki)
- `title` attribute for filename display
- Line highlighting with `// [!code highlight]`
- Line diffs with `// [!code ++]` and `// [!code --]`

---

### Heading (h1–h6)

**Status**: Registered (via `defaultMdxComponents`)

Standard markdown headings with automatic anchor links and TOC integration.

```mdx
# Page Title (h1 — one per page)
## Section (h2 — main sections)
### Subsection (h3)
#### Detail (h4)
```

---

### Blockquote

**Status**: Registered (via `defaultMdxComponents`)

```mdx
> This is a blockquote for emphasis or attribution.
```

---

### Table

**Status**: Registered (via `defaultMdxComponents`)

Standard markdown tables with styling.

```mdx
| Feature | Free | Pro |
|---------|------|-----|
| Inboxes | 1 | Unlimited |
| AI replies | 50/mo | Unlimited |
```

---

### Image

**Status**: Registered (via `defaultMdxComponents`)

Standard markdown images. Uses `remarkImage` plugin for optimization.

```mdx
![Alt text](/images/screenshot.png)
```

---

## Available but Not Registered

These components ship with `fumadocs-ui` but need to be added to `mdx-components.tsx` before use.

---

### Steps / Step

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/steps`

Numbered step-by-step guide. Ideal for tutorials, setup guides, and walkthroughs.

```mdx
import { Step, Steps } from 'fumadocs-ui/components/steps';

<Steps>
<Step>

### Create your account

Sign up at auxx.ai with Google, GitHub, or email.

</Step>
<Step>

### Connect your inbox

Go to Settings → Integrations and connect Gmail or Outlook.

</Step>
<Step>

### Connect Shopify

Enter your store domain and authorize the connection.

</Step>
</Steps>
```

**To register**, add to `mdx-components.tsx`:
```tsx
import { Step, Steps } from 'fumadocs-ui/components/steps';
// Add to component map: Step, Steps
```

---

### Files / Folder / File

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/files`

Visual file tree component. Useful for showing project structures or file organization.

```mdx
import { File, Folder, Files } from 'fumadocs-ui/components/files';

<Files>
  <Folder name="settings" defaultOpen>
    <File name="general.tsx" />
    <File name="members.tsx" />
    <File name="billing.tsx" />
  </Folder>
  <Folder name="integrations">
    <File name="gmail.tsx" />
    <File name="outlook.tsx" />
    <File name="shopify.tsx" />
  </Folder>
</Files>
```

**To register**, add to `mdx-components.tsx`:
```tsx
import { File, Folder, Files } from 'fumadocs-ui/components/files';
// Add to component map: File, Folder, Files
```

---

### TypeTable

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/type-table`

Structured property/type table. Best for API documentation, prop tables, and configuration references.

```mdx
import { TypeTable } from 'fumadocs-ui/components/type-table';

<TypeTable
  type={{
    apiKey: {
      type: 'string',
      description: 'Your API key for authentication',
      default: 'undefined',
    },
    baseUrl: {
      type: 'string',
      description: 'Base URL for API requests',
      default: '"https://api.auxx.ai"',
    },
  }}
/>
```

**To register**, add to `mdx-components.tsx`:
```tsx
import { TypeTable } from 'fumadocs-ui/components/type-table';
// Add to component map: TypeTable
```

---

### ImageZoom

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/image-zoom`

Click-to-zoom image component. Replaces the default `img` tag so all images become zoomable.

```mdx
<!-- No MDX usage needed — replaces default img tag -->
![Dashboard overview](/images/dashboard.png)
```

**To register**, replace `img` in `mdx-components.tsx`:
```tsx
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
// Add to component map: img: (props) => <ImageZoom {...(props as any)} />
```

---

### InlineTOC

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/inline-toc`

Inline table of contents rendered within the page body. Useful for long pages or landing pages.

```mdx
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';

<InlineTOC items={toc}>Table of Contents</InlineTOC>
```

**To register**, add to `mdx-components.tsx`:
```tsx
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';
// Add to component map: InlineTOC
```

---

### CodeBlock / Pre

**Status**: Available — needs registration
**Import**: `fumadocs-ui/components/codeblock`

Advanced code block wrapper with copy button, title bar, and custom styling. Replaces the default `pre` tag.

```tsx
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
// Replace pre in component map:
// pre: ({ ref: _ref, ...props }) => (
//   <CodeBlock {...props}>
//     <Pre>{props.children}</Pre>
//   </CodeBlock>
// )
```

---

## Standard Markdown

These work out of the box with no imports needed.

| Syntax | Renders |
|--------|---------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `inline code` `` | `inline code` |
| `[link text](url)` | Hyperlink |
| `![alt](url)` | Image |
| `- item` | Unordered list |
| `1. item` | Ordered list |
| `---` | Horizontal rule |
| `> quote` | Blockquote |

---

## Recommended Registrations

For the documentation we're building, I recommend registering these additional components:

| Component | Why |
|-----------|-----|
| **Steps / Step** | Essential for setup guides and tutorials (Getting Started, Connect Inbox, etc.) |
| **ImageZoom** | Screenshots of the app UI should be zoomable |
| **TypeTable** | Needed for API reference docs |
| **Files / Folder / File** | Useful for developer guides showing project structure |

These 4 additions would cover all the blocks needed for the 54 planned reference articles.

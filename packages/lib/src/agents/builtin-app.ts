// packages/lib/src/agents/builtin-app.ts

/**
 * Synthetic "Auxx.ai" app declaration that fronts every built-in toolset in
 * the unified Tools tab catalog. The shape mirrors `CachedInstalledApp` so the
 * synthetic row prepended by `installedAppsProvider` drops in without any
 * adapter layer (see
 * `plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md` §1).
 */

import type { CachedAgentToolset, CachedInstalledApp } from '../cache/org-cache-keys'

export const BUILTIN_APP = {
  id: 'auxx',
  slug: 'auxx',
  title: 'Auxx.ai',
  description: null,
  /** `parseIconString` routes `url:/…` through the `<img>` branch. */
  avatarUrl: 'url:/auxx-logo.svg',
  category: null,
} as const satisfies CachedInstalledApp['app']

export const BUILTIN_TOOLSETS: ReadonlyArray<CachedAgentToolset> = [
  {
    slug: 'auxx:mail:threads',
    subGroup: 'Mail',
    name: 'Mail — Threads',
    shortLabel: 'Threads',
    iconKey: 'mails',
    color: 'blue',
    isDefault: true,
    isPopular: true,
    description: 'Read mail threads, list inbox folders, and search across messages.',
    subGroupIconId: 'mails',
    subGroupColor: 'blue',
  },
  {
    slug: 'auxx:mail:compose',
    subGroup: 'Mail',
    name: 'Mail — Compose',
    shortLabel: 'Compose',
    iconKey: 'send',
    color: 'blue',
    isDefault: true,
    isPopular: true,
    description: 'Send new mail and reply to existing threads on behalf of the user.',
  },
  {
    slug: 'auxx:mail:drafts',
    subGroup: 'Mail',
    name: 'Mail — Drafts',
    shortLabel: 'Drafts',
    iconKey: 'file-text',
    color: 'blue',
    isDefault: false,
    isPopular: true,
    description: 'Create, update, and discard draft messages.',
  },
  {
    slug: 'auxx:entities:search',
    subGroup: 'Entities',
    name: 'Entities — Search',
    shortLabel: 'Search',
    iconKey: 'search',
    color: 'purple',
    isDefault: true,
    isPopular: true,
    description: 'Search and list entity records across every domain.',
    subGroupIconId: 'database',
    subGroupColor: 'purple',
  },
  {
    slug: 'auxx:entities:write',
    subGroup: 'Entities',
    name: 'Entities — Write',
    shortLabel: 'Write',
    iconKey: 'edit',
    color: 'purple',
    isDefault: true,
    isPopular: false,
    description: 'Create, update, and annotate entity records.',
  },
  {
    slug: 'auxx:comments:read',
    subGroup: 'Comments',
    name: 'Comments — Read',
    shortLabel: 'Read',
    iconKey: 'search',
    color: 'teal',
    isDefault: true,
    isPopular: false,
    description: 'Read ticket comments and look up activity threads.',
    subGroupIconId: 'message-square',
    subGroupColor: 'teal',
  },
  {
    slug: 'auxx:comments:write',
    subGroup: 'Comments',
    name: 'Comments — Write',
    shortLabel: 'Write',
    iconKey: 'message-square',
    color: 'teal',
    isDefault: true,
    isPopular: true,
    description: 'Post comments, reply to threads, and mention teammates.',
  },
  {
    slug: 'auxx:knowledge',
    subGroup: 'Knowledge',
    name: 'Knowledge — Read',
    shortLabel: 'Read',
    iconKey: 'book-open',
    color: 'orange',
    isDefault: true,
    isPopular: true,
    description: 'Search the knowledge base and retrieve published articles.',
    subGroupIconId: 'book-open',
    subGroupColor: 'orange',
  },
  {
    slug: 'auxx:kb:write',
    subGroup: 'Knowledge',
    name: 'Knowledge — Write',
    shortLabel: 'Write',
    iconKey: 'edit',
    color: 'orange',
    isDefault: false,
    isPopular: false,
    description: 'Author, update, and publish knowledge-base articles.',
  },
  {
    slug: 'auxx:tasks:read',
    subGroup: 'Tasks',
    name: 'Tasks — Search',
    shortLabel: 'Search',
    iconKey: 'search',
    color: 'green',
    isDefault: false,
    isPopular: false,
    description: 'Search and list tasks across assignees and queues.',
    subGroupIconId: 'list-checks',
    subGroupColor: 'green',
  },
  {
    slug: 'auxx:tasks:write',
    subGroup: 'Tasks',
    name: 'Tasks — Write',
    shortLabel: 'Write',
    iconKey: 'check-circle',
    color: 'green',
    isDefault: false,
    isPopular: true,
    description: 'Create, update, and resolve tasks.',
  },
  {
    slug: 'auxx:docs',
    subGroup: 'Docs',
    name: 'Docs — Search',
    shortLabel: 'Search',
    iconKey: 'help-circle',
    color: 'gray',
    isDefault: true,
    isPopular: false,
    description: 'Search internal product docs and runbooks.',
    subGroupIconId: 'help-circle',
    subGroupColor: 'gray',
  },
  {
    slug: 'auxx:actors',
    subGroup: null,
    name: 'Members & actors',
    shortLabel: 'Members & actors',
    iconKey: 'users',
    color: 'pink',
    isDefault: true,
    isPopular: false,
    description: 'Look up workspace members, teams, and bot actors.',
  },
]

/** Lookup helper — fast path for tag-side code that already has a slug. */
const BY_SLUG = new Map<string, CachedAgentToolset>(BUILTIN_TOOLSETS.map((t) => [t.slug, t]))
export function getBuiltinToolset(slug: string): CachedAgentToolset | undefined {
  return BY_SLUG.get(slug)
}

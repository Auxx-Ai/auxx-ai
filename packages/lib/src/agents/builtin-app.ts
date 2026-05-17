// packages/lib/src/agents/builtin-app.ts

/**
 * Synthetic "Auxx.ai" app declaration that fronts every built-in toolset in
 * the unified Tools tab catalog. Replaces the legacy `NATIVE_*` lookup tables
 * with one declarative source of truth (see
 * `plans/kopilot/agents/tools/unified-app-hierarchy.md` §2.2 and
 * `plans/kopilot/agents/tools/recursive-catalog-node.md` §2.4).
 */

export const BUILTIN_APP = {
  id: 'auxx',
  slug: 'auxx',
  title: 'Auxx.ai',
  /** Passed verbatim to <AppIcon>; resolved by parseIconString as a URL. */
  iconId: 'url:/auxx-logo.svg',
} as const

export interface BuiltinToolsetMeta {
  /** Runtime slug — `auxx:<group>:<leaf>` (or `auxx:<leaf>` when ungrouped). */
  slug: string
  /** Full label, used outside the Tools tab context (e.g. reference badges). */
  label: string
  /** Short label, used inside the app/sub-group render. */
  shortLabel: string
  /** `null` means the toolset hangs directly under the app row. */
  subGroup: string | null
  iconId: string
  color: string
  isDefault: boolean
  /**
   * Curated for the Tool-Select dialog's "Popular tools" group. Independent of
   * `isDefault` (which controls auto-enable for new agents) so the curation
   * set can grow beyond the auto-enable set.
   */
  isPopular: boolean
  /** One-line tooltip copy shown on the leaf row's help icon. */
  description: string
  /**
   * Sub-group header icon. First non-null across rows that share the same
   * `subGroup` wins on collapse. `null` = inherit from the app row.
   */
  subGroupIconId: string | null
  /** Sub-group header color. First non-null wins. `null` = inherit. */
  subGroupColor: string | null
}

export const BUILTIN_TOOLSETS: ReadonlyArray<BuiltinToolsetMeta> = [
  {
    slug: 'auxx:mail:threads',
    subGroup: 'Mail',
    label: 'Mail — Threads',
    shortLabel: 'Threads',
    iconId: 'mails',
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
    label: 'Mail — Compose',
    shortLabel: 'Compose',
    iconId: 'send',
    color: 'blue',
    isDefault: true,
    isPopular: true,
    description: 'Send new mail and reply to existing threads on behalf of the user.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:mail:drafts',
    subGroup: 'Mail',
    label: 'Mail — Drafts',
    shortLabel: 'Drafts',
    iconId: 'file-text',
    color: 'blue',
    isDefault: false,
    isPopular: true,
    description: 'Create, update, and discard draft messages.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:entities:search',
    subGroup: 'Entities',
    label: 'Entities — Search',
    shortLabel: 'Search',
    iconId: 'search',
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
    label: 'Entities — Write',
    shortLabel: 'Write',
    iconId: 'edit',
    color: 'purple',
    isDefault: true,
    isPopular: false,
    description: 'Create, update, and annotate entity records.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:comments:read',
    subGroup: 'Comments',
    label: 'Comments — Read',
    shortLabel: 'Read',
    iconId: 'search',
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
    label: 'Comments — Write',
    shortLabel: 'Write',
    iconId: 'message-square',
    color: 'teal',
    isDefault: true,
    isPopular: true,
    description: 'Post comments, reply to threads, and mention teammates.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:knowledge',
    subGroup: 'Knowledge',
    label: 'Knowledge — Read',
    shortLabel: 'Read',
    iconId: 'book-open',
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
    label: 'Knowledge — Write',
    shortLabel: 'Write',
    iconId: 'edit',
    color: 'orange',
    isDefault: false,
    isPopular: false,
    description: 'Author, update, and publish knowledge-base articles.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:tasks:read',
    subGroup: 'Tasks',
    label: 'Tasks — Search',
    shortLabel: 'Search',
    iconId: 'search',
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
    label: 'Tasks — Write',
    shortLabel: 'Write',
    iconId: 'check-circle',
    color: 'green',
    isDefault: false,
    isPopular: true,
    description: 'Create, update, and resolve tasks.',
    subGroupIconId: null,
    subGroupColor: null,
  },
  {
    slug: 'auxx:docs',
    subGroup: 'Docs',
    label: 'Docs — Search',
    shortLabel: 'Search',
    iconId: 'help-circle',
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
    label: 'Members & actors',
    shortLabel: 'Members & actors',
    iconId: 'users',
    color: 'pink',
    isDefault: true,
    isPopular: false,
    description: 'Look up workspace members, teams, and bot actors.',
    subGroupIconId: null,
    subGroupColor: null,
  },
]

/** Lookup helper — fast path for tag-side code that already has a slug. */
const BY_SLUG = new Map<string, BuiltinToolsetMeta>(BUILTIN_TOOLSETS.map((t) => [t.slug, t]))
export function getBuiltinToolset(slug: string): BuiltinToolsetMeta | undefined {
  return BY_SLUG.get(slug)
}

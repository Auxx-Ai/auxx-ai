import {
  AppWindow,
  BookOpen,
  Bot,
  Building2,
  Cable,
  CalendarClock,
  CheckSquare,
  CircleAlert,
  ClipboardList,
  ComponentIcon,
  Database,
  Feather,
  FileText,
  FileUp,
  Folder,
  Forward,
  History,
  Import,
  Inbox,
  Layers,
  LayoutDashboard,
  Map,
  MessagesSquare,
  Palette,
  PersonStanding,
  Ratio,
  Receipt,
  Rows3,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Truck,
  UserCog,
  Users,
  UsersRound,
  Video,
  Waypoints,
  Webhook,
  Wrench,
  Zap,
} from 'lucide-react'

type FieldProps = { label: string; id: string; slug?: string }

export type SidebarProps = {
  icon?: React.ReactNode
  type?: string
  items?: SidebarProps[]
  url?: string
  selectFirst?: boolean
  access?: 'ADMIN' | 'USER'
  skipParentSlug?: boolean
  preventNavigation?: boolean
  /** Hidden in self-hosted mode */
  cloudOnly?: boolean
  /** Feature key required for this menu item to be visible */
  featureKey?: string
  /** Layer-2 capability key required for this item to be visible (§7.3) */
  permissionKey?: string
  /** When true, only admins/owners see this item */
  adminOnly?: boolean
  /**
   * When true, this item is visible to any member who administers ≥1 def
   * (OWNER/ADMIN or a def-`admin` grantee) — Custom Fields is *derived* from
   * def-admin, not its own Layer-2 area (perms v2 doc 09). The page itself lists
   * only the defs the member administers.
   */
  requiresDefAdmin?: boolean
  /**
   * One-line supporting copy shown under the label in `SidebarSecondary`'s search
   * results. Add it only where the label alone is ambiguous (General vs My Account vs
   * Organization, Channels vs Inboxes, Connections vs Apps & MCP) — not to every item.
   */
  description?: string
  /**
   * Extra terms that should match this item in search but don't appear in its label,
   * e.g. `['stripe', 'subscription']` for Plans & Billing. Matched case-insensitively.
   */
  keywords?: string[]
} & FieldProps

import type * as React from 'react'

// {
//   id: uuid(),
//   label: 'Mailbox',
//   slug: 'mail',
//   icon: <Mail />,
//   items: [{ id: uuid(), label: 'Inbox', slug: 'inbox', icon: <Inbox /> }],
// },

export const MAIL_MENU: SidebarProps[] = []

export const SIDEBAR_MENU: SidebarProps[] = [
  {
    id: 'dashboards',
    label: 'Dashboards',
    slug: 'dashboards',
    icon: <LayoutDashboard />,
    featureKey: 'dashboards',
    permissionKey: 'dashboards.view',
  },
  {
    id: 'today',
    label: 'Today',
    slug: 'today',
    icon: <Sun />,
    featureKey: 'todayInbox',
  },
  {
    id: 'chats',
    label: 'Chats',
    slug: 'kopilot/new',
    icon: <MessagesSquare />,
    featureKey: 'kopilot',
  },
  {
    id: 'agents',
    label: 'Agents',
    slug: 'agents',
    icon: <Bot />,
    featureKey: 'agents',
    permissionKey: 'agents.manage',
    adminOnly: true,
  },
  {
    id: 'calls',
    label: 'Calls',
    slug: 'calls',
    icon: <Video />,
    featureKey: 'callRecordings',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    slug: 'workflows',
    icon: <Zap />,
    featureKey: 'workflows',
    permissionKey: 'workflows.manage',
  },
  { id: 'tasks', label: 'Tasks', slug: 'tasks', icon: <CheckSquare /> },
  {
    id: 'schedule',
    label: 'Schedule',
    slug: 'schedule',
    icon: <CalendarClock />,
    featureKey: 'dispatch',
    permissionKey: 'dispatch.mySchedule',
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    slug: 'dispatch',
    icon: <Truck />,
    featureKey: 'dispatch',
    permissionKey: 'dispatch.board.view',
    skipParentSlug: true,
    // Navigable group: clicking the row opens the module home (settings until the
    // M2 board lands); the chevron toggles the sub-items independently.
    url: '/app/dispatch',
    items: [
      {
        id: 'dispatch-requests',
        label: 'Requests',
        slug: 'service-requests',
        icon: <ClipboardList />,
      },
      {
        id: 'dispatch-quotes',
        label: 'Quotes',
        slug: 'quotes',
        icon: <FileText />,
      },
      {
        id: 'dispatch-work-orders',
        label: 'Work Orders',
        slug: 'work-orders',
        icon: <Wrench />,
      },
      {
        id: 'dispatch-invoices',
        label: 'Invoices',
        slug: 'invoices',
        icon: <Receipt />,
      },
    ],
  },
  // Member-visible by design (no adminOnly) — dashboards are member-safe.

  {
    id: 'resources',
    label: 'Resources',
    slug: 'resources',
    icon: <Layers />,
    skipParentSlug: true,
    preventNavigation: true,
    items: [
      {
        id: 'datasets',
        label: 'Datasets',
        slug: 'datasets',
        icon: <Database />,
        featureKey: 'datasets',
        permissionKey: 'datasets.view',
      },
      {
        id: 'kb',
        label: 'Knowledge Base',
        slug: 'kb',
        icon: <BookOpen />,
        featureKey: 'knowledgeBase',
        permissionKey: 'knowledgeBase.view',
      },
      {
        id: 'connectors',
        label: 'Connectors',
        slug: 'connectors',
        icon: <Cable />,
        featureKey: 'dataConnectors',
        permissionKey: 'connectors.manage',
      },
      {
        id: 'files',
        label: 'Files',
        slug: 'files',
        icon: <Folder />,
        featureKey: 'files',
        permissionKey: 'files.view',
      },
    ],
  },
  {
    id: 'examples',
    label: 'Examples',
    slug: 'examples',
    icon: <ComponentIcon />,
    featureKey: 'devTools',
    items: [
      {
        id: 'examples-file-upload',
        label: 'File Upload',
        slug: 'file-upload',
        icon: <FileUp />,
      },
      {
        id: 'examples-apps',
        label: 'Apps',
        slug: 'apps',
        icon: <AppWindow />,
      },
      {
        id: 'examples-designs',
        label: 'Designs',
        slug: 'designs',
        icon: <Palette />,
      },
    ],
  },
  // { id: 'settings', label: 'Settings', slug: 'settings', icon: <Settings /> },
]

// Scheme B (plans/permissions/v2/09-settings-admin-areas.md) — flat functional
// groups replace the old role-based `Admin` bucket. A group renders if you hold
// any capability inside it (sidebar suppresses empty groups); each item gates on
// its own Layer-2 `permissionKey`. Groups set NO group-level `access`.
export const SETTINGS_MENU: SidebarProps[] = [
  // Account — personal, always visible (no gate).
  {
    id: 'account',
    label: 'Account',
    type: 'header',
    items: [
      {
        id: 'settings-general',
        label: 'General',
        slug: 'general',
        icon: <Settings />,
        description: 'Appearance, language and notification preferences',
        keywords: ['theme', 'dark mode', 'language', 'timezone', 'preferences'],
      },
      {
        id: 'settings-account',
        label: 'My Account',
        slug: 'account',
        icon: <UserCog />,
        description: 'Your profile, password and two-factor authentication',
        keywords: ['profile', 'password', '2fa', 'mfa', 'passkey', 'security', 'email address'],
      },
      {
        id: 'settings-organization',
        label: 'Organization',
        slug: 'organization',
        icon: <Building2 />,
        description: 'Workspace name, logo and defaults',
        keywords: ['workspace', 'company', 'logo', 'branding', 'domain'],
      },
    ],
  },
  // Workspace — org membership, access, billing, audit.
  {
    id: 'workspace',
    label: 'Workspace',
    type: 'header',
    items: [
      {
        id: 'settings-members',
        label: 'Members and Groups',
        slug: 'members',
        icon: <Users />,
        permissionKey: 'members.manage',
        keywords: ['users', 'teams', 'invite', 'seats', 'people'],
      },
      {
        id: 'settings-permissions',
        label: 'Permissions',
        slug: 'permissions',
        icon: <ShieldCheck />,
        // `permissions` area stays adminOnly (granting the grant is an escalation).
        access: 'ADMIN',
        keywords: ['roles', 'access', 'sharing', 'sso', 'saml', 'policy'],
      },
      {
        id: 'admin-plans',
        label: 'Plans & Billing',
        slug: 'plans',
        icon: <Map />,
        // Read is enough to SEE the billing tab.
        permissionKey: 'billing.view',
        cloudOnly: true,
        keywords: ['stripe', 'subscription', 'invoice', 'payment', 'upgrade', 'credits'],
      },
      {
        id: 'settings-activity-log',
        label: 'Account Activity',
        slug: 'activity-log',
        icon: <History />,
        permissionKey: 'auditLog.view',
        keywords: ['audit', 'log', 'history', 'events', 'security'],
      },
    ],
  },
  // Data & CRM — data model + rules.
  {
    id: 'data-crm',
    label: 'Data & CRM',
    type: 'header',
    items: [
      {
        id: 'admin-fields',
        label: 'Custom Entities & Fields',
        slug: 'custom-fields',
        icon: <Rows3 />,
        // Derived from def-admin (perms v2 doc 09): visible to any member who
        // administers ≥1 def; the page lists only their administered defs.
        requiresDefAdmin: true,
        description: 'Define record types and the fields on them',
        keywords: ['schema', 'objects', 'properties', 'attributes', 'records', 'columns'],
      },
      {
        id: 'admin-tags',
        label: 'Tags',
        slug: 'tags',
        icon: <Tag />,
        // TODO(perms v2 doc 09): gets its own area later; deferred, stays admin.
        access: 'ADMIN',
        description: 'Shared labels applied across records and threads',
        keywords: ['labels', 'categories'],
      },
      {
        id: 'admin-import-history',
        label: 'Import & Export',
        slug: 'import-history',
        icon: <Import />,
        // TODO(perms v2 doc 09): gets its own area later; deferred, stays admin.
        access: 'ADMIN',
        keywords: ['csv', 'upload', 'migration', 'backup', 'download', 'data transfer'],
      },
      {
        id: 'admin-rules',
        label: 'Rules',
        slug: 'rules',
        icon: <Zap />,
        permissionKey: 'automationRules.manage',
        keywords: ['automation', 'triggers', 'record rules', 'if this then that'],
      },
    ],
  },
  // AI — models + Kopilot org defaults.
  {
    id: 'ai',
    label: 'AI',
    type: 'header',
    items: [
      {
        id: 'settings-aiModels',
        label: 'AI Models',
        slug: 'aiModels',
        icon: <Bot />,
        permissionKey: 'aiConfig.manage',
        description: 'Providers, API keys and the default model',
        keywords: ['openai', 'anthropic', 'claude', 'gemini', 'chatgpt', 'deepseek', 'llm', 'byo'],
      },
      {
        id: 'settings-kopilot',
        label: 'Kopilot',
        slug: 'kopilot',
        icon: <Sparkles />,
        permissionKey: 'aiConfig.manage',
        description: 'Org defaults for the AI assistant',
        keywords: ['assistant', 'copilot', 'chat', 'ai'],
      },
    ],
  },
  // Channels — member-visible: members connect/manage their own personal email
  // accounts here; shared-channel actions are gated in-page. Inboxes stays admin.
  {
    id: 'channels',
    label: 'Channels',
    type: 'header',
    items: [
      {
        id: 'settings-channels',
        label: 'Channels',
        slug: 'channels',
        icon: <Waypoints />,
        description: 'Connect the accounts messages arrive on',
        keywords: ['gmail', 'outlook', 'imap', 'smtp', 'email account', 'sms', 'whatsapp'],
      },
      {
        id: 'settings-inboxes',
        label: 'Inboxes',
        slug: 'inbox',
        icon: <Inbox />,
        access: 'ADMIN',
        description: 'Shared queues that route those messages to your team',
        keywords: ['shared inbox', 'routing', 'assignment', 'queue'],
      },
      {
        id: 'settings-signatures',
        label: 'Signatures',
        slug: 'signatures',
        icon: <Feather />,
        keywords: ['sign off', 'footer', 'email signature'],
      },
      {
        id: 'settings-snippets',
        label: 'Snippets',
        slug: 'snippets',
        icon: <Tag />,
        keywords: ['canned response', 'macro', 'template', 'saved reply'],
      },
    ],
  },
  // Integrations — apps/MCP/webhooks + connections + API keys.
  {
    id: 'integrations',
    label: 'Integrations',
    type: 'header',
    items: [
      {
        id: 'settings-apps',
        label: 'Apps & MCP',
        slug: 'apps',
        icon: <AppWindow />,
        permissionKey: 'integrations.manage',
        description: 'Install apps and MCP servers that add capabilities',
        keywords: ['marketplace', 'integrations', 'mcp', 'shopify', 'quickbooks', 'plugins'],
      },
      {
        id: 'settings-connections',
        label: 'Connections',
        slug: 'connections',
        icon: <Cable />,
        description: 'Accounts those apps authenticate against',
        keywords: ['oauth', 'credentials', 'authorize', 'linked accounts', 'reconnect'],
      },
      {
        id: 'settings-webhooks',
        label: 'Webhooks',
        slug: 'webhooks',
        icon: <Webhook />,
        permissionKey: 'integrations.manage',
        featureKey: 'webhooks',
        keywords: ['callbacks', 'events', 'http', 'subscriptions'],
      },
      {
        id: 'settings-apiKeys',
        label: 'API Keys',
        slug: 'apiKeys',
        icon: <ComponentIcon />,
        featureKey: 'apiAccess',
        keywords: ['token', 'secret', 'sdk', 'rest', 'developer'],
      },
    ],
  },
]

export const SIDEBAR_MAIL_MAIN: SidebarProps[] = [
  { id: 'inbox', label: 'Inbox', slug: 'mail/inbox', type: 'main', icon: <Inbox /> },
  { id: 'drafts', label: 'Drafts', slug: 'mail/drafts', type: 'main', icon: <Folder /> },
  { id: 'sent', label: 'Sent', slug: 'mail/sent', type: 'main', icon: <Forward /> },
  { id: 'archived', label: 'Archived', slug: 'mail/archived', type: 'main', icon: <Trash2 /> },
]
export const SIDEBAR_CATEGORIES: SidebarProps[] = [
  {
    id: 'personal',
    label: 'Personal',
    slug: 'personal',
    type: 'category',
    icon: <PersonStanding />,
  },
  { id: 'social', label: 'Social', slug: 'social', type: 'category', icon: <UsersRound /> },
  { id: 'updates', label: 'Updates', slug: 'updates', type: 'category', icon: <CircleAlert /> },
  { id: 'forums', label: 'Forums', slug: 'forums', type: 'category', icon: <MessagesSquare /> },
  { id: 'promotions', label: 'Promotions', slug: 'promotions', type: 'category', icon: <Ratio /> },
]

export const MAIL_SYSTEM_ITEMS: Record<string, SidebarProps> = {}

SIDEBAR_MAIL_MAIN.forEach((item) => {
  MAIL_SYSTEM_ITEMS[item.id] = item
})

SIDEBAR_CATEGORIES.forEach((item) => {
  MAIL_SYSTEM_ITEMS[item.id] = item
})

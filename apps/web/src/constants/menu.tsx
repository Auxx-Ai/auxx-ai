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
      },
      {
        id: 'kb',
        label: 'Knowledge Base',
        slug: 'kb',
        icon: <BookOpen />,
        featureKey: 'knowledgeBase',
      },
      {
        id: 'connectors',
        label: 'Connectors',
        slug: 'connectors',
        icon: <Cable />,
        featureKey: 'dataConnectors',
        adminOnly: true,
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
      { id: 'settings-general', label: 'General', slug: 'general', icon: <Settings /> },
      { id: 'settings-account', label: 'My Account', slug: 'account', icon: <UserCog /> },
      {
        id: 'settings-organization',
        label: 'Organization',
        slug: 'organization',
        icon: <Building2 />,
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
      },
      {
        id: 'settings-permissions',
        label: 'Permissions',
        slug: 'permissions',
        icon: <ShieldCheck />,
        // `permissions` area stays adminOnly (granting the grant is an escalation).
        access: 'ADMIN',
      },
      {
        id: 'admin-plans',
        label: 'Plans & Billing',
        slug: 'plans',
        icon: <Map />,
        // Read is enough to SEE the billing tab.
        permissionKey: 'billing.view',
        cloudOnly: true,
      },
      {
        id: 'settings-activity-log',
        label: 'Account Activity',
        slug: 'activity-log',
        icon: <History />,
        permissionKey: 'auditLog.view',
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
        // TODO(perms v2 doc 09): derive from def-admin (canAdministerDef) — page
        // lists only the defs the member administers; not yet split out.
        access: 'ADMIN',
      },
      {
        id: 'admin-tags',
        label: 'Tags',
        slug: 'tags',
        icon: <Tag />,
        // TODO(perms v2 doc 09): gets its own area later; deferred, stays admin.
        access: 'ADMIN',
      },
      {
        id: 'admin-import-history',
        label: 'Import & Export',
        slug: 'import-history',
        icon: <Import />,
        // TODO(perms v2 doc 09): gets its own area later; deferred, stays admin.
        access: 'ADMIN',
      },
      {
        id: 'admin-rules',
        label: 'Rules',
        slug: 'rules',
        icon: <Zap />,
        permissionKey: 'automationRules.manage',
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
      },
      {
        id: 'settings-kopilot',
        label: 'Kopilot',
        slug: 'kopilot',
        icon: <Sparkles />,
        permissionKey: 'aiConfig.manage',
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
      },
      { id: 'settings-inboxes', label: 'Inboxes', slug: 'inbox', icon: <Inbox />, access: 'ADMIN' },
      { id: 'settings-signatures', label: 'Signatures', slug: 'signatures', icon: <Feather /> },
      { id: 'settings-snippets', label: 'Snippets', slug: 'snippets', icon: <Tag /> },
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
      },
      {
        id: 'settings-connections',
        label: 'Connections',
        slug: 'connections',
        icon: <Cable />,
      },
      {
        id: 'settings-webhooks',
        label: 'Webhooks',
        slug: 'webhooks',
        icon: <Webhook />,
        permissionKey: 'integrations.manage',
        featureKey: 'webhooks',
      },
      {
        id: 'settings-apiKeys',
        label: 'API Keys',
        slug: 'apiKeys',
        icon: <ComponentIcon />,
        featureKey: 'apiAccess',
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

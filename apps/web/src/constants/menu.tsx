import {
  AppWindow,
  BookOpen,
  Bot,
  Building2,
  CheckSquare,
  CircleAlert,
  ComponentIcon,
  Contact2,
  Database,
  Feather,
  FileUp,
  Folder,
  Forward,
  Import,
  Inbox,
  Layers,
  Map,
  MessagesSquare,
  Package,
  PersonStanding,
  Ratio,
  Rows3,
  Settings,
  ShoppingBag,
  Tag,
  Trash2,
  Users,
  UsersRound,
  Waypoints,
  Webhook,
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
} & FieldProps

import type * as React from 'react'
import { ShopifyIcon } from './icons'

// {
//   id: uuid(),
//   label: 'Mailbox',
//   slug: 'mail',
//   icon: <Mail />,
//   items: [{ id: uuid(), label: 'Inbox', slug: 'inbox', icon: <Inbox /> }],
// },

export const SHOPIFY_MENU: SidebarProps[] = [
  { id: 'shopify-customers', label: 'Customers', slug: 'customers', icon: <Contact2 /> },
  { id: 'shopify-orders', label: 'Orders', slug: 'orders', icon: <ShoppingBag /> },
  { id: 'shopify-products', label: 'Products', slug: 'products', icon: <Package /> },
]
export const MAIL_MENU: SidebarProps[] = [
  // {
  //   id: 'rules',
  //   label: 'Rules & Automation',
  //   slug: 'rules',
  //   icon: <Zap />,
  //   items: [
  //     { id: 'rules-list', label: 'Rules', slug: '', icon: <Bot /> },
  //     { id: 'rules-history', label: 'History', slug: 'history', icon: <History /> },
  //     { id: 'rules-analytics', label: 'Analytics', slug: 'analytics', icon: <ChartLine /> },
  //     { id: 'rules-testing', label: 'Testing', slug: 'testing', icon: <FlaskConical /> },
  //   ],
  // },
]

export const SIDEBAR_MENU: SidebarProps[] = [
  { id: 'workflows', label: 'Workflows', slug: 'workflows', icon: <Zap /> },
  { id: 'tasks', label: 'Tasks', slug: 'tasks', icon: <CheckSquare /> },
  {
    id: 'shopify',
    label: 'Shopify',
    slug: 'shopify',
    icon: <ShopifyIcon />,
    preventNavigation: true,
    items: SHOPIFY_MENU,
  },
  {
    id: 'resources',
    label: 'Resources',
    slug: 'resources',
    icon: <Layers />,
    skipParentSlug: true,
    preventNavigation: true,
    items: [
      { id: 'datasets', label: 'Datasets', slug: 'datasets', icon: <Database /> },
      { id: 'kb', label: 'Knowledge Base', slug: 'kb', icon: <BookOpen /> },
      { id: 'files', label: 'Files', slug: 'files', icon: <Folder /> },
    ],
  },
  ...(process.env.NODE_ENV === 'development'
    ? [
        {
          id: 'examples',
          label: 'Examples',
          slug: 'examples',
          icon: <ComponentIcon />,
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
          ],
        },
      ]
    : []),
  // { id: 'settings', label: 'Settings', slug: 'settings', icon: <Settings /> },
]

export const SETTINGS_MENU: SidebarProps[] = [
  {
    id: 'settings',
    label: 'Settings',
    type: 'header',
    items: [
      { id: 'settings-general', label: 'General', slug: 'general', icon: <Settings /> },
      {
        id: 'settings-organization',
        label: 'Organization',
        slug: 'organization',
        icon: <Building2 />,
      },
      // { id: 'settings-appearance', label: 'Appearance', slug: 'appearance', icon: <SunMoon /> },
      { id: 'settings-snippets', label: 'Snippets', slug: 'snippets', icon: <Tag /> },
      { id: 'settings-signatures', label: 'Signatures', slug: 'signatures', icon: <Feather /> },

      // {
      //   id: 'settings-integrations',
      //   label: 'Integrations',
      //   slug: 'integrations',
      //   icon: <Waypoints />,
      // },

      { id: 'settings-apiKeys', label: 'API Keys', slug: 'apiKeys', icon: <ComponentIcon /> },
    ],
  },
  // Channels
  {
    id: 'channels',
    label: 'Channels',
    type: 'header',
    access: 'ADMIN',
    items: [
      {
        id: 'settings-channels',
        label: 'Channels',
        slug: 'channels',
        icon: <Waypoints />,
        access: 'ADMIN',
      },
      {
        id: 'settings-apps',
        label: 'Apps',
        slug: 'apps',
        icon: <AppWindow />,
      },
      {
        id: 'settings-webhooks',
        label: 'Webhooks',
        slug: 'webhooks',
        icon: <Webhook />,
        access: 'ADMIN',
      },

      // {
      //   id: 'settings-chat',
      //   label: 'Chat',
      //   slug: 'chat',
      //   icon: <MessageSquare />,
      // },

      // {
      //   id: 'integrations-email',
      //   label: 'Email Setup',
      //   slug: 'email',
      //   icon: <Mails />,
      // },

      // {
      //   id: 'integrations-google',
      //   label: 'Google',
      //   slug: 'google',
      //   icon: <GoogleIcon />,
      // },
      {
        id: 'integrations-shopify',
        label: 'Shopify',
        slug: 'shopify',
        icon: <ShopifyIcon />,
        access: 'ADMIN',
      },
    ],
  },
  // Admin
  {
    id: 'admin',
    label: 'Admin',
    type: 'header',
    access: 'ADMIN',
    items: [
      {
        id: 'settings-members',
        label: 'Members',
        slug: 'members',
        icon: <Users />,
        access: 'ADMIN',
      },
      { id: 'settings-groups', label: 'Groups', slug: 'groups', icon: <Folder />, access: 'ADMIN' },
      { id: 'settings-inboxes', label: 'Inboxes', slug: 'inbox', icon: <Inbox />, access: 'ADMIN' },

      // {
      //   id: 'admin-appearance',
      //   label: 'Appearance',
      //   slug: 'admin-appearance',
      //   icon: <CircleAlert />,
      //   access: 'ADMIN',
      // },

      // {
      //   id: 'admin-notifications',
      //   label: 'Notifications',
      //   slug: 'admin-notifications',
      //   icon: <MessagesSquare />,
      //   access: 'ADMIN',
      // },
      {
        id: 'settings-aiModels',
        label: 'AI Models',
        slug: 'aiModels',
        icon: <Bot />,
        access: 'ADMIN',
      },

      {
        id: 'admin-fields',
        label: 'Custom Entities & Fields',
        slug: 'custom-fields',
        icon: <Rows3 />,
        access: 'ADMIN',
      },
      { id: 'admin-tags', label: 'Tags', slug: 'tags', icon: <Tag />, access: 'ADMIN' },
      {
        id: 'admin-import-history',
        label: 'Import History',
        slug: 'import-history',
        icon: <Import />,
        access: 'ADMIN',
      },
      {
        id: 'admin-plans',
        label: 'Plans & Billing',
        slug: 'plans',
        icon: <Map />,
        access: 'ADMIN',
        cloudOnly: true,
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

// Application constants used across the monorepo
import { WEBAPP_URL, HOMEPAGE_URL } from './url'

export const constants = {
  app: { name: 'Auxx.ai', description: 'AI-powered email support ticket answer service' },

  pagination: { defaultPageSize: 25, maxPageSize: 100 },

  limits: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxAttachments: 5,
  },

  timing: {
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 days
  },

  /** App categories for marketplace */
  appCategories: [
    { value: 'analytics', label: 'Analytics', icon: 'BarChart3' },
    { value: 'autonomous', label: 'Autonomous', icon: 'Bot' },
    { value: 'billing', label: 'Billing', icon: 'CreditCard' },
    { value: 'calling', label: 'Calling', icon: 'Phone' },
    { value: 'customer-support', label: 'Customer Support', icon: 'Headphones' },
    { value: 'communication', label: 'Communication', icon: 'MessageSquare' },
    { value: 'forms-survey', label: 'Forms & Survey', icon: 'ClipboardList' },
    { value: 'product-management', label: 'Product Management', icon: 'Package' },
  ] as const,

  /** Workflow template categories */
  workflowCategories: [
    { value: 'all', label: 'All Templates', icon: 'LayoutGrid' },
    { value: 'customer-service', label: 'Customer Service', icon: 'Headphones' },
    { value: 'shopify', label: 'Shopify', icon: 'ShoppingBag' },
    { value: 'automation', label: 'Automation', icon: 'Zap' },
    { value: 'routing', label: 'Routing & Assignment', icon: 'GitBranch' },
    { value: 'ai', label: 'AI-Powered', icon: 'Sparkles' },
    { value: 'sales', label: 'Sales & Marketing', icon: 'TrendingUp' },
  ] as const,

  PRIVACY_URL: `${HOMEPAGE_URL}/privacy-policy`,
  IMPRINT_URL: `${HOMEPAGE_URL}/imprint`,
  TOS_URL: `${HOMEPAGE_URL}/terms-of-service`,
  IMPRINT_ADDRESS: '8811 S Test Drive, Inglewood, CA 90305',
} as const

/**
 * Reserved API slugs that cannot be used for custom entity definitions
 * These are system entity types and would conflict with built-in functionality
 */
export const RESERVED_API_SLUGS = [
  'thread',
  'message',
  'contact',
  'workflow',
  'ticket',
  'dataset',
  'user',
  'inbox',
  'participant',
  'file',
  'shopify',
  'kb',
  'auxx',
  'auxxai',
  'threads',
  'messages',
  'contacts',
  'workflows',
  'tickets',
  'datasets',
  'users',
  'inboxes',
  'participants',
  'files',
  'kbs',
] as const

export type ReservedApiSlug = (typeof RESERVED_API_SLUGS)[number]

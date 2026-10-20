// apps/homepage/src/app/_components/main/header-links.tsx

import {
  BarChart3,
  BookOpen,
  Bot,
  Bug,
  Cloud,
  Code,
  Database,
  Fan,
  GitBranch,
  Headset,
  HelpCircle,
  Library,
  MessagesSquare,
  Newspaper,
  Plug,
  Send,
  Shield,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  Wrench,
} from 'lucide-react'
import type React from 'react'
import { TapeMark } from '~/components/tape-mark'

export interface FeatureLink {
  href: string
  name: string
  description?: string
  icon: React.ReactElement
}

export interface PlatformGroup {
  name: string
  links: FeatureLink[]
}

export interface MobileLink {
  groupName?: string
  links?: FeatureLink[]
  name?: string
  href?: string
}

export const platformGroups: PlatformGroup[] = [
  {
    name: 'AI CRM',
    links: [
      {
        href: '/platform/crm',
        name: 'CRM',
        description: 'Contacts, companies & history',
        icon: <Users className='stroke-foreground fill-green-500/15' />,
      },
      {
        href: '/platform/ai/kopilot',
        name: 'Kopilot',
        description: 'AI grounded in your data',
        icon: <Sparkles className='stroke-foreground fill-amber-500/15' />,
      },
      {
        href: '/platform/ai/agents',
        name: 'Agents',
        description: 'AI workers that follow your playbook',
        icon: <Bot className='stroke-foreground fill-violet-500/15' />,
      },
      {
        href: '/platform/data-model',
        name: 'Knowledge base',
        description: 'Self-serve help articles',
        icon: <Library className='stroke-foreground fill-yellow-500/15' />,
      },
      {
        href: '/platform/data-model',
        name: 'Datasets',
        description: 'Docs & PDFs for AI',
        icon: <Database className='stroke-foreground fill-cyan-500/15' />,
      },
    ],
  },
  {
    name: 'Automation',
    links: [
      {
        href: '/platform/workflow',
        name: 'Workflow',
        description: 'Automate your processes',
        icon: <GitBranch className='stroke-foreground fill-purple-500/15' />,
      },
      {
        href: '/platform/sequences',
        name: 'Sequences',
        description: 'Reminders & follow-ups on autopilot',
        icon: <Send className='stroke-foreground fill-blue-500/15' />,
      },
      {
        href: '/platform/integration',
        name: 'Integration',
        description: 'Connect your business tools',
        icon: <Plug className='stroke-foreground fill-orange-500/15' />,
      },
    ],
  },
  {
    name: 'Operations',
    links: [
      {
        href: '/platform/ticketing',
        name: 'Ticketing',
        description: 'Resolve tickets at volume',
        icon: <Cloud className='stroke-foreground fill-teal-500/15' />,
      },
      {
        href: '/platform/manufacturing',
        name: 'Manufacturing',
        description: 'Parts, vendors & production',
        icon: <Shield className='stroke-foreground fill-blue-500/15' />,
      },
      {
        href: '/platform/dispatch',
        name: 'Dispatch',
        description: 'Field service scheduling & jobs',
        icon: <Truck className='stroke-foreground fill-orange-500/15' />,
      },
    ],
  },
  {
    name: 'Communication',
    links: [
      {
        href: '/platform/messaging',
        name: 'Messaging',
        description: 'Shared inbox with AI replies',
        icon: <MessagesSquare className='stroke-foreground fill-blue-500/15' />,
      },
      // {
      //   href: '/platform/live-chat',
      //   name: 'Live chat',
      //   description: 'Real-time chat for your site',
      //   icon: <Rocket className='stroke-foreground fill-orange-500/15' />,
      // },
    ],
  },
  {
    name: 'Insights',
    links: [
      {
        href: '/platform/reporting',
        name: 'Reporting',
        description: 'Live dashboards & analytics',
        icon: <BarChart3 className='stroke-foreground fill-sky-500/15' />,
      },
    ],
  },
]

export const platformLinks: FeatureLink[] = platformGroups.flatMap((group) => group.links)

// Single-item groups (e.g. Communication, Insights) are paired side by side
// in the mega-menu while keeping their own section titles.
export const singlePlatformGroups: PlatformGroup[] = platformGroups.filter(
  (group) => group.links.length === 1
)

/** The products column of Solutions: Auxx Builder is one product of three apps (Builder, PDF,
 * Estimator) on one page, `/builder`; PDF and Estimator link to their sections there. */
export const productLinks: FeatureLink[] = [
  {
    href: '/builder',
    name: 'Auxx Builder',
    description: 'Design the building',
    icon: <TapeMark app='builder' className='size-5' />,
  },
  {
    href: '/builder#pdf',
    name: 'Auxx PDF',
    description: 'Mark up and measure',
    icon: <TapeMark app='pdf' className='size-5' />,
  },
  {
    href: '/builder#estimator',
    name: 'Auxx Estimator',
    description: 'Price the job',
    icon: <TapeMark app='estimator' className='size-5' />,
  },
]

/** The Builder product's app; the header and menus point there instead of the auxx.ai sign-up. */
export const BUILDER_APP_URL = 'https://builder.auxx.ai'

export const useCases: FeatureLink[] = [
  {
    href: '/solutions/shopify-stores',
    name: 'For Shopify Stores',
    description: 'Automate e-commerce support',
    icon: <ShoppingBag className='stroke-foreground fill-emerald-500/25' />,
  },
  {
    href: '/solutions/small-business',
    name: 'For Small Businesses',
    description: 'Automate e-commerce support',
    icon: <ShoppingBag className='stroke-foreground fill-emerald-500/25' />,
  },
  {
    href: '/solutions/customer-support-teams',
    name: 'For Support Teams',
    description: 'Reduce workload by 70%',
    icon: <Headset className='stroke-foreground fill-indigo-500/15' />,
  },
]

export const industryLinks: FeatureLink[] = [
  {
    href: '/industries/hvac',
    name: 'HVAC',
    description: 'Dispatch & equipment records',
    icon: <Fan className='stroke-foreground fill-orange-500/15' />,
  },
  {
    href: '/industries/plumbing',
    name: 'Plumbing',
    description: 'Same-day dispatch & invoicing',
    icon: <Wrench className='stroke-foreground fill-sky-500/15' />,
  },
  {
    href: '/industries/pest-control',
    name: 'Pest Control',
    description: 'Recurring treatments & routes',
    icon: <Bug className='stroke-foreground fill-emerald-500/15' />,
  },
]

export const getResourceLinks = (docsUrl: string): FeatureLink[] => [
  {
    name: 'Documentation',
    href: docsUrl,
    icon: <BookOpen className='stroke-foreground fill-purple-500/15' />,
  },
  {
    name: 'Developer Docs',
    href: `${docsUrl}/developer`,
    icon: <Code className='stroke-foreground fill-blue-500/15' />,
  },
  {
    name: 'FAQ',
    href: '/faq',
    icon: <HelpCircle className='stroke-foreground fill-amber-500/15' />,
  },
  {
    name: 'Blog',
    href: '/blog',
    icon: <Newspaper className='stroke-foreground fill-rose-500/15' />,
  },
]

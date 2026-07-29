// apps/homepage/src/app/platform/integration/_components/integrations-marquee-section.tsx

import { Blocks, type LucideIcon, Mail, MessagesSquare, ShoppingCart, Truck } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { BrandMark } from '~/components/brand-mark'
import ChatWidget from '~/components/logos/chat-widget'
import { cn } from '~/lib/utils'
import { ENTITY_COLOR_CLASS, type EntityColor } from '../../ai/_mocks'

const grainSvg =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>"

interface Integration {
  name: string
  description: string
  /** Short uppercase label shown at the bottom of the card. */
  tag: string
  /** Brand mark under `/public`. Omit for the two surfaces that have no third-party brand. */
  logo?: string
  /** Fallback chip when there is no brand mark. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  /** Tints the fallback chip. Omit to render the icon on the same white tile the brands use. */
  color?: EntityColor
}

const channels: Integration[] = [
  {
    name: 'Gmail',
    description: 'Two-way sync on the Google inbox you already use.',
    tag: 'Channel',
    logo: '/images/brands/gmail.svg',
  },
  {
    name: 'Outlook',
    description: 'Microsoft 365 and Outlook.com mailboxes.',
    tag: 'Channel',
    logo: '/images/brands/outlook.svg',
  },
  {
    name: 'IMAP & SMTP',
    description: 'Any other mail host — no vendor lock-in.',
    tag: 'Channel',
    icon: Mail,
    color: 'indigo',
  },
  {
    name: 'Live chat',
    description: 'An embeddable widget for your storefront.',
    tag: 'Channel',
    icon: ChatWidget,
  },
  {
    name: 'Facebook',
    description: 'Page messages land in the same shared inbox.',
    tag: 'Channel',
    logo: '/images/brands/facebook.svg',
  },
  {
    name: 'Instagram',
    description: 'DMs and comment replies, threaded per contact.',
    tag: 'Channel',
    logo: '/images/brands/instagram.svg',
  },
  {
    name: 'SMS & WhatsApp',
    description: 'Text conversations alongside every other channel.',
    tag: 'Channel',
    logo: '/images/brands/apps/whatsapp.png',
  },
]

const apps: Integration[] = [
  {
    name: 'Shopify',
    description: 'Orders, customers, products, and fulfillments.',
    tag: 'Commerce',
    logo: '/images/brands/apps/shopify.png',
  },
  {
    name: 'Stripe',
    description: 'Payments, subscriptions, and refunds.',
    tag: 'Commerce',
    logo: '/images/brands/apps/stripe.png',
  },
  {
    name: 'QuickBooks',
    description: 'Keep invoices and customers in sync.',
    tag: 'Commerce',
    logo: '/images/brands/apps/quickbooks.png',
  },
  {
    name: 'Slack',
    description: 'Notify a channel or hand a thread to your team.',
    tag: 'Team',
    logo: '/images/brands/apps/slack.png',
  },
  {
    name: 'Microsoft Teams',
    description: 'The same alerts and handoffs inside Teams.',
    tag: 'Team',
    logo: '/images/brands/apps/ms-teams.png',
  },
  {
    name: 'Discord',
    description: 'Reach community-first audiences where they are.',
    tag: 'Team',
    logo: '/images/brands/apps/discord.png',
  },
  {
    name: 'Telegram',
    description: 'Bot-driven conversations and alerts.',
    tag: 'Team',
    logo: '/images/brands/apps/telegram.png',
  },
  {
    name: 'Twilio',
    description: 'Programmable SMS and voice.',
    tag: 'Team',
    logo: '/images/brands/apps/twilio.png',
  },
  {
    name: 'HubSpot',
    description: 'Sync contacts, companies, and deals both ways.',
    tag: 'CRM',
    logo: '/images/brands/apps/hubspot.png',
  },
  {
    name: 'Airtable',
    description: 'Read and write the bases your ops team lives in.',
    tag: 'CRM',
    logo: '/images/brands/apps/airtable.png',
  },
  {
    name: 'GitHub',
    description: 'File an issue without leaving the thread.',
    tag: 'Dev',
    logo: '/images/brands/apps/github.png',
  },
  {
    name: 'Jira',
    description: 'File and track engineering work from a ticket.',
    tag: 'Dev',
    logo: '/images/brands/apps/jira.png',
  },
  {
    name: 'Supabase',
    description: 'Query your own tables as part of a workflow.',
    tag: 'Dev',
    logo: '/images/brands/apps/supabase.png',
  },
  {
    name: 'Notion',
    description: 'Pages and databases as a working surface.',
    tag: 'Productivity',
    logo: '/images/brands/apps/notion.png',
  },
  {
    name: 'Google Calendar',
    description: 'Read availability and book from a conversation.',
    tag: 'Productivity',
    logo: '/images/brands/apps/gog-calendar.png',
  },
  {
    name: 'Google Contacts',
    description: 'Keep people records aligned across both systems.',
    tag: 'Productivity',
    logo: '/images/brands/apps/gog-contacts.png',
  },
  {
    name: 'Google Sheets',
    description: 'Append rows and read reference tables.',
    tag: 'Productivity',
    logo: '/images/brands/apps/gog-sheets.png',
  },
  {
    name: 'FedEx',
    description: 'Live tracking on every shipment.',
    tag: 'Shipping',
    logo: '/images/brands/apps/fedex.png',
  },
  {
    name: 'UPS',
    description: 'Delivery status answered before the customer asks.',
    tag: 'Shipping',
    logo: '/images/brands/apps/ups.png',
  },
  {
    name: 'WhatsApp Business',
    description: 'Templates, media, and session messaging.',
    tag: 'Messaging',
    logo: '/images/brands/apps/whatsapp.png',
  },
]

const allIntegrations = [...channels, ...apps]

// Alternating split so channels are spread across both rows rather than stacked in the first.
const rowOne = allIntegrations.filter((_, i) => i % 2 === 0)
const rowTwo = allIntegrations.filter((_, i) => i % 2 === 1)

type CategoryTone = 'blue' | 'emerald' | 'purple' | 'red'

interface Category {
  name: string
  description: string
  icon: LucideIcon
  tone: CategoryTone
}

const categories: Category[] = [
  {
    name: 'Channels',
    description: 'Email, chat, social, and SMS in one inbox.',
    icon: MessagesSquare,
    tone: 'blue',
  },
  {
    name: 'Commerce & billing',
    description: 'Orders, subscriptions, and invoices at hand.',
    icon: ShoppingCart,
    tone: 'emerald',
  },
  {
    name: 'Business tools',
    description: 'CRM, docs, sheets, and project trackers.',
    icon: Blocks,
    tone: 'purple',
  },
  {
    name: 'Shipping',
    description: 'Live tracking on the carriers you use.',
    icon: Truck,
    tone: 'red',
  },
]

const CATEGORY_TONE_CLASSES: Record<CategoryTone, string> = {
  blue: 'bg-blue-100 dark:bg-blue-500/10 to-sky-100 dark:to-sky-500/10 hover:bg-blue-50 dark:hover:bg-blue-500/15',
  emerald:
    'bg-emerald-100 dark:bg-emerald-500/10 to-sky-100 dark:to-sky-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/15',
  purple:
    'bg-purple-100 dark:bg-purple-500/10 to-fuchsia-100 dark:to-fuchsia-500/10 hover:bg-purple-50 dark:hover:bg-purple-500/15',
  red: 'bg-red-100 dark:bg-red-500/10 to-rose-100 dark:to-rose-500/10 hover:bg-red-50 dark:hover:bg-red-500/15',
}

const CATEGORY_ICON_CLASSES: Record<CategoryTone, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  purple: 'text-purple-600 dark:text-purple-400',
  red: 'text-red-600 dark:text-red-400',
}

/**
 * Scrolling wall of every channel and app Auxx ships, above a four-up category grid.
 * Pure CSS marquee — no client JS.
 */
export default function IntegrationsMarqueeSection() {
  return (
    <section
      id='integrations'
      className='relative bg-muted/25 border-b border-foreground/10 overflow-hidden scroll-mt-24'>
      <div className='mx-auto max-w-6xl px-6 pt-24 pb-12 text-center'>
        <h2 className='mx-auto max-w-2xl text-balance text-4xl font-semibold md:text-5xl'>
          Everything your business runs on, in one workspace.
        </h2>
        <p className='text-muted-foreground mx-auto mt-4 max-w-xl'>
          Channels, storefronts, billing, and the tools your team already lives in. Connect them in
          a click and let your agents act across all of them.
        </p>
      </div>

      <div className='mx-auto max-w-4xl px-6 pb-12'>
        <ul className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
          {categories.map((category) => (
            <CategoryCard key={category.name} category={category} />
          ))}
        </ul>
      </div>

      <div className='relative pt-3 pb-24 [--marquee:70s] [mask-image:linear-gradient(to_right,transparent,black_8rem,black_calc(100%-8rem),transparent)]'>
        <ul className='flex w-max gap-3 animate-[marquee_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {[...rowOne, ...rowOne].map((integration, i) => (
            <IntegrationCard key={i} integration={integration} />
          ))}
        </ul>

        <ul className='mt-3 flex w-max gap-3 animate-[marquee-reverse_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {[...rowTwo, ...rowTwo].map((integration, i) => (
            <IntegrationCard key={i} integration={integration} />
          ))}
        </ul>
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes marquee-reverse {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </section>
  )
}

function CategoryCard({ category }: { category: Category }) {
  const Icon = category.icon
  return (
    <li
      className={cn(
        'bg-linear-to-b inset-ring-foreground/10 inset-ring-1 ring-foreground/[0.04] ring-offset-background from-white dark:from-background via-white/50 dark:via-background/50 relative grid overflow-hidden rounded-xl p-4 ring-1 ring-offset-2 transition-colors duration-200',
        CATEGORY_TONE_CLASSES[category.tone]
      )}>
      <Icon className={cn('relative z-10 size-6', CATEGORY_ICON_CLASSES[category.tone])} />
      <div className='relative z-10 mt-6 space-y-0.5'>
        <div className='text-foreground text-sm font-medium'>{category.name}</div>
        <p className='text-foreground/60 text-xs'>{category.description}</p>
      </div>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 mix-blend-overlay'
        style={{ backgroundImage: `url("${grainSvg}")`, backgroundSize: '160px 160px' }}
      />
    </li>
  )
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const Icon = integration.icon
  return (
    <li className='bg-card/75 ring-border-illustration shadow-black/6.5 flex w-72 shrink-0 flex-col rounded-2xl p-4 text-left shadow-lg ring-1'>
      {integration.logo ? (
        <BrandMark src={integration.logo} name={integration.name} />
      ) : (
        Icon && (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              integration.color
                ? ENTITY_COLOR_CLASS[integration.color]
                : 'bg-white ring-1 ring-black/5'
            )}>
            <Icon className={integration.color ? 'size-4' : 'size-5'} />
          </span>
        )
      )}
      <div className='text-foreground mt-3 text-sm font-medium'>{integration.name}</div>
      <p className='text-muted-foreground mt-1 text-xs'>{integration.description}</p>
      <div className='text-muted-foreground/60 mt-auto pt-3 text-[10px] uppercase tracking-wide'>
        {integration.tag}
      </div>
    </li>
  )
}

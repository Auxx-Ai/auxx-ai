// apps/homepage/src/app/platform/data-model/_components/kb-surfaces-carousel.tsx

import { Bot, Globe, type LucideIcon, Mail, MessageSquare, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import { KbSurfaceCard } from './kb-surface-card'
import { AutoReplyHero } from './surfaces/auto-reply-hero'
import { KopilotHero } from './surfaces/kopilot-hero'
import { PortalHero } from './surfaces/portal-hero'
import { SerpHero } from './surfaces/serp-hero'
import { WidgetHero } from './surfaces/widget-hero'

type Surface = {
  title: string
  icon: LucideIcon
  bgClass: string
  accentClass?: string
  tone?: 'light' | 'dark'
  Hero: ComponentType
}

const surfaces: Surface[] = [
  {
    title: 'Self-service portal',
    icon: Globe,
    bgClass: 'bg-[#FDEDE7] dark:bg-[#2A1E1A]',
    accentClass: 'bg-orange-400/20 text-orange-700 dark:text-orange-300',
    Hero: PortalHero,
  },
  {
    title: 'Help widget',
    icon: MessageSquare,
    bgClass: 'bg-[#EDF6FD] dark:bg-[#1A2230]',
    accentClass: 'bg-sky-400/20 text-sky-700 dark:text-sky-300',
    Hero: WidgetHero,
  },
  {
    title: 'AI auto-reply',
    icon: Mail,
    bgClass: 'bg-[#EDFDED] dark:bg-[#1A2A20]',
    accentClass: 'bg-emerald-400/20 text-emerald-700 dark:text-emerald-300',
    Hero: AutoReplyHero,
  },
  {
    title: 'Kopilot grounding',
    icon: Bot,
    bgClass: 'bg-[#EFEDFD] dark:bg-[#221E2E]',
    accentClass: 'bg-violet-400/20 text-violet-700 dark:text-violet-300',
    Hero: KopilotHero,
  },
  {
    title: 'Public search',
    icon: Sparkles,
    bgClass:
      'bg-gradient-to-br from-zinc-800 via-zinc-900 to-black dark:from-zinc-900 dark:via-zinc-950 dark:to-black',
    tone: 'dark',
    Hero: SerpHero,
  },
]

export function KbSurfacesCarousel() {
  return (
    <div>
      <div className='flex snap-x snap-mandatory items-start gap-4 overflow-x-auto scroll-smooth scroll-pl-6 px-6 py-[60px] md:scroll-pl-12 md:px-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {surfaces.map((s) => (
          <KbSurfaceCard
            key={s.title}
            title={s.title}
            icon={s.icon}
            bgClass={s.bgClass}
            accentClass={s.accentClass}
            tone={s.tone}>
            <s.Hero />
          </KbSurfaceCard>
        ))}
      </div>
    </div>
  )
}

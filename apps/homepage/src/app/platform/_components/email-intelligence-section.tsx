// apps/web/src/app/(website)/features/_components/sections/email-intelligence-section.tsx
import { Card } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { ArrowUpRight, Bot, MailCheck, SlidersHorizontal, Sparkles, Target } from 'lucide-react'

// Enumerates the email management capabilities rendered in the features grid.
const emailManagementCapabilities = [
  {
    title: 'Auto-categorization',
    description:
      'Understands topic, sentiment, and customer segment to tag every ticket instantly.',
  },
  {
    title: 'Priority detection',
    description:
      'Routes escalations and VIP customers to humans while automation handles the rest.',
  },
  {
    title: 'Multi-channel coverage',
    description: 'Email, chat, social, SMS, and reviews stay in sync with unified replies.',
  },
  {
    title: 'Spam filtering',
    description:
      'Adaptive filtering learns from team feedback to keep noise out of shared inboxes.',
  },
]

// Describes the AI intelligence differentiators for alternating content blocks.
const aiIntelligenceHighlights = [
  {
    icon: Bot,
    eyebrow: 'Intent layers',
    title: 'Understands nuance beyond keywords',
    body: 'Hybrid semantic retrieval and policy graphs interpret complicated customer requests with empathy and precision.',
    statLabel: 'Escalations prevented',
    statValue: '63%',
  },
  {
    icon: Target,
    eyebrow: 'Guided actions',
    title: 'Acts on your workflows automatically',
    body: 'Execute refunds, replacements, loyalty perks, and shipping updates directly from Auxx.ai with auditable guardrails.',
    statLabel: 'Manual tasks automated',
    statValue: '4.7 hours saved / agent',
  },
  {
    icon: SlidersHorizontal,
    eyebrow: 'Dynamic policies',
    title: 'Adapts tone and policy in real time',
    body: 'Conditional rules adjust voice, empathy level, and compliance requirements based on ticket type and customer value.',
    statLabel: 'Brand alignment score',
    statValue: '98/100',
  },
]

// Renders the email management grid and the AI intelligence alternating layout.
export function EmailIntelligenceSection() {
  return (
    <section id="email-automation" className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <div className="w-full px-6 py-24">
            <div className="grid gap-12 lg:grid-cols-[0.6fr_1.4fr]">
              <div className="space-y-4">
                <Badge variant="outline" className="w-fit">
                  Inbox mastery
                </Badge>
                <h2 className="text-pretty text-3xl font-semibold sm:text-4xl">
                  Email management that stays ten steps ahead
                </h2>
                <p className="text-muted-foreground text-base">
                  Auxx.ai centralizes every ticket, enriches with customer data, and categorizes in
                  milliseconds. Intelligent routing keeps automation safe while surfacing the
                  conversations humans should own.
                </p>
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 text-sm text-muted-foreground">
                  Native Gmail and Outlook connectors mean you keep your existing email addresses
                  while Auxx.ai powers the replies, triage, and analytics at scale.
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {emailManagementCapabilities.map((capability) => (
                  <Card
                    key={capability.title}
                    className="border-border/60 flex flex-col gap-3 rounded-2xl border p-6">
                    <MailCheck className="h-6 w-6 text-indigo-500" />
                    <div className="text-lg font-semibold text-foreground">{capability.title}</div>
                    <p className="text-sm text-muted-foreground">{capability.description}</p>
                    <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                      <span>Adaptive learning from feedback</span>
                      <ArrowUpRight className="h-4 w-4" />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

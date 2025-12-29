// apps/web/src/app/(website)/features/_components/sections/analytics-and-reporting-section.tsx
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { StatCards } from '~/components/ui/stat-card'
import { Activity, BarChart3, Gauge, PieChart } from 'lucide-react'

// Holds the KPI stat data visualized in the analytics section.
const analyticsStats = [
  {
    title: 'Automation rate',
    body: '71%',
    description: 'Tickets resolved without human intervention',
    icon: <Gauge className="h-4 w-4 text-indigo-500" />,
  },
  {
    title: 'CSAT uplift',
    body: '+24%',
    description: 'Improved survey scores after 30 days',
    icon: <Activity className="h-4 w-4 text-indigo-500" />,
  },
  {
    title: 'Time saved',
    body: '4.7h',
    description: 'Average weekly savings per agent',
    icon: <BarChart3 className="h-4 w-4 text-indigo-500" />,
  },
  {
    title: 'Revenue protected',
    body: '$126k',
    description: 'Monthly refunds prevented with AI guardrails',
    icon: <PieChart className="h-4 w-4 text-indigo-500" />,
  },
]

// Defines reporting modules and dashboards showcased in the analytics section.
const reportingModules = [
  {
    title: 'Automation insights',
    description:
      'Track adoption by channel, policy category, and agent assist usage with real-time dashboards.',
  },
  {
    title: 'Revenue attribution',
    description:
      'Quantify upsell and cross-sell conversions driven by AI recommendations in every channel.',
  },
  {
    title: 'Quality reviews',
    description: 'Sample AI replies, run QA scorecards, and share coaching notes with a click.',
  },
]

// Describes use case scenarios for the analytics storytelling carousel.
const scenarioCards = [
  {
    title: 'Holiday surge readiness',
    detail: 'Model spikes, forecast staffing needs, and pre-train the AI for seasonal promotions.',
  },
  {
    title: 'Product launch support',
    detail: 'Spin up playbooks with product data, macros, and escalation rules days before launch.',
  },
  {
    title: 'Retention save flows',
    detail:
      'Detect churn risk in real time and trigger loyalty offers backed by historical outcomes.',
  },
]

// Renders the analytics dashboards, reporting modules, and use case scenarios.
export function AnalyticsAndReportingSection() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <div className="w-full px-6 py-24">
            <Badge variant="outline" className="mb-6 w-fit">
              Analytics & reporting
            </Badge>
            <h2 className="text-pretty text-3xl font-semibold sm:text-4xl">
              See impact in real time across every channel
            </h2>
            <p className="text-muted-foreground mt-4 max-w-3xl text-base">
              Observe automation performance, customer satisfaction, and savings in the same
              dashboard. Auxx.ai makes it easy to share wins with leadership and identify the next
              workflow to automate.
            </p>

            <div className="mt-8 overflow-hidden rounded-3xl border border-border/60">
              <StatCards
                cards={analyticsStats}
                columns={{ default: 'grid-cols-1', md: 'md:grid-cols-4' }}
              />
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {reportingModules.map((module) => (
                <Card
                  key={module.title}
                  className="border-border/60 flex flex-col gap-3 rounded-3xl border p-6">
                  <div className="text-lg font-semibold text-foreground">{module.title}</div>
                  <p className="text-sm text-muted-foreground">{module.description}</p>
                  <div className="mt-auto text-xs text-muted-foreground">
                    Export to CSV, Sheets, or BI tools
                  </div>
                </Card>
              ))}
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {scenarioCards.map((card) => (
                <Card
                  key={card.title}
                  className="border-border/60 rounded-3xl border bg-muted/50 p-6">
                  <div className="text-sm font-semibold text-indigo-500 uppercase tracking-wide">
                    Scenario
                  </div>
                  <div className="text-lg font-semibold text-foreground">{card.title}</div>
                  <p className="text-sm text-muted-foreground">{card.detail}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

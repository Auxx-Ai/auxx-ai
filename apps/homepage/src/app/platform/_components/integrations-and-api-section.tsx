// apps/web/src/app/(website)/features/_components/sections/integrations-and-api-section.tsx
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { ArrowRight, Blocks, Code2, PlugZap } from 'lucide-react'

// Details the Shopify integration workflow steps for the integrations spotlight.
const shopifyIntegrationSteps = [
  {
    title: 'Connect store in 5 minutes',
    detail: 'OAuth flow links Auxx.ai to your Shopify admin without scripts or theme changes.',
  },
  {
    title: 'Sync historical context',
    detail: 'Orders, products, discounts, and customer tags stay synchronized in real time.',
  },
  {
    title: 'Automate fulfillment tasks',
    detail: 'Trigger refunds, exchanges, and loyalty perks with approvals built into the workflow.',
  },
]

// Provides API and developer feature highlights for the code demo callout.
const apiHighlights = [
  {
    title: 'REST & GraphQL',
    detail:
      'Typed responses via SDKs for TypeScript, Python, and Ruby with full schema introspection.',
  },
  {
    title: 'Webhooks and events',
    detail:
      'Subscribe to automation lifecycle events, escalations, and analytics right in your stack.',
  },
  {
    title: 'Sandbox environments',
    detail: 'Spin up staging workspaces with synthetic data for safe testing and QA.',
  },
]

// Renders the integrations showcase and API playground teaser.
export function IntegrationsAndApiSection() {
  return (
    <section id="shopify-integration" className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <div className="w-full px-6 py-24">
            <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
              <Card className="border-border/60 relative overflow-hidden rounded-3xl border p-8">
                <Badge variant="outline" className="mb-4 w-fit">
                  Shopify native
                </Badge>
                <h2 className="text-pretty text-3xl font-semibold sm:text-4xl">
                  Deep Shopify integration, down to every SKU
                </h2>
                <p className="text-muted-foreground mt-4 text-base">
                  Auxx.ai is purpose-built for Shopify. Run proactive support, loyalty playbooks,
                  and fulfillment actions using live store data, not stale exports.
                </p>
                <div className="mt-8 grid gap-4">
                  {shopifyIntegrationSteps.map((step) => (
                    <div
                      key={step.title}
                      className="flex items-start gap-4 rounded-2xl border border-border/60 bg-muted/70 p-4">
                      <PlugZap className="mt-1 h-5 w-5 text-indigo-500" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">{step.title}</div>
                        <p className="text-xs text-muted-foreground">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border/60 px-3 py-1">Orders</span>
                  <span className="rounded-full border border-border/60 px-3 py-1">Customers</span>
                  <span className="rounded-full border border-border/60 px-3 py-1">Inventory</span>
                  <span className="rounded-full border border-border/60 px-3 py-1">Discounts</span>
                  <span className="rounded-full border border-border/60 px-3 py-1">
                    Subscriptions
                  </span>
                </div>
              </Card>

              <Card
                id="api"
                className="border-border/60 flex flex-col gap-6 rounded-3xl border p-8">
                <Badge variant="outline" className="w-fit">
                  Developer-first
                </Badge>
                <h3 className="text-foreground text-2xl font-semibold">
                  API examples and live playground
                </h3>
                <p className="text-muted-foreground text-sm">
                  Fetch AI drafts, push contextual data, or build custom workflows. The Auxx.ai API
                  exposes every automation capability with fine-grained scopes.
                </p>
                <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/10 p-4 text-xs text-muted-foreground">
                  <code>
                    {`POST /v1/tickets/{id}/generate-reply\nAuthorization: Bearer <token>\n\n{\n  "tone": "reassuring",\n  "language": "en-US",\n  "policy": "refund-level-2"\n}`}
                  </code>
                </div>
                <div className="grid gap-3">
                  {apiHighlights.map((highlight) => (
                    <div
                      key={highlight.title}
                      className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/70 p-4">
                      <Blocks className="mt-1 h-5 w-5 text-indigo-500" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {highlight.title}
                        </div>
                        <p className="text-xs text-muted-foreground">{highlight.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" className="mt-auto w-fit gap-2">
                  <Code2 className="h-4 w-4" />
                  Open API docs
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

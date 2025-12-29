// apps/web/src/app/(website)/features/_components/sections/comparator-section.tsx
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'

// Describes the comparison table rows contrasting Auxx.ai with traditional solutions.
const comparisonRows = [
  {
    label: 'Setup time',
    auxx: 'Go live in 5 days with guided onboarding',
    competitor: '4-6 weeks of professional services',
  },
  {
    label: 'Shopify integration depth',
    auxx: 'Orders, discounts, inventory, custom metafields',
    competitor: 'Basic orders only, manual syncing',
  },
  {
    label: 'Pricing model',
    auxx: 'Flat rate per workspace, unlimited tickets',
    competitor: 'Per-seat licensing with ticket limits',
  },
  {
    label: 'Accuracy',
    auxx: '95% AI accuracy with continuous learning loops',
    competitor: '60-70% with manual prompt tuning',
  },
  {
    label: 'Open source option',
    auxx: 'Self-hostable gateway for regulated industries',
    competitor: 'Closed proprietary stack',
  },
]

// Renders the comparison table articulating Auxx.ai differentiation.
export function ComparatorSection() {
  return (
    <section className="relative border-foreground/10 border-y">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <div className="w-full px-6 py-24">
            <Card className="border-border/60 rounded-3xl border p-8">
              <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Badge variant="outline" className="w-fit">
                    Why Auxx.ai
                  </Badge>
                  <h2 className="text-pretty text-3xl font-semibold sm:text-4xl">
                    Compare Auxx.ai to legacy support platforms
                  </h2>
                </div>
                <p className="text-muted-foreground max-w-md text-sm">
                  Auxx.ai delivers faster time to value, deeper Shopify automation, and predictable
                  pricing—without compromising on compliance or customization.
                </p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border/60">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Capability</th>
                      <th className="px-4 py-3 text-indigo-500">Auxx.ai</th>
                      <th className="px-4 py-3">Typical legacy solution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {comparisonRows.map((row) => (
                      <tr key={row.label} className="bg-background/80">
                        <td className="px-4 py-4 font-medium text-foreground">{row.label}</td>
                        <td className="px-4 py-4 text-indigo-500">{row.auxx}</td>
                        <td className="px-4 py-4 text-muted-foreground">{row.competitor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}

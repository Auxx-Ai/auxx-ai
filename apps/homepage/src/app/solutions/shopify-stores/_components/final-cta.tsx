// apps/web/src/app/(website)/solutions/shopify-stores/_components/final-cta.tsx
import { Button } from '~/components/ui/button'
import Link from 'next/link'
import { Card } from '~/components/ui/card'

export default function CallToAction() {
  return (
    <section className="bg-muted py-12 md:py-24">
      <div className="mx-auto max-w-5xl px-6">
        <Card className="relative overflow-hidden p-8 shadow-lg md:px-32 md:py-20">
          <div className="text-muted pointer-events-none absolute inset-0 size-full translate-y-3/4 flex items-center justify-center">
            <div className="text-6xl md:text-8xl font-bold opacity-10">Auxx.ai</div>
          </div>
          <div className="relative text-center">
            <h2 className="text-balance text-3xl font-semibold md:text-4xl">
              Automate, Scale and Grow
            </h2>
            <p className="text-muted-foreground mb-6 mt-4 text-balance">
              Join successful Shopify merchants who have already discovered the power of AI-driven
              customer support automation.
            </p>

            <Button asChild>
              <Link href="/contact">Start Free Trial</Link>
            </Button>
          </div>
        </Card>
      </div>
    </section>
  )
}

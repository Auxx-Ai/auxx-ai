// apps/web/src/app/(website)/platform/crm/_components/customer-profiles-section.tsx
import { LayoutIllustration } from './layout-illustration'

export default function CustomerProfilesSection() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-15 border-b border-[var(--color-black)]"
          />
          <div className="bg-muted py-24 [--color-border:color-mix(in_oklab,var(--color-black)10%,transparent)] [--color-primary:var(--color-sky-600)] [--radius:1rem]">
            <div className="mx-auto w-full max-w-5xl px-6">
              <div className="relative">
                <div className="z-10 max-w-xl">
                  <h2 className="mb-4 text-4xl font-semibold">
                    Every Customer Story, Perfectly Organized
                  </h2>
                  <p className="mb-8 text-lg">
                    Get a complete 360-degree view of your customers.{' '}
                    <span className="text-muted-foreground">
                      Track interactions, purchase history, and preferences in one place.
                    </span>
                  </p>
                </div>

                <div className="-translate-x-44 md:translate-x-0">
                  <LayoutIllustration />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

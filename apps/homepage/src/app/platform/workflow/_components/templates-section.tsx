// apps/web/src/app/(website)/platform/workflow/_components/templates-section.tsx
export default function TemplatesSection() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <div className="py-20">
            <h2 className="text-3xl font-bold">Start Automating in Minutes</h2>
            <p className="mt-4 text-muted-foreground">Pre-built templates content</p>
          </div>
        </div>
      </div>
    </section>
  )
}
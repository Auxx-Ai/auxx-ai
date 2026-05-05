// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-testimonial.tsx

export default function KopilotTestimonial() {
  return (
    <section className='relative bg-background border-b border-foreground/10'>
      <div className='mx-auto max-w-4xl px-6 py-24 text-center'>
        <blockquote className='text-balance text-2xl font-medium md:text-3xl'>
          “Before every reply, Kopilot pulls the order, the policy, and prior tickets — so my team
          shows up to every conversation already prepared{' '}
          <span className='text-muted-foreground'>to close the case.</span>”
        </blockquote>
        <div className='mt-6 text-sm'>
          <div className='text-foreground font-medium'>Customer placeholder</div>
          <div className='text-muted-foreground'>Head of Support · Placeholder Co.</div>
        </div>
      </div>
    </section>
  )
}

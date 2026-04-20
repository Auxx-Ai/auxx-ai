// apps/web/src/app/(website)/_components/features-3-cols/uptime-illustration.tsx

// UptimeIllustration renders the uptime bar chart element used in the feature card.
export const UptimeIllustration = () => (
  <div
    aria-hidden
    className='bg-illustration/50 ring-border-illustration/10 space-y-2.5 rounded-2xl p-4 shadow shadow-black/10 ring-1'>
    <div className='flex justify-between text-sm'>
      <span className='text-muted-foreground'>Reply Rate</span>
      <span className='text-foreground'>95.0%</span>
    </div>
    <div className='flex justify-between gap-px'>
      {Array.from({ length: 38 }).map((_, index) => (
        <div
          key={index}
          className='[:nth-child(10)]:bg-muted-foreground [:nth-child(11)]:bg-muted-foreground [:nth-child(22)]:bg-muted-foreground [:nth-child(23)]:bg-muted-foreground [:nth-child(24)]:bg-muted-foreground [:nth-child(32)]:bg-muted-foreground h-7 w-1 rounded bg-emerald-500'></div>
      ))}
    </div>
  </div>
)

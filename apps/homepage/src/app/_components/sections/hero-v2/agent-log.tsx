// apps/homepage/src/app/_components/sections/hero-v2/agent-log.tsx
import { Check, Search } from 'lucide-react'

const rows = [
  { label: 'Retrieved', detail: '12 open VIP tickets' },
  { label: 'Analyzed', detail: '4 mention shipping delays' },
  { label: 'Drafted', detail: '12 replies · 4 tagged shipping-delay' },
]

export function AgentLog() {
  return (
    <div className='w-[340px] max-w-full rounded-xl border border-foreground/10 bg-background/95 p-4 shadow-2xl shadow-black/10 backdrop-blur'>
      <div className='mb-3 flex items-center gap-2 text-[11px] text-muted-foreground'>
        <Search className='size-3' />
        <span>Kopilot run · just now</span>
      </div>
      <div className='flex flex-col gap-2.5'>
        {rows.map((r) => (
          <div key={r.label} className='flex items-start gap-2.5'>
            <div className='mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary'>
              <Check className='size-2.5' strokeWidth={3} />
            </div>
            <div className='min-w-0 flex-1 text-xs'>
              <span className='font-medium text-foreground'>{r.label}</span>
              <span className='text-muted-foreground'> — {r.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

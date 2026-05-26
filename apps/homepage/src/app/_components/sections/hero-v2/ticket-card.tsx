// apps/homepage/src/app/_components/sections/hero-v2/ticket-card.tsx
import { Inbox, Sparkles } from 'lucide-react'

const tickets = [
  { name: 'Hannah W.', subject: 'Where is my order #4821?', time: '2m', unread: true },
  { name: 'Marco L.', subject: 'Refund for damaged item', time: '14m', unread: true },
  { name: 'Priya S.', subject: 'Can I change my shipping address?', time: '1h', unread: false },
  { name: 'Devon K.', subject: 'Discount code not working', time: '3h', unread: false },
]

export function TicketCard() {
  return (
    <div className='w-[560px] max-w-full overflow-hidden rounded-xl border border-foreground/10 bg-background/95 shadow-2xl shadow-black/10 backdrop-blur'>
      <div className='flex items-center gap-2 border-b border-foreground/10 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground'>
        <Inbox className='size-3.5' />
        <span className='font-medium text-foreground'>Inbox</span>
        <span>·</span>
        <span>12 open</span>
      </div>
      <div className='grid grid-cols-[220px_1fr]'>
        <div className='border-r border-foreground/10 bg-muted/20'>
          {tickets.map((t) => (
            <div
              key={t.name}
              className='flex items-start gap-2 border-b border-foreground/5 px-3 py-2.5 last:border-b-0'>
              <div
                className='mt-1 size-1.5 shrink-0 rounded-full bg-primary data-[unread=false]:bg-transparent'
                data-unread={t.unread}
              />
              <div className='min-w-0 flex-1'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='truncate text-xs font-medium text-foreground'>{t.name}</span>
                  <span className='text-[10px] text-muted-foreground'>{t.time}</span>
                </div>
                <div className='truncate text-[11px] text-muted-foreground'>{t.subject}</div>
              </div>
            </div>
          ))}
        </div>
        <div className='flex flex-col gap-3 p-4'>
          <div>
            <div className='text-xs font-medium text-foreground'>Hannah W.</div>
            <div className='text-[11px] text-muted-foreground'>Where is my order #4821?</div>
          </div>
          <div className='rounded-md bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground'>
            Hey — I placed an order last Tuesday but haven&apos;t seen any tracking yet. Can you
            check what&apos;s going on?
          </div>
          <div className='rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] leading-relaxed text-foreground'>
            <div className='mb-1 flex items-center gap-1 text-[10px] font-medium text-primary'>
              <Sparkles className='size-3' />
              Kopilot draft
            </div>
            Hi Hannah — order #4821 shipped Wednesday via UPS. Tracking: 1Z999AA10123456784.
            Expected delivery Friday.
          </div>
        </div>
      </div>
    </div>
  )
}

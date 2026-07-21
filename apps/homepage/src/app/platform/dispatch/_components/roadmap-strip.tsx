// apps/homepage/src/app/platform/dispatch/_components/roadmap-strip.tsx

import { Globe, MapPin, MessageSquare, Navigation } from 'lucide-react'

const items = [
  { icon: MapPin, label: 'Live GPS tracking' },
  { icon: Navigation, label: 'Customer "on the way" link' },
  { icon: Globe, label: 'Online request form' },
  { icon: MessageSquare, label: 'SMS notifications' },
]

export default function RoadmapStrip() {
  return (
    <div className='border-foreground/10 bg-muted/30 border-y'>
      <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-4 px-6 py-6'>
        <span className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          On the roadmap
        </span>
        <ul className='flex flex-wrap items-center justify-center gap-x-6 gap-y-3'>
          {items.map((item) => (
            <li key={item.label} className='flex items-center gap-2'>
              <item.icon className='text-muted-foreground size-4 shrink-0' />
              <span className='text-foreground text-sm'>{item.label}</span>
              <span className='border-foreground/15 text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-medium'>
                Coming
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

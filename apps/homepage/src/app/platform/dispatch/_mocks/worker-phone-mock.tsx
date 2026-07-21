// apps/homepage/src/app/platform/dispatch/_mocks/worker-phone-mock.tsx

import {
  Camera,
  Check,
  ChevronRight,
  Image as ImageIcon,
  MapPin,
  MoreVertical,
  Plus,
} from 'lucide-react'
import { cn } from '~/lib/utils'

/**
 * The worker's mobile surface — a static facsimile of the real visit page
 * (`apps/web/src/components/schedule/ui/visit-detail-content.tsx`, the same content the
 * desktop `VisitDrawer` hosts): Schedule breadcrumb, Visit/Notes outline tabs, the General
 * section with the one-tap advancing status button, and the Notes tab's quality checklist
 * with notes and photo capture. Rendered as two phones, one per tab.
 */
export function MockWorkerPhone({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto flex w-fit items-start', className)}>
      <PhoneFrame className='z-10 -rotate-1'>
        <VisitTabScreen />
      </PhoneFrame>
      <PhoneFrame className='-ml-8 mt-10 hidden rotate-2 sm:block'>
        <NotesTabScreen />
      </PhoneFrame>
    </div>
  )
}

function PhoneFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('w-60', className)}>
      <div className='rounded-[2rem] border border-foreground/10 bg-foreground/[0.03] p-1.5 shadow-xl shadow-black/10'>
        <div className='overflow-hidden rounded-[1.5rem] bg-mock-window pb-3 text-mock-window-foreground'>
          <div className='flex justify-center pt-2.5'>
            <div className='h-1 w-10 rounded-full bg-foreground/15' />
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Breadcrumb header — facsimile of the mobile `MainPageHeader` on the visit page. */
function BreadcrumbHeader() {
  return (
    <div className='flex items-center gap-1 px-3.5 pt-2.5 text-[10px]'>
      <span className='text-muted-foreground'>Schedule</span>
      <ChevronRight className='size-2.5 text-muted-foreground/60' />
      <span className='truncate font-medium'>Water heater install</span>
    </div>
  )
}

/** Visit/Notes tab bar — facsimile of the `outline` TabsList (`@auxx/ui` tabs). */
function TabBar({ active }: { active: 'visit' | 'notes' }) {
  return (
    <div className='mt-2 flex w-full items-center gap-1 border-b border-foreground/10 bg-muted/50 px-2 py-1'>
      {(['visit', 'notes'] as const).map((tab) => (
        <span
          key={tab}
          className={cn(
            'relative rounded-md px-2.5 py-0.5 text-[10px] font-medium capitalize',
            tab === active
              ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-foreground'
              : 'text-muted-foreground'
          )}>
          {tab}
        </span>
      ))}
    </div>
  )
}

/** Uppercase section header — facsimile of `@auxx/ui` `Section`'s title row. */
function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className='flex items-center gap-1 pb-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground'>
      {icon}
      {title}
    </div>
  )
}

const LINE_ITEMS = [
  { name: '50 gal water heater', qty: 1 },
  { name: 'Install labor (hrs)', qty: 3 },
]

function VisitTabScreen() {
  return (
    <>
      <BreadcrumbHeader />
      <TabBar active='visit' />

      <div className='border-b border-foreground/10 p-3'>
        <SectionTitle icon={<MapPin className='size-3' />} title='General' />
        <div className='flex flex-col gap-2'>
          <div>
            <div className='text-[11px] font-medium'>Nguyen Residence</div>
            <div className='text-[10px] text-sky-600 underline underline-offset-2 dark:text-sky-400'>
              418 Alder Grove Ln, Portland
            </div>
          </div>
          <div className='text-[10px] text-muted-foreground'>Mon, Jul 20 · 10:00 AM – 12:00 PM</div>
          <div className='text-[10px]'>#WO-1047 · Water heater install</div>
          <div className='flex items-center gap-1.5'>
            <span className='flex-1 rounded-md bg-foreground py-1.5 text-center text-[10px] font-medium text-background'>
              Arrived
            </span>
            <span className='flex size-6 items-center justify-center rounded-md text-muted-foreground'>
              <MoreVertical className='size-3' />
            </span>
          </div>
        </div>
      </div>

      <div className='border-b border-foreground/10 p-3'>
        <SectionTitle title='Instructions' />
        <p className='text-[10px] text-muted-foreground'>
          Gate code 4482. Shut off the water main before the swap — valve is in the garage.
        </p>
      </div>

      <div className='p-3 pb-1'>
        <SectionTitle title='Line items' />
        <ul className='flex flex-col gap-1.5'>
          {LINE_ITEMS.map((line) => (
            <li
              key={line.name}
              className='flex items-center justify-between gap-2 rounded-md border border-foreground/10 p-1.5 text-[10px]'>
              <span className='truncate font-medium'>{line.name}</span>
              <span className='shrink-0 text-muted-foreground'>Qty {line.qty}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

const CHECKLIST = [
  { label: 'Old unit hauled away', done: true },
  { label: 'Pressure valve tested', done: true, photos: 2 },
  { label: 'Customer walkthrough', done: false, required: true, expanded: true },
]

function QcCheckbox({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center rounded-[4px]',
        done ? 'bg-foreground text-background' : 'border border-muted-foreground/40'
      )}>
      {done && <Check className='size-2.5' />}
    </span>
  )
}

function NotesTabScreen() {
  return (
    <>
      <BreadcrumbHeader />
      <TabBar active='notes' />

      <div className='flex flex-col gap-0.5 p-3'>
        {CHECKLIST.map((item) => (
          <div key={item.label} className='rounded-md px-1 py-1'>
            <div className='flex items-center gap-2'>
              <QcCheckbox done={item.done} />
              <span
                className={cn(
                  'flex-1 truncate text-[10px]',
                  item.done && 'text-muted-foreground line-through'
                )}>
                {item.label}
              </span>
              {item.required && (
                <span className='shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[8px] font-medium text-amber-600 dark:text-amber-400'>
                  Required
                </span>
              )}
              {item.photos && (
                <span className='flex shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground'>
                  <ImageIcon className='size-2.5' />
                  {item.photos}
                </span>
              )}
            </div>

            {item.expanded && (
              <div className='mt-1.5 space-y-1.5 pl-5'>
                <div className='rounded-md border border-foreground/10 px-1.5 py-1 text-[9px] text-muted-foreground/70'>
                  Add a note…
                </div>
                <div className='flex items-center gap-1.5'>
                  <div className='flex size-9 items-center justify-center rounded-md bg-gradient-to-br from-muted to-muted-foreground/20'>
                    <Camera className='size-3 text-background/70' />
                  </div>
                  <div className='flex size-9 items-center justify-center rounded-md bg-gradient-to-br from-muted to-muted-foreground/20'>
                    <Camera className='size-3 text-background/70' />
                  </div>
                  <div className='flex size-9 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground/70'>
                    <Camera className='size-3' />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        <div className='mt-1.5 flex items-center gap-1.5'>
          <div className='flex-1 rounded-md border border-foreground/10 px-1.5 py-1 text-[9px] text-muted-foreground/70'>
            Add a check…
          </div>
          <span className='flex size-6 items-center justify-center rounded-md border border-foreground/10 text-muted-foreground'>
            <Plus className='size-3' />
          </span>
        </div>
      </div>
    </>
  )
}

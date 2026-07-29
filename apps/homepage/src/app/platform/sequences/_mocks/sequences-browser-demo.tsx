// apps/homepage/src/app/platform/sequences/_mocks/sequences-browser-demo.tsx

import { Mails, UserRoundPlus, UsersRound } from 'lucide-react'
import { MockAppSidebar, MockBrowserChrome, MockMainPage } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'
import { MockRunRow } from './mock-run-row'
import { MockSequenceHeader } from './mock-sequence-header'
import { MockStatsStrip } from './mock-stats-strip'
import { MOCK_RUNS } from './runs'

/**
 * The hero mock: the real `/app/workflows/sequences/[id]` surface — stats strip,
 * `Editor | Recipients` tabs, and the enrollment list — inside a browser frame.
 */
export function SequencesBrowserDemo({ className }: { className?: string }) {
  return (
    <div className={cn('text-left', className)}>
      <MockBrowserChrome variant='regular' url='app.auxx.ai/app/workflows/sequences'>
        <div className='flex h-[560px]'>
          <MockAppSidebar activeKey='workflows' className='hidden md:flex' />
          <MockMainPage
            header={
              <MockSequenceHeader
                trail={['Workflows', 'Sequences']}
                title='Invoice reminders'
                titleMobile='Invoices'
                trigger='Invoice sent'
              />
            }>
            <div className='flex h-full min-h-0 flex-col'>
              <MockStatsStrip />

              {/* Tabs — mirrors the real TabsList (border-b, outline triggers). */}
              <div className='flex items-center gap-1 border-b border-mock-window-border px-2 py-1.5'>
                <span className='inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-mock-window-muted'>
                  <Mails className='size-3.5' />
                  Editor
                </span>
                <span className='inline-flex items-center gap-1.5 rounded-md border border-mock-window-border bg-mock-window px-2.5 py-1 text-xs font-medium text-mock-window-foreground shadow-sm'>
                  <UsersRound className='size-3.5' />
                  Recipients
                </span>
              </div>

              <div className='flex min-h-0 flex-1 flex-col gap-2 px-3 py-3'>
                {/* Toolbar — status filter + enroll action. */}
                <div className='flex items-center gap-2'>
                  <span className='inline-flex h-7 items-center rounded-md border border-mock-window-border px-2.5 text-[11px] text-mock-window-muted'>
                    All
                  </span>
                  <span className='ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-mock-window-border px-2.5 text-[11px] font-medium text-mock-window-foreground'>
                    <UserRoundPlus className='size-3.5' />
                    Enroll contacts
                  </span>
                </div>

                <div className='divide-y divide-mock-window-border/70'>
                  {MOCK_RUNS.map((run) => (
                    <MockRunRow key={run.email} run={run} />
                  ))}
                </div>
              </div>
            </div>
          </MockMainPage>
        </div>
      </MockBrowserChrome>
    </div>
  )
}

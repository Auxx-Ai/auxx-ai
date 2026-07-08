// apps/homepage/src/app/platform/crm/_mocks/crm-browser-demo.tsx

'use client'

import { useState } from 'react'
import { MockAppSidebar, MockBrowserChrome, MockMainPage } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'
import { MockRecordsTable } from './mock-records-table'
import { MockRecordsTopbar } from './mock-records-topbar'
import { DEFAULT_PERSONA_KEY, PERSONAS, type PersonaConfig } from './personas'

/**
 * The hero's mock app browser plus the persona switcher chips below it.
 * Clicking a chip swaps the browser URL, sidebar Records group, top bar,
 * and records table to that persona's workspace.
 */
export function CrmBrowserDemo({ className }: { className?: string }) {
  const [activeKey, setActiveKey] = useState<PersonaConfig['key']>(DEFAULT_PERSONA_KEY)
  const persona = PERSONAS.find((p) => p.key === activeKey) ?? PERSONAS[0]

  return (
    <div className={cn('text-left', className)}>
      <MockBrowserChrome variant='regular' url={persona.url}>
        <div className='flex h-[560px]'>
          <MockAppSidebar
            activeKey={persona.activeRecordKey}
            recordItems={persona.records}
            className='hidden md:flex'
          />
          <MockMainPage
            header={<MockRecordsTopbar title={persona.pageTitle} newLabel={persona.newLabel} />}>
            <MockRecordsTable persona={persona} />
          </MockMainPage>
        </div>
      </MockBrowserChrome>

      <div className='mt-6 flex flex-wrap items-center justify-center gap-2'>
        {PERSONAS.map((p) => {
          const Icon = p.chipIcon
          const isActive = p.key === activeKey
          return (
            <button
              key={p.key}
              type='button'
              onClick={() => setActiveKey(p.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                isActive
                  ? 'border-foreground/20 bg-card font-medium text-foreground shadow-md'
                  : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}>
              <Icon className='size-3.5' />
              {p.chipLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

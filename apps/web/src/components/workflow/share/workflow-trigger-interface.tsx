// apps/web/src/components/workflow/share/workflow-trigger-interface.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Info, Moon, Settings, Sun, SunMoon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { WorkflowExecutionResult } from './workflow-execution-result'
import { useWorkflowShareStore } from './workflow-share-provider'
import { WorkflowTriggerForm } from './workflow-trigger-form'

/**
 * Main interface for triggering shared workflows
 * Layout: Form on left (400px), Results on right (grows)
 */
export function WorkflowTriggerInterface() {
  const siteInfo = useWorkflowShareStore((s) => s.siteInfo)
  const { theme, setTheme } = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)

  if (!siteInfo) return null

  const { site, triggerConfig } = siteInfo

  return (
    <div className='flex h-screen bg-primary-100'>
      {/* About Dialog */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent size='sm'>
          <DialogHeader>
            <DialogTitle>About {site.title}</DialogTitle>
            <DialogDescription className='whitespace-pre-wrap'>{site.about}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Left panel: Trigger form (always visible) */}
      <div className='relative h-screen w-[400px] border-r flex flex-col min-h-0'>
        <div className='overflow-y-auto flex-1 flex flex-col min-h-0'>
          {/* Header */}
          <div className='sticky top-0 z-10 border-b bg-background/50 p-4 backdrop-blur-sm'>
            <div className='flex items-start justify-between gap-2'>
              <div className='flex-1 min-w-0'>
                {site.logoUrl && (
                  <img src={site.logoUrl} alt={site.brandName} className='mb-2 h-8' />
                )}
                <h1 className='text-base font-bold'>{site.title}</h1>
                {site.description && (
                  <p className='mt-1 text-sm text-muted-foreground'>{site.description}</p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size='icon-xs' variant='ghost'>
                    <Settings />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <SunMoon />
                    Theme
                    <RadioTab
                      value={theme}
                      onValueChange={setTheme}
                      size='sm'
                      radioGroupClassName='grid w-16'
                      className='border h-6 border-primary-200 flex ml-auto'>
                      <RadioTabItem value='light' size='sm'>
                        <Sun />
                      </RadioTabItem>
                      <RadioTabItem value='dark' size='sm'>
                        <Moon />
                      </RadioTabItem>
                    </RadioTab>
                  </DropdownMenuItem>
                  {site.about && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
                        <Info />
                        About
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Content - Form always visible */}
          <div className='flex flex-col p-4 pb-16'>
            {triggerConfig.showInputForm && (
              <WorkflowTriggerForm submitButtonText={triggerConfig.submitButtonText} />
            )}
          </div>
        </div>

        {/* Footer */}
        {!site.hideBranding && (
          <div className='absolute bottom-0 left-0 right-0 z-10 flex h-10 px-4 items-center border-t bg-background/50 text-sm text-muted-foreground backdrop-blur-sm'>
            Powered by{' '}
            <a href='https://auxx.ai' className='underline ms-1'>
              Auxx.ai
            </a>
          </div>
        )}
      </div>

      {/* Right panel: Execution results */}
      <div className='h-full w-0 grow'>
        <WorkflowExecutionResult />
      </div>
    </div>
  )
}

// apps/web/src/components/kb/ui/sources/connect-source-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Kbd } from '@auxx/ui/components/kbd'
import { useHotkey } from '@tanstack/react-hotkeys'
import { ClipboardPaste, FileText, Globe, Plus, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { CrawlWebsiteWizard } from '../editor/crawl-website-wizard'
import { CreateKnowledgeSourceDialog } from '../editor/create-knowledge-source-dialog'

/**
 * Connect Source action for the `/app/kb` Sources tab. Step 0 is the connector
 * picker; today the Website crawler (headline) and Manual paste are live, with
 * Shopify / file-upload shown as roadmap. A source is its own container, so this
 * entry point is org-wide — KB linking happens inside the wizard / source settings.
 */
/**
 * @param registerShortcut - When true, binds the page-local `N` shortcut (opens
 *   the website crawler), shows the `<Kbd>` hint, and contributes the cmd+k
 *   actions. Set only on the shell's header instance so the sources empty-state
 *   copy doesn't double-register.
 */
export function ConnectSourceButton({
  variant = 'default',
  registerShortcut = false,
}: {
  variant?: 'default' | 'outline'
  registerShortcut?: boolean
} = {}) {
  const [crawlOpen, setCrawlOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  // Page-local shortcut: N opens the website crawler (the headline source).
  useHotkey('N', () => setCrawlOpen(true), { enabled: registerShortcut })

  return (
    <>
      {registerShortcut && (
        <CommandContext kind='page' label='Knowledge Bases'>
          <CommandAction
            label='Crawl a website'
            icon='globe'
            keywords='connect source crawl website url'
            shortcut={['N']}
            priority={10}
            perform={() => {
              useCommandPaletteStore.getState().close()
              setCrawlOpen(true)
            }}
          />
          <CommandAction
            label='Add source by manual paste'
            icon='clipboard'
            keywords='connect source manual paste text'
            priority={9}
            perform={() => {
              useCommandPaletteStore.getState().close()
              setManualOpen(true)
            }}
          />
        </CommandContext>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size='sm'>
            <Plus />
            Connect Source
            {registerShortcut && (
              <Kbd variant={variant === 'outline' ? 'outline' : 'default'} size='sm'>
                N
              </Kbd>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-52'>
          <DropdownMenuLabel>Connect a source</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setCrawlOpen(true)}>
            <Globe /> Crawl a website
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManualOpen(true)}>
            <ClipboardPaste /> Manual paste
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CrawlWebsiteWizard open={crawlOpen} onOpenChange={setCrawlOpen} />
      <CreateKnowledgeSourceDialog open={manualOpen} onOpenChange={setManualOpen} />
    </>
  )
}

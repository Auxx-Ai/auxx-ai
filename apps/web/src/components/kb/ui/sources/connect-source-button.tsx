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
import { ClipboardPaste, FileText, Globe, Plus, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { CrawlWebsiteWizard } from '../editor/crawl-website-wizard'
import { CreateKnowledgeSourceDialog } from '../editor/create-knowledge-source-dialog'

/**
 * Connect Source action for the `/app/kb` Sources tab. Step 0 is the connector
 * picker; today the Website crawler (headline) and Manual paste are live, with
 * Shopify / file-upload shown as roadmap. A source is its own container, so this
 * entry point is org-wide — KB linking happens inside the wizard / source settings.
 */
export function ConnectSourceButton({
  variant = 'default',
}: {
  variant?: 'default' | 'outline'
} = {}) {
  const [crawlOpen, setCrawlOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size='sm'>
            <Plus />
            Connect Source
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
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <FileText /> File upload (soon)
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <ShoppingBag /> Shopify (soon)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CrawlWebsiteWizard open={crawlOpen} onOpenChange={setCrawlOpen} />
      <CreateKnowledgeSourceDialog open={manualOpen} onOpenChange={setManualOpen} />
    </>
  )
}

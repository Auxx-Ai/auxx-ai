// apps/web/src/components/chat-widget/ui/settings/visitor-claim-picker-content.tsx

'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Braces } from 'lucide-react'
import { useState } from 'react'

interface VisitorOption {
  slug: 'name' | 'email' | 'externalId'
  label: string
}

const VISITOR_OPTIONS: VisitorOption[] = [
  { slug: 'name', label: 'Name' },
  { slug: 'email', label: 'Email' },
  { slug: 'externalId', label: 'External ID' },
]

interface VisitorClaimPickerContentProps {
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Flat-list picker for the chat-widget greeting editor. Only exposes the
 * three visitor identify claims (`visitor:name`, `visitor:email`,
 * `visitor:externalId`) — no roots, no breadcrumb, no other entity sources.
 */
export function VisitorClaimPickerContent({ onSelect, onClose }: VisitorClaimPickerContentProps) {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q
    ? VISITOR_OPTIONS.filter((o) => o.label.toLowerCase().includes(q))
    : VISITOR_OPTIONS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
          return
        }
        if (e.key === 'Backspace' && !search) {
          e.preventDefault()
          onClose()
        }
      }}>
      <CommandInput
        placeholder='Pick a visitor field...'
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>No fields found.</CommandEmpty>
        <CommandGroup heading='Visitor'>
          {filtered.map((o) => (
            <CommandItem
              key={o.slug}
              value={o.label}
              onSelect={() => onSelect(`visitor:${o.slug}`)}>
              <Braces className='size-4 text-muted-foreground' />
              <span>{o.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

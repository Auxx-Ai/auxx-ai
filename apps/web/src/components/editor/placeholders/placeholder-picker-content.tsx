// apps/web/src/components/editor/placeholders/placeholder-picker-content.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import { fieldRefToKey } from '@auxx/types/field'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  Braces,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  TicketIcon,
  User,
  UserCircle,
} from 'lucide-react'
import { useState } from 'react'
import { FieldPickerContent } from '~/components/pickers/field-picker'

type RootId = 'contact' | 'ticket' | 'thread' | 'user' | 'organization' | 'date'

interface RootChoice {
  id: RootId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const ROOTS: RootChoice[] = [
  { id: 'contact', label: 'Contact', icon: User },
  { id: 'ticket', label: 'Ticket', icon: TicketIcon },
  { id: 'thread', label: 'Thread', icon: MessageSquare },
  { id: 'user', label: 'Sender (you)', icon: UserCircle },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'date', label: 'Date', icon: Calendar },
]

interface DateOption {
  slug: 'today' | 'now' | 'tomorrow' | 'yesterday'
  label: string
}

const DATE_OPTIONS: DateOption[] = [
  { slug: 'today', label: 'Today' },
  { slug: 'now', label: 'Now' },
  { slug: 'tomorrow', label: 'Tomorrow' },
  { slug: 'yesterday', label: 'Yesterday' },
]

interface OrgOption {
  slug: 'name' | 'handle' | 'website'
  label: string
}

const ORG_OPTIONS: OrgOption[] = [
  { slug: 'name', label: 'Name' },
  { slug: 'handle', label: 'Handle' },
  { slug: 'website', label: 'Website' },
]

interface PlaceholderPickerContentProps {
  /** Invoked with the token id — caller inserts the placeholder node. */
  onSelect: (id: string) => void
  /** When provided, shows a back affordance from the root level (for embedded usage). */
  onBack?: () => void
}

/**
 * Placeholder picker. Two-level: root (entity-backed roots + `date`) →
 * field picker for that entity or static date list.
 *
 * Mirrors the pattern of `PromptTemplatePickerContent` — a plain content
 * component rendered inside the shared `InlinePickerPopover`.
 */
export function PlaceholderPickerContent({ onSelect, onBack }: PlaceholderPickerContentProps) {
  const [root, setRoot] = useState<RootId | null>(null)

  if (root === 'date') {
    return <DateListContent onBack={() => setRoot(null)} onSelect={onSelect} />
  }

  if (root === 'organization') {
    return <OrganizationListContent onBack={() => setRoot(null)} onSelect={onSelect} />
  }

  if (root !== null) {
    return (
      <FieldPickerForRoot
        entityDefinitionId={root}
        rootLabel={ROOTS.find((r) => r.id === root)?.label ?? root}
        onBack={() => setRoot(null)}
        onSelect={(fieldRef) => onSelect(fieldRefToKey(fieldRef))}
      />
    )
  }

  return <RootListContent onPick={setRoot} onBack={onBack} />
}

function RootListContent({
  onPick,
  onBack,
}: {
  onPick: (id: RootId) => void
  onBack?: () => void
}) {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? ROOTS.filter((r) => r.label.toLowerCase().includes(q)) : ROOTS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (!onBack) return
        if (e.key === 'Escape') {
          e.stopPropagation()
          onBack()
        } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
          e.preventDefault()
          onBack()
        }
      }}>
      {onBack && <BackBar label='Placeholder' onBack={onBack} parentLabel='Commands' />}
      <CommandInput
        placeholder='Pick a placeholder source...'
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>No sources found.</CommandEmpty>
        <CommandGroup heading='Insert from'>
          {filtered.map((r) => {
            const Icon = r.icon
            return (
              <CommandItem
                key={r.id}
                value={r.label}
                onSelect={() => onPick(r.id)}
                className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Icon className='size-4 text-muted-foreground' />
                  <span>{r.label}</span>
                </div>
                <ChevronRight className='size-4 opacity-50' />
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function DateListContent({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? DATE_OPTIONS.filter((d) => d.label.toLowerCase().includes(q)) : DATE_OPTIONS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onBack()
        } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
          e.preventDefault()
          onBack()
        }
      }}>
      <BackBar label='Date' onBack={onBack} parentLabel='Placeholder' />
      <CommandInput
        placeholder='Search dates...'
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>No dates found.</CommandEmpty>
        <CommandGroup heading='Date'>
          {filtered.map((d) => (
            <CommandItem key={d.slug} value={d.label} onSelect={() => onSelect(`date:${d.slug}`)}>
              <Braces className='size-4 text-muted-foreground' />
              <span>{d.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function OrganizationListContent({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? ORG_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : ORG_OPTIONS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onBack()
        } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
          e.preventDefault()
          onBack()
        }
      }}>
      <BackBar label='Organization' onBack={onBack} parentLabel='Placeholder' />
      <CommandInput
        placeholder='Search organization fields...'
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>No fields found.</CommandEmpty>
        <CommandGroup heading='Organization'>
          {filtered.map((o) => (
            <CommandItem key={o.slug} value={o.label} onSelect={() => onSelect(`org:${o.slug}`)}>
              <Braces className='size-4 text-muted-foreground' />
              <span>{o.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function FieldPickerForRoot({
  entityDefinitionId,
  rootLabel,
  onBack,
  onSelect,
}: {
  entityDefinitionId: string
  rootLabel: string
  onBack: () => void
  onSelect: (fieldRef: FieldReference) => void
}) {
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onBack()
        }
      }}>
      <BackBar label={rootLabel} onBack={onBack} parentLabel='Placeholder' />
      <FieldPickerContent
        entityDefinitionId={entityDefinitionId}
        onSelect={onSelect}
        mode='single'
        searchPlaceholder={`Search ${rootLabel.toLowerCase()} fields...`}
      />
    </div>
  )
}

function BackBar({
  label,
  parentLabel,
  onBack,
}: {
  label: string
  parentLabel: string
  onBack: () => void
}) {
  return (
    <button
      type='button'
      onClick={onBack}
      className='flex items-center w-full px-3 py-2 gap-1 text-xs text-muted-foreground border-b hover:bg-accent cursor-pointer'>
      <ChevronLeft className='size-3' />
      <span>{parentLabel}</span>
      <ChevronRight className='size-3' />
      <span className='text-foreground'>{label}</span>
    </button>
  )
}

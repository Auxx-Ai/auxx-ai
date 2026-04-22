// apps/web/src/components/editor/placeholders/placeholder-picker-content.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import { fieldRefToKey } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  type NavigationItem,
  useCommandNavigation,
  useCommandNavigationOptional,
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

/** Nav-stack item shape for the placeholder picker. */
interface PlaceholderNavItem extends NavigationItem {
  id: RootId
  label: string
}

interface PlaceholderPickerContentProps {
  /** Invoked with the token id — caller inserts the placeholder node. */
  onSelect: (id: string) => void
  /** When provided, shows a back affordance from the root level (for embedded usage). */
  onBack?: () => void
  /**
   * Label for the parent-back header shown at the root when `onBack` is
   * provided. Defaults to 'Back'. Pass the parent picker's name (e.g.
   * 'Commands') so the breadcrumb reads naturally.
   */
  backLabel?: string
  /**
   * When provided (and no `onBack`), Backspace/Escape at the empty root
   * search closes the entire popover. Caller should wire this to the
   * inline-picker hook's `closePicker`.
   */
  onClose?: () => void
}

/**
 * Placeholder picker. Two-level: root (entity-backed roots + `date`) →
 * field picker for that entity or static date list.
 *
 * Navigation reuses the shared `CommandNavigation` primitive so the
 * breadcrumb / back button match every other cmdk-based picker. When
 * rendered inside a host that already provides a `CommandNavigation`
 * (e.g. a future slash-command flow that pushes "Placeholder" onto the
 * outer stack), this component reuses the parent stack. Otherwise it
 * wraps itself in a scoped `CommandNavigation`.
 */
export function PlaceholderPickerContent(props: PlaceholderPickerContentProps) {
  const parentNav = useCommandNavigationOptional<PlaceholderNavItem>()

  if (parentNav) {
    return <PlaceholderPickerBody {...props} />
  }

  return (
    <CommandNavigation<PlaceholderNavItem>>
      <PlaceholderPickerBody {...props} />
    </CommandNavigation>
  )
}

function PlaceholderPickerBody({
  onSelect,
  onBack,
  onClose,
  backLabel = 'Back',
}: PlaceholderPickerContentProps) {
  const { current } = useCommandNavigation<PlaceholderNavItem>()
  const rootId = current?.id ?? null

  if (rootId === 'date') {
    return <DateListContent onSelect={onSelect} />
  }

  if (rootId === 'organization') {
    return <OrganizationListContent onSelect={onSelect} />
  }

  if (rootId !== null) {
    return (
      <FieldPickerForRoot
        entityDefinitionId={rootId}
        rootLabel={ROOTS.find((r) => r.id === rootId)?.label ?? rootId}
        onSelect={(fieldRef) => onSelect(fieldRefToKey(fieldRef))}
      />
    )
  }

  return <RootListContent onBack={onBack} backLabel={backLabel} onClose={onClose} />
}

function RootListContent({
  onBack,
  backLabel,
  onClose,
}: {
  onBack?: () => void
  backLabel: string
  onClose?: () => void
}) {
  const { push } = useCommandNavigation<PlaceholderNavItem>()
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? ROOTS.filter((r) => r.label.toLowerCase().includes(q)) : ROOTS

  // onBack wins (embedded use: go back one picker level).
  // onClose is the fallback (top-level use: close entire popover).
  const exit = onBack ?? onClose

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && exit) {
          e.stopPropagation()
          exit()
          return
        }
        if (e.key === 'Backspace' && !search && exit) {
          e.preventDefault()
          exit()
          return
        }
        if (e.key === 'ArrowRight') {
          // Drill into the highlighted root. Mirrors slash-command-picker's
          // DOM-query pattern (slash-command-picker.tsx:315-343).
          const selected = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
            '[cmdk-item][data-selected="true"]'
          )
          const value = selected?.getAttribute('data-value')?.toLowerCase()
          if (!value) return
          const rootChoice = ROOTS.find((r) => r.label.toLowerCase() === value)
          if (rootChoice) {
            e.preventDefault()
            push({ id: rootChoice.id, label: rootChoice.label })
          }
        }
      }}>
      {onBack && <ParentBackHeader label={backLabel} onBack={onBack} />}
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
                onSelect={() => push({ id: r.id, label: r.label })}
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

function DateListContent({ onSelect }: { onSelect: (id: string) => void }) {
  const { pop } = useCommandNavigation<PlaceholderNavItem>()
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? DATE_OPTIONS.filter((d) => d.label.toLowerCase().includes(q)) : DATE_OPTIONS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          pop()
        } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
          e.preventDefault()
          pop()
        }
      }}>
      <CommandBreadcrumb rootLabel='Placeholder' />
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

function OrganizationListContent({ onSelect }: { onSelect: (id: string) => void }) {
  const { pop } = useCommandNavigation<PlaceholderNavItem>()
  const [search, setSearch] = useState('')
  const q = search.toLowerCase().trim()
  const filtered = q ? ORG_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : ORG_OPTIONS

  return (
    <Command
      shouldFilter={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          pop()
        } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
          e.preventDefault()
          pop()
        }
      }}>
      <CommandBreadcrumb rootLabel='Placeholder' />
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
  onSelect,
}: {
  entityDefinitionId: string
  rootLabel: string
  onSelect: (fieldRef: FieldReference) => void
}) {
  const { pop } = useCommandNavigation<PlaceholderNavItem>()
  return (
    <>
      <CommandBreadcrumb rootLabel='Placeholder' />
      <FieldPickerContent
        entityDefinitionId={entityDefinitionId}
        onSelect={onSelect}
        mode='single'
        searchPlaceholder={`Search ${rootLabel.toLowerCase()} fields...`}
        onBackFromRoot={pop}
      />
    </>
  )
}

/**
 * Small back-to-parent-picker header shown at the root level of the
 * placeholder picker when it's embedded inside a larger picker (e.g.
 * slash-command). Mirrors `CommandBreadcrumb`'s visual language (ghost
 * back icon + ghost-button label) rather than being a full-width clickable
 * row — the old `BackBar` looked like a `CommandItem` because it had
 * `hover:bg-accent w-full`, which confused users.
 */
function ParentBackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className='flex items-center border-b px-2 py-1 text-sm shrink-0'>
      <Button variant='ghost' size='icon-xs' onClick={onBack}>
        <ChevronLeft />
        <span className='sr-only'>Back</span>
      </Button>
      <Button variant='ghost' size='xs' onClick={onBack}>
        {label}
      </Button>
    </div>
  )
}

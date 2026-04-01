// apps/web/src/app/(protected)/app/settings/channels/_components/email-list-dialog.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { cn } from '@auxx/ui/lib/utils'
import { Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { client } from '~/auth/auth-client'

/** Validates an email address or a bare domain. */
function isValidEntry(value: string): boolean {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true // email
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) return true // domain
  return false
}

interface EmailListDialogProps {
  title: string
  description: string
  placeholder?: string
  entries: string[]
  onSave: (entries: string[]) => void
  isPending: boolean
  onClose: () => void
  showUserEmailSuggestion?: boolean
}

export function EmailListDialog({
  title,
  description,
  placeholder = 'e.g. user@example.com or example.com',
  entries,
  onSave,
  isPending,
  onClose,
  showUserEmailSuggestion = false,
}: EmailListDialogProps) {
  const [localEntries, setLocalEntries] = useState<string[]>(entries)
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const { data: session } = client.useSession()
  const userEmail = session?.user?.email

  const addEntry = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return

    if (!isValidEntry(normalized)) {
      setInputError('Enter a valid email or domain')
      return
    }
    if (localEntries.includes(normalized)) {
      setInputError('Already added')
      return
    }

    setLocalEntries([...localEntries, normalized])
    setInputValue('')
    setInputError('')
  }

  const removeEntry = (entry: string) => {
    setLocalEntries(localEntries.filter((e) => e !== entry))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addEntry(inputValue)
    }
  }

  const showSuggestion =
    showUserEmailSuggestion && userEmail && !localEntries.includes(userEmail.trim().toLowerCase())

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1'>
            <InputGroup>
              <InputGroupInput
                placeholder={placeholder}
                value={inputValue}
                onChange={(e) => {
                  setInputValue((e.target as HTMLInputElement).value)
                  setInputError('')
                }}
                onKeyDown={handleKeyDown}
              />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='xs'
                  onClick={() => addEntry(inputValue)}
                  disabled={!inputValue.trim()}>
                  <Plus />
                  Add
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {inputError && <p className='text-xs text-destructive'>{inputError}</p>}
          </div>

          {showSuggestion && (
            <Button
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => addEntry(userEmail)}>
              <Plus />
              Add your email ({userEmail})
            </Button>
          )}

          {localEntries.length > 0 && (
            <div className='max-h-60 space-y-1 overflow-y-auto p-0.5'>
              {localEntries.map((entry) => (
                <InputGroup key={entry}>
                  <InputGroupInput value={entry} readOnly className='font-mono text-sm' />
                  <InputGroupAddon align='inline-end'>
                    <InputGroupButton
                      size='icon-xs'
                      variant='destructive-hover'
                      aria-label='Remove'
                      title='Remove'
                      className='mr-0.5 rounded-lg'
                      onClick={() => removeEntry(entry)}>
                      <Trash2 />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ))}
            </div>
          )}

          {localEntries.length === 0 && (
            <div className='rounded-lg border border-dashed py-6 text-center'>
              <p className='text-sm text-muted-foreground'>No entries added yet.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={onClose}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            onClick={() => onSave(localEntries)}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Saving...'>
            Save <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface EmailFilterSectionProps {
  icon: React.ReactNode
  title: string
  description: string
  emptyHint: string
  dialogTitle: string
  dialogDescription: string
  dialogPlaceholder?: string
  entries: string[]
  onSave: (entries: string[]) => void
  isPending: boolean
  activeWarning?: string
}

export function EmailFilterSection({
  icon,
  title,
  description,
  emptyHint,
  dialogTitle,
  dialogDescription,
  dialogPlaceholder,
  entries,
  onSave,
  isPending,
  activeWarning,
}: EmailFilterSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const hasEntries = entries.length > 0
  const visibleEntries = expanded ? entries : entries.slice(0, 4)
  const hiddenCount = entries.length - 4

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
          {icon} {title}
        </div>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
      <div
        className={cn(
          'group flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 transition-colors duration-200 hover:bg-muted',
          !hasEntries && 'opacity-80'
        )}>
        <div className={cn('flex min-w-0 flex-1 items-start gap-3', !hasEntries && 'items-center')}>
          <div className='mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted transition-colors group-hover:bg-secondary'>
            {icon}
          </div>
          {hasEntries ? (
            <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1 pt-1'>
              <span className='text-sm font-medium'>
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </span>
              {visibleEntries.map((entry) => (
                <Badge key={entry} variant='secondary' size='sm'>
                  {entry}
                </Badge>
              ))}
              {hiddenCount > 0 && (
                <button
                  type='button'
                  className='text-xs text-muted-foreground hover:text-foreground'
                  onClick={() => setExpanded(!expanded)}>
                  {expanded ? 'show less' : `and ${hiddenCount} more`}
                </button>
              )}
              {activeWarning && (
                <span className='basis-full text-xs text-amber-600'>{activeWarning}</span>
              )}
            </div>
          ) : (
            <span className='mt-1 text-sm text-muted-foreground'>{emptyHint}</span>
          )}
        </div>
        <Button
          variant='outline'
          size='sm'
          className='shrink-0 self-center'
          onClick={() => setDialogOpen(true)}>
          {hasEntries ? <Edit /> : <Plus />}
          {hasEntries ? 'Edit' : 'Add'}
        </Button>
      </div>

      {dialogOpen && (
        <EmailListDialog
          title={dialogTitle}
          description={dialogDescription}
          placeholder={dialogPlaceholder}
          entries={entries}
          onSave={(newEntries) => {
            onSave(newEntries)
            setDialogOpen(false)
          }}
          isPending={isPending}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}

// apps/web/src/components/agents/ui/detail/agent-hero.tsx
'use client'

import { agentSlugSchema } from '@auxx/lib/agents/client'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Spinner } from '@auxx/ui/components/spinner'
import { cn } from '@auxx/ui/lib/utils'
import { Bot, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { AvatarUpload } from '../../../file-upload/ui/avatar-upload'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail } from '../../store/agent-store'
import { toSlug } from '../../utils/agent-slug'

interface AgentHeroProps {
  agent: AgentDetail
}

/**
 * Detail-view header for a completed agent. Three inline editors (name, slug,
 * description) sit alongside the avatar uploader. Setup-mode agents use a
 * different surface — this hero only renders post-`setupCompletedAt`.
 */
export function AgentHero({ agent }: AgentHeroProps) {
  const isArchived = !!agent.archivedAt
  const router = useRouter()
  const utils = api.useUtils()
  const { updateAgent } = useAgentMutations()

  const handleSlugCommit = useCallback(
    async (next: string) => {
      if (next === agent.slug) return
      const ok = await updateAgent(agent.id, { slug: next })
      if (ok) {
        router.replace(`/app/agents/${next}`)
      }
    },
    [agent.id, agent.slug, router, updateAgent]
  )

  return (
    <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
      <div className='relative shrink-0'>
        <AvatarUpload
          currentAvatarUrl={agent.avatarUrl ?? undefined}
          targetUserId={agent.userId ?? undefined}
          size='xs'
          compact
          shape='square'
          fallback={<Bot className='size-4' />}
          onUploadComplete={() => {
            utils.agent.list.invalidate()
            utils.agent.getById.invalidate({ agentId: agent.id })
          }}
        />
        <Tooltip content={isArchived ? 'Archived' : 'Active'}>
          <div
            className={cn(
              'absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
              isArchived ? 'bg-destructive' : 'bg-good-500'
            )}
          />
        </Tooltip>
      </div>
      <div className='flex flex-col align-start flex-1 min-w-0'>
        <div className='flex items-center gap-2'>
          <InlineNameField
            initialName={agent.name}
            onCommit={(next) => updateAgent(agent.id, { name: next })}
          />
        </div>
        <div className='flex items-center text-xs text-neutral-500 min-w-0 gap-1'>
          <InlineSlugField
            agentId={agent.id}
            initialSlug={agent.slug}
            onCommit={handleSlugCommit}
          />
          <span className='shrink-0'>·</span>
          <InlineDescriptionField
            initialDescription={agent.description}
            onCommit={(next) =>
              updateAgent(agent.id, { description: next.length > 0 ? next : null })
            }
          />
        </div>
      </div>
    </div>
  )
}

// ─── Inline name field ──────────────────────────────────────────────────

interface InlineNameFieldProps {
  initialName: string | null
  onCommit: (next: string) => void
}

function InlineNameField({ initialName, onCommit }: InlineNameFieldProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialName ?? '')
  const inputRef = useRef<AutosizeInputRef>(null)

  useEffect(() => {
    if (!editing) setValue(initialName ?? '')
  }, [editing, initialName])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const finish = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setEditing(false)
      setValue(initialName ?? '')
      return
    }
    if (trimmed === (initialName ?? '')) {
      setEditing(false)
      return
    }
    onCommit(trimmed)
    setEditing(false)
  }, [value, initialName, onCommit])

  const cancel = useCallback(() => {
    setValue(initialName ?? '')
    setEditing(false)
  }, [initialName])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  if (!editing) {
    return (
      <button
        type='button'
        onClick={() => setEditing(true)}
        className={cn(
          'text-lg font-medium dark:text-neutral-400 truncate text-left rounded px-1 -mx-1 hover:bg-muted/40 transition-colors',
          initialName ? 'text-neutral-900' : 'italic text-muted-foreground'
        )}>
        {initialName ?? 'Untitled agent'}
      </button>
    )
  }

  return (
    <AutosizeInput
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={handleKeyDown}
      placeholder='Untitled agent'
      minWidth={120}
      inputClassName='text-lg font-medium text-neutral-900 dark:text-neutral-400 bg-transparent outline-none rounded px-1 -mx-1 focus:bg-muted/40'
    />
  )
}

// ─── Inline slug field ──────────────────────────────────────────────────

interface InlineSlugFieldProps {
  agentId: string
  initialSlug: string
  onCommit: (next: string) => void
}

function InlineSlugField({ agentId, initialSlug, onCommit }: InlineSlugFieldProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialSlug)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<AutosizeInputRef>(null)
  const utils = api.useUtils()

  useEffect(() => {
    if (!editing) {
      setValue(initialSlug)
      setError(null)
      setAvailable(null)
      setChecking(false)
    }
  }, [editing, initialSlug])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const checkAvailability = useDebouncedCallback(async (slug: string) => {
    if (slug === initialSlug) {
      setAvailable(null)
      setChecking(false)
      return
    }
    try {
      const result = await utils.agent.checkSlug.fetch({ slug, excludeAgentId: agentId })
      setAvailable(result.available)
    } catch {
      setAvailable(false)
    } finally {
      setChecking(false)
    }
  }, 300)

  const handleChange = (raw: string) => {
    const next = toSlug(raw)
    setValue(next)
    if (next.length === 0) {
      setError(null)
      setAvailable(null)
      setChecking(false)
      return
    }
    const parsed = agentSlugSchema.safeParse(next)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid slug')
      setAvailable(null)
      setChecking(false)
      return
    }
    setError(null)
    setChecking(true)
    checkAvailability(next)
  }

  const finish = useCallback(() => {
    if (value === initialSlug) {
      setEditing(false)
      return
    }
    if (value.length === 0 || error || checking || available === false) {
      // Keep editing open so the user can fix the input.
      return
    }
    onCommit(value)
    setEditing(false)
  }, [value, initialSlug, error, checking, available, onCommit])

  const cancel = useCallback(() => {
    setValue(initialSlug)
    setError(null)
    setAvailable(null)
    setChecking(false)
    setEditing(false)
  }, [initialSlug])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  if (!editing) {
    return (
      <button
        type='button'
        onClick={() => setEditing(true)}
        className='font-mono text-xs rounded px-1 -mx-1 hover:bg-muted/40 transition-colors truncate text-left'>
        @{initialSlug}
      </button>
    )
  }

  return (
    <span className='inline-flex items-center gap-1 min-w-0'>
      <span className='font-mono text-xs text-neutral-500'>@</span>
      <AutosizeInput
        ref={inputRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={finish}
        onKeyDown={handleKeyDown}
        placeholder={initialSlug}
        minWidth={60}
        inputClassName='font-mono text-xs bg-transparent outline-none rounded px-1 -mx-1 focus:bg-muted/40'
      />
      {checking ? (
        <Spinner className='size-3' />
      ) : value.length > 0 && value !== initialSlug && !error ? (
        available === true ? (
          <Check className='size-3 text-success' />
        ) : available === false ? (
          <X className='size-3 text-destructive' />
        ) : null
      ) : null}
      {error ? <span className='text-xs text-destructive ml-1'>{error}</span> : null}
    </span>
  )
}

// ─── Inline description field ───────────────────────────────────────────

interface InlineDescriptionFieldProps {
  initialDescription: string | null
  onCommit: (next: string) => void
}

function InlineDescriptionField({ initialDescription, onCommit }: InlineDescriptionFieldProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialDescription ?? '')
  const inputRef = useRef<AutosizeInputRef>(null)

  useEffect(() => {
    if (!editing) setValue(initialDescription ?? '')
  }, [editing, initialDescription])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const finish = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed === (initialDescription ?? '')) {
      setEditing(false)
      return
    }
    onCommit(trimmed)
    setEditing(false)
  }, [value, initialDescription, onCommit])

  const cancel = useCallback(() => {
    setValue(initialDescription ?? '')
    setEditing(false)
  }, [initialDescription])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  if (!editing) {
    return (
      <button
        type='button'
        onClick={() => setEditing(true)}
        className={cn(
          'text-xs rounded px-1 -mx-1 hover:bg-muted/40 transition-colors truncate text-left min-w-0',
          initialDescription ? '' : 'italic text-muted-foreground'
        )}>
        {initialDescription ?? 'Add a description'}
      </button>
    )
  }

  return (
    <AutosizeInput
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={handleKeyDown}
      placeholder='Add a description'
      minWidth={120}
      inputClassName='text-xs bg-transparent outline-none rounded px-1 -mx-1 focus:bg-muted/40'
    />
  )
}

// apps/web/src/components/mail/email-editor/mail-slash-content.tsx
'use client'

import {
  CommandBreadcrumb,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { Editor } from '@tiptap/react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { PlaceholderSlashContent } from '~/components/editor/slash-commands/placeholder-slash-content'
import type {
  SlashCommandItem,
  SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import { type SlashContentHandle, SlashList } from '~/components/editor/slash-commands/slash-list'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { api } from '~/trpc/react'
import { AI_LANG_TYPE, AI_OPERATION, AI_TONE_TYPE, type AIOperation } from '~/types/ai-tools'
import { isBodyEmptyIgnoringChips } from '../composer-shared/content-empty'

type Range = { from: number; to: number }

/**
 * Optional AI-tools wiring for the `/` menu's "Ask AI" drill-in. When absent,
 * the "Ask AI" item simply doesn't render — keeps `MailSlashContent` usable by
 * any chip-pipeline consumer without forcing AI wiring. Email and chat pass
 * `handleAIOperation` from `useComposerAITools`. Note: `hasContent` is computed
 * inside the component (chip-aware) rather than passed in — the open `/` chip
 * would otherwise pollute a consumer-side content check (see `bodyHasContent`).
 */
export interface MailAiSlashConfig {
  /** Runs the shared AI entrypoint. Mirrors the toolbar `onOperation` contract. */
  onRunAI: (operation: AIOperation, options?: { tone?: string; language?: string }) => void
  /** Compose requires a thread to reply to. Gates the empty-body "Ask AI" item. */
  hasPreviousMessages: boolean
}

/**
 * Props for the mail composer's `/` content. Mirrors the chip-driven
 * `SlashContentProps` contract (`slash-content.tsx`): the `/` chip owns the
 * query (typed inline in the editor) and forwards keyboard via the imperative
 * handle. Mail is a `/`-only StarterKit editor — no `@` references, no block
 * schema — so this is a focused subset (no `allowedBlocks` / `onInsertReference`).
 */
export interface MailSlashContentProps {
  /** Keyboard handle — the `/` chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /** Live filter — the `/` chip's text content. */
  query: string
  /** Live editor instance — slash executors receive it via `onExecute`. */
  editor?: Editor | null
  /**
   * Run an executor with the chip's range. The executor must `deleteRange(range)`
   * inside its own chain so chip removal + the command's edit land in ONE
   * transaction (one undo step).
   */
  onExecute: (cmd: (editor: Editor, range: Range) => void) => void
  /** Update the chip's drill scope (sublabel) — also clears the chip query. */
  onScopeChange: (scope: string | null) => void
  /** Close the chip (keeps the typed text, mirroring `@`). */
  onClose: () => void
  /** Optional AI-tools wiring — when present, adds the "Ask AI" drill-in item. */
  aiSlash?: MailAiSlashConfig
  /**
   * Block commands offered at the root (Heading / lists / blockquote).
   * Defaults to {@link MAIL_BLOCK_COMMANDS}. Chat passes `[]` — it's a plain,
   * compact composer with formatting disabled, so block commands don't belong.
   */
  blockCommands?: MailBlockCommand[]
}

// --- Curated mail block commands (StarterKit executors) -------------------
// The command set is an explicit, controllable array — curate freely. These
// target the mail editor's StarterKit schema (heading / lists / blockquote),
// distinct from the block-schema `BASIC_BLOCK_COMMANDS`.

export interface MailBlockCommand extends SlashCommandItem {
  run: (editor: Editor, range: Range) => void
}

export const MAIL_BLOCK_COMMANDS: MailBlockCommand[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title', 'large'],
    iconId: 'heading-1',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'subtitle'],
    iconId: 'heading-2',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'subheading'],
    iconId: 'heading-3',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    title: 'Bullet List',
    description: 'Create a bullet list',
    keywords: ['ul', 'unordered', 'bullets', 'points'],
    iconId: 'list',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'Create a numbered list',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    iconId: 'list-ordered',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Create a quote block',
    keywords: ['quote', 'cite'],
    iconId: 'quote',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
]

// --- Tool items (drill into snippets / placeholders) ----------------------

const TOOL_COMMANDS: SlashCommandItem[] = [
  {
    id: 'snippet',
    title: 'Insert snippet',
    description: 'Search and insert reusable content',
    keywords: ['template', 'canned', 'saved', 'reusable'],
    iconId: 'folder',
    drillDown: true,
  },
  {
    id: 'placeholder',
    title: 'Insert placeholder',
    description: 'Insert a dynamic field value',
    keywords: ['variable', 'token', 'dynamic', 'merge', 'field'],
    iconId: 'braces',
    drillDown: true,
  },
]

// --- AI "Ask AI" drill items -----------------------------------------------
// AI ops don't insert at the chip range — they rewrite the whole body async.
// The leaf `onSelect` strips the chip then calls `onRunAI` (see `runAI` below).

// Icon is supplied by the section's `renderItem` (branded SparkleIcon), so no
// `iconId` here.
const AI_ROOT_COMMAND: SlashCommandItem = {
  id: 'ask-ai',
  title: 'Ask AI',
  description: 'Compose or rewrite with AI',
  keywords: ['ai', 'compose', 'rewrite', 'grammar', 'tone', 'translate', 'expand', 'shorten'],
  drillDown: true,
}

// Shown when the body is empty (compose a fresh reply).
const AI_COMPOSE_ITEMS: SlashCommandItem[] = [
  {
    id: 'ai-compose',
    title: 'Compose',
    description: 'Draft a reply from the conversation',
    keywords: ['write', 'draft', 'generate'],
    iconId: 'sparkles',
  },
]

// Shown when the body has content (transform the existing draft).
const AI_TRANSFORM_ITEMS: SlashCommandItem[] = [
  {
    id: 'ai-fix-grammar',
    title: 'Fix grammar',
    description: 'Correct spelling and grammar',
    keywords: ['spelling', 'grammar', 'proofread'],
    iconId: 'check-circle',
  },
  {
    id: 'ai-expand',
    title: 'Expand',
    description: 'Make it longer',
    keywords: ['longer', 'elaborate', 'lengthen'],
    iconId: 'arrows-up-down',
  },
  {
    id: 'ai-shorten',
    title: 'Shorten',
    description: 'Make it more concise',
    keywords: ['shorter', 'concise', 'trim'],
    iconId: 'chevrons-up-down',
  },
  {
    id: 'ai-tone',
    title: 'Tone',
    description: 'Rewrite in a different tone',
    keywords: ['voice', 'style', 'professional', 'friendly'],
    iconId: 'pen-tool',
    drillDown: true,
  },
  {
    id: 'ai-translate',
    title: 'Translate',
    description: 'Translate to another language',
    keywords: ['language', 'localize'],
    iconId: 'globe',
    drillDown: true,
  },
]

type NavItem = {
  id: string
  label: string
  type: 'snippets' | 'folder' | 'ai' | 'ai-tone' | 'ai-translate'
}

// Snippet-mode rows reuse `SlashCommandItem` plus a `kind` tag so the section's
// `onSelect` can dispatch without re-scanning data.
interface SnippetItem extends SlashCommandItem {
  kind: 'folder' | 'snippet'
  folderCount?: number
}

/**
 * The mail composer's curated, controllable `/` content, chip-driven: block
 * commands at root, with "Insert snippet" (folder drill) and "Insert
 * placeholder" (entity drill) tools. Mirrors `KBSlashContent` minus the KB
 * block schema and article-link mode.
 */
export function MailSlashContent(props: MailSlashContentProps) {
  const [mode, setMode] = useState<'default' | 'placeholder'>('default')

  const exitMode = useCallback(() => {
    setMode('default')
    props.onScopeChange(null)
  }, [props.onScopeChange])

  if (mode === 'placeholder') {
    return (
      <PlaceholderSlashContent
        ref={props.ref}
        onBack={exitMode}
        backLabel='Commands'
        onClose={props.onClose}
        onSelect={(id) => {
          props.onExecute((editor, range) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({ type: 'placeholder', attrs: { id } })
              .insertContent(' ')
              .run()
          })
        }}
      />
    )
  }

  return (
    <CommandNavigation<NavItem>>
      <MailSlashContentInner
        {...props}
        onEnterPlaceholderMode={() => {
          setMode('placeholder')
          props.onScopeChange('Placeholder')
        }}
      />
    </CommandNavigation>
  )
}

function MailSlashContentInner({
  ref,
  query,
  editor,
  onExecute,
  onScopeChange,
  onEnterPlaceholderMode,
  aiSlash,
  blockCommands = MAIL_BLOCK_COMMANDS,
}: MailSlashContentProps & { onEnterPlaceholderMode: () => void }) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<NavItem>()
  const containerRef = useRef<HTMLDivElement>(null)

  const isInSnippets = current?.type === 'snippets' || current?.type === 'folder'
  const isInAi =
    current?.type === 'ai' || current?.type === 'ai-tone' || current?.type === 'ai-translate'
  const currentFolderId = current?.type === 'folder' ? current.id : null

  const remote = useCmdkRemote(containerRef, `${stack.map((s) => s.id).join('/')}:${query}`)

  const popDrill = useCallback(() => {
    if (isAtRoot) return false
    pop()
    const parent = stack.length > 1 ? stack[stack.length - 2] : null
    onScopeChange(parent ? parent.label : null)
    return true
  }, [isAtRoot, pop, stack, onScopeChange])

  useImperativeHandle(ref, () => ({ ...remote, popLevel: popDrill }), [remote, popDrill])

  const incrementUsage = api.snippet.incrementUsage.useMutation({
    onError: (error) => console.error('Failed to update snippet usage count', error),
  })

  const { data: snippetsData, isLoading: snippetsLoading } = api.snippet.all.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 }
  )
  const allSnippets = snippetsData?.snippets ?? []

  const { data: foldersData } = api.snippet.getFolders.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  const allFolders = foldersData?.folders ?? []

  const q = query.toLowerCase()

  const currentSnippets = useMemo(
    () =>
      allSnippets.filter((s) => {
        const matchesFolder = currentFolderId ? s.folderId === currentFolderId : !s.folderId
        if (q) return matchesFolder && s.title.toLowerCase().includes(q)
        return matchesFolder
      }),
    [allSnippets, currentFolderId, q]
  )

  const currentFolders = useMemo(
    () =>
      allFolders.filter((f) => {
        const matchesParent = currentFolderId ? f.parentId === currentFolderId : !f.parentId
        if (q) return matchesParent && f.name.toLowerCase().includes(q)
        return matchesParent
      }),
    [allFolders, currentFolderId, q]
  )

  // Cross-folder snippet search when typing at root.
  const rootSnippetResults = useMemo(() => {
    if (!isAtRoot || !q) return []
    return allSnippets.filter((s) => s.title.toLowerCase().includes(q))
  }, [isAtRoot, allSnippets, q])

  const enterSnippetsDrillDown = useCallback(() => {
    push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
    onScopeChange('Snippets')
  }, [push, onScopeChange])

  const enterFolder = useCallback(
    (id: string, label: string) => {
      push({ id, label, type: 'folder' })
      onScopeChange(label)
    },
    [push, onScopeChange]
  )

  // AI ops rewrite the whole body async — they don't insert at the chip range.
  // Step 1: strip the typed "/ai…" chip (deleting the range closes the picker).
  // Step 2: run AI on the now-clean doc (the existing processing UI takes over).
  const runAI = useCallback(
    (operation: AIOperation, options?: { tone?: string; language?: string }) => {
      if (!aiSlash) return
      onExecute((editor, range) => editor.chain().focus().deleteRange(range).run())
      aiSlash.onRunAI(operation, options)
    },
    [aiSlash, onExecute]
  )

  const enterAiScope = useCallback(
    (type: 'ai' | 'ai-tone' | 'ai-translate', label: string) => {
      push({ id: type, label, type })
      onScopeChange(label)
    },
    [push, onScopeChange]
  )

  // Whether the body has real content — measured *ignoring the open `/` chip*.
  // The chip seeds a ZWSP + holds the in-progress query, both of which would
  // otherwise read as content and wrongly flip us to the transform ops on an
  // empty body. Recomputed as the query changes (the chip text mutates).
  // biome-ignore lint/correctness/useExhaustiveDependencies: query drives chip text changes
  const bodyHasContent = useMemo(() => !isBodyEmptyIgnoringChips(editor ?? null), [editor, query])

  // Empty body + no thread to reply to → the AI submenu would be empty, so hide
  // the root item entirely rather than drill into a dead list (plan §7).
  const showAskAI = !!aiSlash && (bodyHasContent || aiSlash.hasPreviousMessages)

  const insertSnippet = useCallback(
    (snippetId: string) => {
      const snippet = allSnippets.find((s) => s.id === snippetId)
      if (!snippet) return
      onExecute((editor, range) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(snippet.contentHtml || snippet.content, {
            parseOptions: { preserveWhitespace: 'full' },
          })
          .run()
      })
      incrementUsage.mutate({ id: snippet.id })
    },
    [allSnippets, onExecute, incrementUsage]
  )

  const handleSuggestionSelect = useCallback(
    (item: SlashCommandItem) => {
      if (item.id === 'ask-ai') {
        enterAiScope('ai', 'Ask AI')
        return
      }
      if (item.id === 'snippet') {
        enterSnippetsDrillDown()
        return
      }
      if (item.id === 'placeholder') {
        onEnterPlaceholderMode()
        return
      }
      const cmd = blockCommands.find((c) => c.id === item.id)
      if (cmd) onExecute(cmd.run)
    },
    [blockCommands, enterAiScope, enterSnippetsDrillDown, onEnterPlaceholderMode, onExecute]
  )

  // Dispatch for the AI ops list (root of the "Ask AI" drill).
  const handleAiOpSelect = useCallback(
    (item: SlashCommandItem) => {
      switch (item.id) {
        case 'ai-compose':
          runAI(AI_OPERATION.COMPOSE)
          break
        case 'ai-fix-grammar':
          runAI(AI_OPERATION.FIX_GRAMMAR)
          break
        case 'ai-expand':
          runAI(AI_OPERATION.EXPAND)
          break
        case 'ai-shorten':
          runAI(AI_OPERATION.SHORTEN)
          break
        case 'ai-tone':
          enterAiScope('ai-tone', 'Tone')
          break
        case 'ai-translate':
          enterAiScope('ai-translate', 'Translate')
          break
      }
    },
    [runAI, enterAiScope]
  )

  const sections: SlashCommandSection<SlashCommandItem>[] = useMemo(() => {
    if (current?.type === 'ai') {
      return [
        {
          id: 'ai-ops',
          heading: 'Ask AI',
          items: bodyHasContent ? AI_TRANSFORM_ITEMS : AI_COMPOSE_ITEMS,
          onSelect: handleAiOpSelect,
        },
      ]
    }
    if (current?.type === 'ai-tone') {
      return [
        {
          id: 'ai-tone',
          heading: 'Tone',
          items: Object.values(AI_TONE_TYPE).map((tone) => ({ id: tone, title: tone })),
          onSelect: (item) => runAI(AI_OPERATION.TONE, { tone: item.id }),
        },
      ]
    }
    if (current?.type === 'ai-translate') {
      return [
        {
          id: 'ai-translate',
          heading: 'Translate',
          items: Object.values(AI_LANG_TYPE).map((language) => ({ id: language, title: language })),
          onSelect: (item) => runAI(AI_OPERATION.TRANSLATE, { language: item.id }),
        },
      ]
    }

    if (isInSnippets) {
      const snippetItems: SnippetItem[] = [
        ...currentFolders.map<SnippetItem>((f) => ({
          id: `folder-${f.id}`,
          title: f.name,
          drillDown: true,
          kind: 'folder',
          folderCount: f._count.snippets,
        })),
        ...currentSnippets.map<SnippetItem>((s) => ({
          id: `snippet-${s.id}`,
          title: s.title,
          kind: 'snippet',
        })),
      ]
      const snippetsSection: SlashCommandSection<SnippetItem> = {
        id: 'snippets',
        heading: current?.type === 'folder' ? current.label : 'Snippets',
        items: snippetItems,
        onSelect: (item) => {
          if (item.kind === 'folder') {
            enterFolder(item.id.replace(/^folder-/, ''), item.title)
            return
          }
          insertSnippet(item.id.replace(/^snippet-/, ''))
        },
        itemValue: (item) => item.id,
        renderItem: (item) => (
          <div className='flex items-center gap-2'>
            <EntityIcon
              iconId={item.kind === 'folder' ? 'folder' : 'file-text'}
              size='xs'
              className='text-muted-foreground'
            />
            <span>{item.title}</span>
            {item.kind === 'folder' && item.folderCount !== undefined && item.folderCount > 0 && (
              <span className='text-muted-foreground text-xs'>{item.folderCount}</span>
            )}
          </div>
        ),
      }
      return [snippetsSection as unknown as SlashCommandSection<SlashCommandItem>]
    }

    const suggestionsSection: SlashCommandSection<SlashCommandItem> = {
      id: 'suggestions',
      heading: 'Suggestions',
      items: [...(showAskAI ? [AI_ROOT_COMMAND] : []), ...TOOL_COMMANDS, ...blockCommands],
      onSelect: handleSuggestionSelect,
      // "Ask AI" gets the branded gradient sparkle + purple label; all other
      // suggestion rows keep the default EntityIcon + title layout.
      renderItem: (item) =>
        item.id === 'ask-ai' ? (
          <div className='flex items-center gap-2'>
            <SparkleIcon className='shrink-0' />
            <span className='font-medium text-purple-500 dark:text-purple-400'>{item.title}</span>
          </div>
        ) : (
          <div className='flex items-center gap-2'>
            {item.iconId && (
              <EntityIcon iconId={item.iconId} size='xs' className='text-muted-foreground' />
            )}
            <span>{item.title}</span>
          </div>
        ),
    }

    const out: SlashCommandSection<SlashCommandItem>[] = [suggestionsSection]

    if (rootSnippetResults.length > 0) {
      const rootSnippetsSection: SlashCommandSection<SnippetItem> = {
        id: 'root-snippets',
        heading: 'Snippets',
        items: rootSnippetResults.map<SnippetItem>((s) => ({
          id: `snippet-${s.id}`,
          title: s.title,
          kind: 'snippet',
        })),
        onSelect: (item) => insertSnippet(item.id.replace(/^snippet-/, '')),
        itemValue: (item) => item.id,
        renderItem: (item) => (
          <div className='flex items-center gap-2'>
            <EntityIcon iconId='file-text' size='xs' className='text-muted-foreground' />
            <span>{item.title}</span>
          </div>
        ),
      }
      out.push(rootSnippetsSection as unknown as SlashCommandSection<SlashCommandItem>)
    }

    return out
  }, [
    isInSnippets,
    currentFolders,
    currentSnippets,
    current,
    handleSuggestionSelect,
    rootSnippetResults,
    enterFolder,
    insertSnippet,
    bodyHasContent,
    showAskAI,
    blockCommands,
    handleAiOpSelect,
    runAI,
  ])

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <SlashList
        query={query}
        sections={sections}
        header={<CommandBreadcrumb rootLabel='Commands' />}
        emptyMessage={
          isInSnippets ? 'No snippets found.' : isInAi ? 'No options.' : 'No results found.'
        }
        loading={snippetsLoading}
      />
    </div>
  )
}

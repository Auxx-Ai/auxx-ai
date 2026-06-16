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
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
import type {
  SlashCommandItem,
  SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import { type SlashContentHandle, SlashList } from '~/components/editor/slash-commands/slash-list'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { api } from '~/trpc/react'

type Range = { from: number; to: number }

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
}

// --- Curated mail block commands (StarterKit executors) -------------------
// The command set is an explicit, controllable array — curate freely. These
// target the mail editor's StarterKit schema (heading / lists / blockquote),
// distinct from the block-schema `BASIC_BLOCK_COMMANDS`.

interface MailBlockCommand extends SlashCommandItem {
  run: (editor: Editor, range: Range) => void
}

const MAIL_BLOCK_COMMANDS: MailBlockCommand[] = [
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

interface SnippetNavItem {
  id: string
  label: string
  type: 'snippets' | 'folder'
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
      <PlaceholderMode
        ref={props.ref}
        onBack={exitMode}
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
    <CommandNavigation<SnippetNavItem>>
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

/**
 * Placeholder mode keeps `PlaceholderPickerContent` as-is — it's an
 * input-driven picker (entity roots → field search) whose own CommandInput
 * takes real focus. The chip goes inert for the duration; Backspace-pop
 * still works if the user clicks back into the editor.
 */
function PlaceholderMode({
  ref,
  onBack,
  onClose,
  onSelect,
}: {
  ref?: React.Ref<SlashContentHandle>
  onBack: () => void
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, 'placeholder')

  useImperativeHandle(
    ref,
    () => ({
      ...remote,
      popLevel: () => {
        onBack()
        return true
      },
    }),
    [remote, onBack]
  )

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <PlaceholderPickerContent
        onBack={onBack}
        backLabel='Commands'
        onClose={onClose}
        onSelect={onSelect}
      />
    </div>
  )
}

function MailSlashContentInner({
  ref,
  query,
  onExecute,
  onScopeChange,
  onEnterPlaceholderMode,
}: MailSlashContentProps & { onEnterPlaceholderMode: () => void }) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<SnippetNavItem>()
  const containerRef = useRef<HTMLDivElement>(null)

  const isInSnippets = stack.length > 0
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
      if (item.id === 'snippet') {
        enterSnippetsDrillDown()
        return
      }
      if (item.id === 'placeholder') {
        onEnterPlaceholderMode()
        return
      }
      const cmd = MAIL_BLOCK_COMMANDS.find((c) => c.id === item.id)
      if (cmd) onExecute(cmd.run)
    },
    [enterSnippetsDrillDown, onEnterPlaceholderMode, onExecute]
  )

  const sections: SlashCommandSection<SlashCommandItem>[] = useMemo(() => {
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
      items: [...TOOL_COMMANDS, ...MAIL_BLOCK_COMMANDS],
      onSelect: handleSuggestionSelect,
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
  ])

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <SlashList
        query={query}
        sections={sections}
        header={<CommandBreadcrumb rootLabel='Commands' />}
        emptyMessage={isInSnippets ? 'No snippets found.' : 'No results found.'}
        loading={snippetsLoading}
      />
    </div>
  )
}

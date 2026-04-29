// apps/web/src/components/editor/kb-article/kb-slash-command-picker.tsx
'use client'

import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { Editor } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
import { api } from '~/trpc/react'

type Range = { from: number; to: number }

interface KBSlashCommandPickerProps {
  query: string
  onExecute: (command: (editor: Editor, range: Range) => void) => void
  onClose: () => void
}

interface BlockCommandSpec {
  blockType:
    | 'text'
    | 'heading'
    | 'bulletListItem'
    | 'numberedListItem'
    | 'todoListItem'
    | 'quote'
    | 'codeBlock'
    | 'divider'
    | 'callout'
    | 'embed'
  level?: number | null
  checked?: boolean
  calloutVariant?: 'info' | 'tip' | 'warn' | 'error' | 'success'
}

interface CommandItemDef {
  id: string
  title: string
  description: string
  keywords: string[]
  iconId: string
  drillDown?: boolean
  spec?: BlockCommandSpec
  custom?: (editor: Editor, range: Range) => void
}

const BASE_COMMANDS: CommandItemDef[] = [
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
  {
    id: 'text',
    title: 'Text',
    description: 'Plain text block',
    keywords: ['p', 'paragraph'],
    iconId: 'text',
    spec: { blockType: 'text', level: null },
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title', 'large'],
    iconId: 'heading-1',
    spec: { blockType: 'heading', level: 1 },
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'subtitle'],
    iconId: 'heading-2',
    spec: { blockType: 'heading', level: 2 },
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'subheading'],
    iconId: 'heading-3',
    spec: { blockType: 'heading', level: 3 },
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    description: 'Create a bullet list',
    keywords: ['ul', 'unordered', 'bullets', 'points'],
    iconId: 'list',
    spec: { blockType: 'bulletListItem', level: 1 },
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'Create a numbered list',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    iconId: 'list-ordered',
    spec: { blockType: 'numberedListItem', level: 1 },
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes',
    keywords: ['todo', 'task', 'check', 'checkbox'],
    iconId: 'check-square',
    spec: { blockType: 'todoListItem', checked: false },
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Capture a quote',
    keywords: ['blockquote', 'cite'],
    iconId: 'quote',
    spec: { blockType: 'quote' },
  },
  {
    id: 'code',
    title: 'Code',
    description: 'Capture a code block',
    keywords: ['codeblock', 'code'],
    iconId: 'code',
    spec: { blockType: 'codeBlock' },
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Visual separator',
    keywords: ['hr', 'horizontal', 'rule', 'line'],
    iconId: 'minus',
    custom: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .updateAttributes('block', { blockType: 'divider', level: null, checked: false })
        .splitBlock()
        .updateAttributes('block', { blockType: 'text', level: null, checked: false })
        .run()
    },
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Upload an image',
    keywords: ['photo', 'picture', 'media'],
    iconId: 'image',
    custom: (editor, range) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          if (!dataUrl) return
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .updateAttributes('block', { blockType: 'image', imageUrl: dataUrl })
            .run()
        }
        reader.readAsDataURL(file)
      }
      input.click()
    },
  },
  {
    id: 'callout-info',
    title: 'Info callout',
    description: 'Highlight a note with an info tone',
    keywords: ['callout', 'note', 'aside', 'info', 'admonition'],
    iconId: 'info',
    spec: { blockType: 'callout', calloutVariant: 'info' },
  },
  {
    id: 'callout-tip',
    title: 'Tip callout',
    description: 'Share a helpful tip',
    keywords: ['callout', 'tip', 'hint', 'lightbulb', 'idea'],
    iconId: 'lightbulb',
    spec: { blockType: 'callout', calloutVariant: 'tip' },
  },
  {
    id: 'callout-warn',
    title: 'Warning callout',
    description: 'Warn the reader about something',
    keywords: ['callout', 'warning', 'caution', 'alert'],
    iconId: 'alert-triangle',
    spec: { blockType: 'callout', calloutVariant: 'warn' },
  },
  {
    id: 'callout-error',
    title: 'Error callout',
    description: 'Flag an error or breaking note',
    keywords: ['callout', 'error', 'danger', 'stop', 'critical'],
    iconId: 'x-circle',
    spec: { blockType: 'callout', calloutVariant: 'error' },
  },
  {
    id: 'callout-success',
    title: 'Success callout',
    description: 'Confirm a successful outcome',
    keywords: ['callout', 'success', 'done', 'check', 'ok'],
    iconId: 'check-circle',
    spec: { blockType: 'callout', calloutVariant: 'success' },
  },
  {
    id: 'embed',
    title: 'Video / embed',
    description: 'Embed a YouTube, Loom, or Vimeo video',
    keywords: ['video', 'youtube', 'loom', 'vimeo', 'embed', 'iframe'],
    iconId: 'video',
    spec: { blockType: 'embed' },
  },
]

interface SlashCommandNavItem {
  id: string
  label: string
  type: 'snippets' | 'folder'
}

export function KBSlashCommandPicker(props: KBSlashCommandPickerProps) {
  const [searchQuery, setSearchQuery] = useState(props.query)
  const [mode, setMode] = useState<'default' | 'placeholder'>('default')

  if (mode === 'placeholder') {
    return (
      <div className='w-72 overflow-hidden'>
        <PlaceholderPickerContent
          onBack={() => setMode('default')}
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
      </div>
    )
  }

  return (
    <CommandNavigation<SlashCommandNavItem> onNavigationChange={() => setSearchQuery('')}>
      <KBSlashCommandPickerContent
        {...props}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onEnterPlaceholderMode={() => setMode('placeholder')}
      />
    </CommandNavigation>
  )
}

function KBSlashCommandPickerContent({
  query,
  onExecute,
  onClose,
  searchQuery,
  setSearchQuery,
  onEnterPlaceholderMode,
}: KBSlashCommandPickerProps & {
  searchQuery: string
  setSearchQuery: (q: string) => void
  onEnterPlaceholderMode: () => void
}) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<SlashCommandNavItem>()
  const inputRef = useRef<HTMLInputElement>(null)

  const isInSnippets = stack.length > 0
  const currentFolderId = current?.type === 'folder' ? current.id : null

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

  useEffect(() => {
    if (isAtRoot) setSearchQuery(query)
  }, [query, isAtRoot, setSearchQuery])

  const q = searchQuery.toLowerCase()

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

  const rootSnippetResults = useMemo(() => {
    if (!isAtRoot || !q) return []
    return allSnippets.filter((s) => s.title.toLowerCase().includes(q))
  }, [isAtRoot, allSnippets, q])

  const filteredCommands = useMemo(() => {
    if (isInSnippets) return []
    return BASE_COMMANDS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
    )
  }, [isInSnippets, q])

  const runBlockSpec = useCallback(
    (spec: BlockCommandSpec) => {
      onExecute((editor, range) => {
        const attrs: Record<string, unknown> = {
          blockType: spec.blockType,
          level: spec.level ?? null,
        }
        if (spec.blockType === 'todoListItem') attrs.checked = spec.checked ?? false
        if (spec.blockType === 'callout') attrs.calloutVariant = spec.calloutVariant ?? 'info'
        editor.chain().focus().deleteRange(range).updateAttributes('block', attrs).run()
      })
    },
    [onExecute]
  )

  const handleSelect = useCallback(
    (itemId: string) => {
      if (itemId === 'snippet') {
        push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
        setSearchQuery('')
        return
      }
      if (itemId === 'placeholder') {
        onEnterPlaceholderMode()
        return
      }

      const cmd = BASE_COMMANDS.find((c) => c.id === itemId)
      if (cmd) {
        if (cmd.custom) {
          onExecute(cmd.custom)
          return
        }
        if (cmd.spec) {
          runBlockSpec(cmd.spec)
          return
        }
      }

      const snippet = allSnippets.find((s) => s.id === itemId)
      if (snippet) {
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
      }
    },
    [
      allSnippets,
      onExecute,
      runBlockSpec,
      incrementUsage,
      push,
      setSearchQuery,
      onEnterPlaceholderMode,
    ]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !searchQuery) {
        if (!isAtRoot) {
          e.preventDefault()
          pop()
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          onClose()
          return
        }
      }
      if (e.key === 'ArrowRight') {
        const selected = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
          '[cmdk-item][data-selected="true"]'
        )
        const value = selected?.getAttribute('data-value')
        if (!value) return

        if (isAtRoot && value.toLowerCase() === 'insert snippet') {
          e.preventDefault()
          push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
          setSearchQuery('')
          return
        }
        if (isAtRoot && value.toLowerCase() === 'insert placeholder') {
          e.preventDefault()
          onEnterPlaceholderMode()
          return
        }
        if (isInSnippets) {
          const folder = currentFolders.find((f) => f.name.toLowerCase() === value.toLowerCase())
          if (folder) {
            e.preventDefault()
            push({ id: folder.id, label: folder.name, type: 'folder' })
            setSearchQuery('')
          }
        }
      }
    },
    [
      isAtRoot,
      isInSnippets,
      searchQuery,
      onClose,
      pop,
      push,
      setSearchQuery,
      currentFolders,
      onEnterPlaceholderMode,
    ]
  )

  return (
    <Command className='w-72 overflow-hidden' shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandBreadcrumb rootLabel='Commands' />
      <CommandInput
        ref={inputRef}
        placeholder={isInSnippets ? 'Search snippets...' : 'Type a command or search...'}
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        {snippetsLoading && <CommandEmpty>Loading...</CommandEmpty>}
        {!snippetsLoading &&
          !isInSnippets &&
          filteredCommands.length === 0 &&
          rootSnippetResults.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
        {!snippetsLoading &&
          isInSnippets &&
          currentFolders.length === 0 &&
          currentSnippets.length === 0 && <CommandEmpty>No snippets found.</CommandEmpty>}

        {!isInSnippets && filteredCommands.length > 0 && (
          <CommandGroup heading='Suggestions'>
            {filteredCommands.map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => handleSelect(item.id)}
                value={item.title}
                className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <EntityIcon iconId={item.iconId} size='xs' className='text-muted-foreground' />
                  <span>{item.title}</span>
                </div>
                {item.drillDown && <ChevronRight className='size-4 opacity-50' />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!isInSnippets && rootSnippetResults.length > 0 && (
          <CommandGroup heading='Snippets'>
            {rootSnippetResults.map((snippet) => (
              <CommandItem
                key={snippet.id}
                value={`snippet-${snippet.id}`}
                onSelect={() => handleSelect(snippet.id)}>
                <div className='flex items-center gap-2'>
                  <EntityIcon iconId='file-text' size='xs' className='text-muted-foreground' />
                  <span>{snippet.title}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {isInSnippets && (
          <CommandGroup heading={current?.type === 'folder' ? current.label : 'Snippets'}>
            {currentFolders.map((folder) => (
              <CommandItem
                key={folder.id}
                value={folder.name}
                onSelect={() => {
                  push({ id: folder.id, label: folder.name, type: 'folder' })
                  setSearchQuery('')
                }}
                className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <EntityIcon iconId='folder' size='xs' className='text-muted-foreground' />
                  <span>{folder.name}</span>
                  {folder._count.snippets > 0 && (
                    <span className='text-muted-foreground text-xs'>{folder._count.snippets}</span>
                  )}
                </div>
                <ChevronRight className='size-4 opacity-50' />
              </CommandItem>
            ))}

            {currentSnippets.map((snippet) => (
              <CommandItem
                key={snippet.id}
                value={`snippet-${snippet.id}`}
                onSelect={() => handleSelect(snippet.id)}>
                <div className='flex items-center gap-2'>
                  <EntityIcon iconId='file-text' size='xs' className='text-muted-foreground' />
                  <span>{snippet.title}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

// apps/web/src/components/editor/slash-command-picker.tsx

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
import { Braces, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { PlaceholderPickerContent } from './placeholders/placeholder-picker-content'

type Range = { from: number; to: number }

interface SlashCommandPickerProps {
  /** Current search query (text after `/`) */
  query: string
  /** Execute a command — callback receives editor and range to delete `/query` in a single chain */
  onExecute: (command: (editor: Editor, range: Range) => void) => void
  /** Close the picker without executing */
  onClose: () => void
}

interface CommandItemDef {
  id: string
  title: string
  description: string
  keywords: string[]
  iconId: string
  drillDown?: boolean
  command: (editor: Editor, range: Range) => void
}

interface SlashCommandNavItem {
  id: string
  label: string
  type: 'snippets' | 'folder'
}

const BASE_COMMANDS: CommandItemDef[] = [
  {
    id: 'snippet',
    title: 'Insert snippet',
    description: 'Search and insert reusable content',
    keywords: ['template', 'canned', 'saved', 'reusable'],
    iconId: 'folder',
    drillDown: true,
    command: () => {}, // Handled separately — enters snippet mode
  },
  {
    id: 'placeholder',
    title: 'Insert placeholder',
    description: 'Insert a dynamic field value',
    keywords: ['variable', 'token', 'dynamic', 'merge', 'field'],
    iconId: 'braces',
    drillDown: true,
    command: () => {}, // Handled separately — enters placeholder mode
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title', 'large'],
    iconId: 'heading-1',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'subtitle'],
    iconId: 'heading-2',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'subheading'],
    iconId: 'heading-3',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    id: 'bullet-list',
    title: 'Bullet List',
    description: 'Create a bullet list',
    keywords: ['ul', 'unordered', 'bullets', 'points'],
    iconId: 'list',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'Create a numbered list',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    iconId: 'list-ordered',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Create a quote block',
    keywords: ['quote', 'cite'],
    iconId: 'quote',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
]

export function SlashCommandPicker(props: SlashCommandPickerProps) {
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
      <SlashCommandPickerContent
        {...props}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onEnterPlaceholderMode={() => setMode('placeholder')}
      />
    </CommandNavigation>
  )
}

function SlashCommandPickerContent({
  query,
  onExecute,
  onClose,
  searchQuery,
  setSearchQuery,
  onEnterPlaceholderMode,
}: SlashCommandPickerProps & {
  searchQuery: string
  setSearchQuery: (q: string) => void
  onEnterPlaceholderMode: () => void
}) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<SlashCommandNavItem>()
  const inputRef = useRef<HTMLInputElement>(null)

  const isInSnippets = stack.length > 0
  const currentFolderId = current?.type === 'folder' ? current.id : null

  const incrementUsage = api.snippet.incrementUsage.useMutation({
    onError: (error) => {
      console.error('Failed to update snippet usage count', error)
    },
  })

  // Load all snippets and folders once upfront
  const { data: snippets, isLoading: snippetsLoading } = api.snippet.all.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 }
  )
  const allSnippets = snippets?.snippets ?? []

  const { data: foldersData } = api.snippet.getFolders.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  const allFolders = foldersData?.folders ?? []

  // Sync external query changes
  useEffect(() => {
    if (isAtRoot) {
      setSearchQuery(query)
    }
  }, [query, isAtRoot, setSearchQuery])

  const q = searchQuery.toLowerCase()

  // Snippets in current folder (null = root level)
  const currentSnippets = useMemo(() => {
    return allSnippets.filter((s) => {
      const matchesFolder = currentFolderId ? s.folderId === currentFolderId : !s.folderId
      if (q) return matchesFolder && s.title.toLowerCase().includes(q)
      return matchesFolder
    })
  }, [allSnippets, currentFolderId, q])

  // Subfolders of current folder
  const currentFolders = useMemo(() => {
    return allFolders.filter((f) => {
      const matchesParent = currentFolderId ? f.parentId === currentFolderId : !f.parentId
      if (q) return matchesParent && f.name.toLowerCase().includes(q)
      return matchesParent
    })
  }, [allFolders, currentFolderId, q])

  // When searching from root, show matching snippets alongside commands
  const rootSnippetResults = useMemo(() => {
    if (!isAtRoot || !q) return []
    return allSnippets.filter((s) => s.title.toLowerCase().includes(q))
  }, [isAtRoot, allSnippets, q])

  // Filter base commands by title, description, or hidden keywords
  const filteredCommands = useMemo(() => {
    if (isInSnippets) return []
    return BASE_COMMANDS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
    )
  }, [isInSnippets, q])

  const handleSelect = useCallback(
    (itemId: string) => {
      // Handle "insert snippet" command — enter snippet mode instead of executing
      if (itemId === 'snippet') {
        push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
        setSearchQuery('')
        return
      }

      // Handle "insert placeholder" command — enter placeholder mode
      if (itemId === 'placeholder') {
        onEnterPlaceholderMode()
        return
      }

      // Handle base command
      const cmd = BASE_COMMANDS.find((c) => c.id === itemId)
      if (cmd) {
        onExecute(cmd.command)
        return
      }

      // Handle snippet selection (from any view)
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
    [allSnippets, onExecute, incrementUsage, push, setSearchQuery, onEnterPlaceholderMode]
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
        // At root with empty search: Backspace dismisses the popover
        // (and deletes the trigger character via slashCommand.closePicker).
        // ArrowLeft is allowed to fall through — moving the caret is
        // expected behavior inside the cmdk input.
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
          push({ id: 'snippets', label: 'Snippets', type: 'snippets' } as SlashCommandNavItem)
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
            push({ id: folder.id, label: folder.name, type: 'folder' } as SlashCommandNavItem)
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

  const isLoading = snippetsLoading

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
        {isLoading && <CommandEmpty>Loading...</CommandEmpty>}
        {!isLoading &&
          !isInSnippets &&
          filteredCommands.length === 0 &&
          rootSnippetResults.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
        {!isLoading &&
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

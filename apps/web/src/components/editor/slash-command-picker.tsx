// apps/web/src/components/editor/slash-command-picker.tsx

'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import type { Editor } from '@tiptap/react'
import { File, Folder, Heading1, Heading2, Heading3, List, ListOrdered, Quote } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'

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
  icon: React.ReactNode
  command: (editor: Editor, range: Range) => void
}

const BASE_COMMANDS: CommandItemDef[] = [
  {
    id: 'snippet',
    title: 'Insert snippet',
    description: 'Search and insert reusable content',
    keywords: ['template', 'canned', 'saved', 'reusable'],
    icon: <Folder className='mr-2 h-4 w-4' />,
    command: () => {}, // Handled separately — enters snippet mode
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title', 'large'],
    icon: <Heading1 className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'subtitle'],
    icon: <Heading2 className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'subheading'],
    icon: <Heading3 className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    id: 'bullet-list',
    title: 'Bullet List',
    description: 'Create a bullet list',
    keywords: ['ul', 'unordered', 'bullets', 'points'],
    icon: <List className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'Create a numbered list',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    icon: <ListOrdered className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Create a quote block',
    keywords: ['quote', 'cite'],
    icon: <Quote className='mr-2 h-4 w-4' />,
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
]

export function SlashCommandPicker({ query, onExecute, onClose }: SlashCommandPickerProps) {
  const [snippetMode, setSnippetMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState(query)
  const inputRef = useRef<HTMLInputElement>(null)

  const incrementUsage = api.snippet.incrementUsage.useMutation({
    onError: (error) => {
      console.error('Failed to update snippet usage count', error)
    },
  })

  const { data: snippets, isLoading: snippetsLoading } = api.snippet.all.useQuery(
    { searchQuery: snippetMode ? searchQuery : undefined },
    {
      enabled: snippetMode,
      staleTime: 5 * 60 * 1000,
    }
  )
  const snippetData = snippets?.snippets ?? []

  // Sync external query changes
  useEffect(() => {
    if (!snippetMode) {
      setSearchQuery(query)
    }
  }, [query, snippetMode])

  const goBack = useCallback(() => {
    setSnippetMode(false)
    setSearchQuery('')
  }, [])

  const handleSelect = useCallback(
    (itemId: string) => {
      // Handle snippet mode selection
      if (snippetMode) {
        const snippet = snippetData.find((s) => s.id === itemId)
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
        return
      }

      // Handle "insert snippet" command — enter snippet mode instead of executing
      if (itemId === 'snippet') {
        setSnippetMode(true)
        setSearchQuery('')
        return
      }

      // Handle base command
      const item = BASE_COMMANDS.find((c) => c.id === itemId)
      if (item) {
        onExecute(item.command)
      }
    },
    [snippetMode, snippetData, onExecute, incrementUsage]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (snippetMode && e.key === 'Backspace' && !searchQuery) {
        e.preventDefault()
        goBack()
      }
    },
    [snippetMode, searchQuery, onClose, goBack]
  )

  // Filter base commands by title, description, or hidden keywords
  const filteredCommands = snippetMode
    ? []
    : BASE_COMMANDS.filter((item) => {
        const q = searchQuery.toLowerCase()
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.keywords.some((kw) => kw.includes(q))
        )
      })

  const isLoading = snippetMode && snippetsLoading

  return (
    <Command className='w-72 overflow-hidden' onKeyDown={handleKeyDown}>
      <CommandInput
        ref={inputRef}
        placeholder={snippetMode ? 'Search snippets...' : 'Type a command or search...'}
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        {isLoading && <CommandEmpty>Loading snippets...</CommandEmpty>}
        {!isLoading && !snippetMode && filteredCommands.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}
        {!isLoading && snippetMode && snippetData.length === 0 && (
          <CommandEmpty>No snippets found.</CommandEmpty>
        )}

        <CommandGroup heading={snippetMode ? 'Snippets' : 'Suggestions'}>
          {snippetMode && (
            <CommandItem key='back' onSelect={goBack} value='--back--'>
              <span className='text-muted-foreground text-sm'>← Back to commands</span>
            </CommandItem>
          )}

          {!snippetMode &&
            filteredCommands.map((item) => (
              <CommandItem key={item.id} onSelect={() => handleSelect(item.id)} value={item.title}>
                <div className='flex w-full items-center'>
                  {item.icon}
                  <div className='ml-2'>
                    <p className='text-sm font-medium'>{item.title}</p>
                    <p className='text-xs text-muted-foreground'>{item.description}</p>
                  </div>
                </div>
              </CommandItem>
            ))}

          {snippetMode &&
            snippetData.map((snippet) => (
              <CommandItem
                key={snippet.id}
                onSelect={() => handleSelect(snippet.id)}
                value={snippet.title}>
                <div className='flex w-full items-center'>
                  <File className='mr-2 h-4 w-4' />
                  <div className='ml-2'>
                    <p className='text-sm font-medium'>{snippet.title}</p>
                    <p className='text-xs text-muted-foreground'>
                      {snippet.description || 'Insert snippet content'}
                    </p>
                  </div>
                </div>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

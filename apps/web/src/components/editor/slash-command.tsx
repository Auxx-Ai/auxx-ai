// components/editor/SlashCommand.tsx

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react' // Import Editor type
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
// Use appropriate icons
import {
  File,
  Folder,
  // SmilePlus,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react'
import type React from 'react'
import {
  useCallback, // Import useCallback
  useEffect,
  useImperativeHandle,
  useState,
  // useLayoutEffect, // Import useLayoutEffect for positioning
} from 'react'
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js' // Import types
import { api } from '~/trpc/react'

// Define the command items structure more robustly
interface CommandItemBase {
  title: string
  description: string
  icon: React.ReactNode
}

interface ActionCommandItem extends CommandItemBase {
  type: 'action'
  command: (props: { editor: Editor; range: Range }) => void | boolean // Return void or boolean if handled
}

interface SnippetCommandItem extends CommandItemBase {
  type: 'snippet'
  id: string
  content: string
  command: (props: { editor: Editor; range: Range }) => void
}

type CombinedCommandItem = ActionCommandItem | SnippetCommandItem

// Define the snippet type matching our schema (assuming it's correct)
type SnippetType = {
  id: string
  title: string
  content: string
  contentHtml: string | null
  description: string | null
}

// --- SlashCommandList Component ---
type SlashListRef = { onKeyDown: (props: { event: KeyboardEvent }) => boolean }
type SlashCommandListProps = SuggestionProps<CombinedCommandItem> &
  React.RefAttributes<SlashListRef>

function SlashCommandList(props: SlashCommandListProps) {
  const { ref, ...rest } = props
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState(rest.query) // Initialize with query from suggestion
  const [snippetMode, setSnippetMode] = useState(false)

  // Hook for snippet increment mutation
  const incrementMutation = api.snippet.incrementUsage.useMutation({
    onError: (error) => {
      console.error('Failed to update snippet usage count', error)
      // Handle error appropriately, maybe show a toast notification
    },
  })

  // Fetch snippets only when in snippet mode
  const { data: snippets, isLoading: snippetsLoading } = api.snippet.all.useQuery(
    { searchQuery: snippetMode ? searchQuery : undefined },
    {
      enabled: snippetMode,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  )
  const snippetData = snippets?.snippets || []
  console.log(snippetData)

  // Define available commands (Add more as needed)
  const baseCommands: ActionCommandItem[] = [
    {
      type: 'action',
      title: 'Insert snippet',
      description: 'Search and insert reusable content',
      icon: <Folder className='mr-2 h-4 w-4' />,
      command: () => {
        setSnippetMode(true)
        setSearchQuery('') // Clear search when entering snippet mode
        setSelectedIndex(0)
        // Return void/nothing; don't close popup
      },
    },
    {
      type: 'action',
      title: 'Heading 1',
      description: 'Big section heading',
      icon: <Heading1 className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
      },
    },
    {
      type: 'action',
      title: 'Heading 2',
      description: 'Medium section heading',
      icon: <Heading2 className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
      },
    },
    {
      type: 'action',
      title: 'Heading 3',
      description: 'Small section heading',
      icon: <Heading3 className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
      },
    },
    {
      type: 'action',
      title: 'Bullet List',
      description: 'Create a bullet list',
      icon: <List className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      type: 'action',
      title: 'Numbered List',
      description: 'Create a numbered list',
      icon: <ListOrdered className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      type: 'action',
      title: 'Blockquote',
      description: 'Create a quote block',
      icon: <Quote className='mr-2 h-4 w-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    // {
    //     type: 'action',
    //     title: 'Insert emoji',
    //     description: 'Add an emoji to your content',
    //     icon: <SmilePlus className='mr-2 h-4 w-4' />,
    //     command: ({ editor, range }) => {
    //         // Ideally, open an emoji picker here
    //         editor.chain().focus().deleteRange(range).insertContent('😀').run();
    //     },
    // },
  ]

  // Filter base commands based on search query if not in snippet mode
  const filteredBaseCommands = snippetMode
    ? []
    : baseCommands.filter(
        (item) =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase())
      )

  // Convert snippets to command items when in snippet mode
  const snippetItems: SnippetCommandItem[] =
    snippetMode && snippetData.length > 0
      ? snippetData.map((snippet) => ({
          type: 'snippet',
          id: snippet.id,
          title: snippet.title,
          description: snippet.description || 'Insert snippet content',
          icon: <File className='mr-2 h-4 w-4' />, // Use File icon for snippet items
          content: snippet.contentHtml || snippet.content,
          command: ({ editor, range }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(snippet.contentHtml || snippet.content, {
                parseOptions: { preserveWhitespace: 'full' },
              })
              .run()
            // Update usage count
            incrementMutation.mutate({ id: snippet.id })
          },
        }))
      : []

  const currentItems: CombinedCommandItem[] = snippetMode ? snippetItems : filteredBaseCommands
  const isLoading = snippetMode && snippetsLoading

  // Update search query based on props change (needed if user continues typing after mount)
  useEffect(() => {
    setSearchQuery(rest.query)
  }, [rest.query])

  const selectItem = useCallback(
    (index: number) => {
      const item = currentItems[index]
      if (item) {
        // `props.command` is the function passed by the Suggestion plugin's config
        // It expects the selected item as an argument
        rest.command(item)
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: rest contains command callback from Suggestion plugin
    [currentItems, rest]
  )

  // Reset index when items change
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentItems.length and snippetMode intentionally trigger index reset
  useEffect(() => {
    setSelectedIndex(0)
  }, [currentItems.length, snippetMode])

  // Function to go back from snippet mode
  const goBack = useCallback(() => {
    setSnippetMode(false)
    setSearchQuery('')
    setSelectedIndex(0)
    // Maybe focus the input again? Depends on desired UX
  }, [])

  // Expose onKeyDown to the Suggestion renderer
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }): boolean => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prevIndex) => (prevIndex + currentItems.length - 1) % currentItems.length)
        return true // Handled
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prevIndex) => (prevIndex + 1) % currentItems.length)
        return true // Handled
      }
      if (event.key === 'Enter') {
        // Prevent default browser behavior for Enter if items exist
        if (currentItems.length > 0) {
          event.preventDefault()
          selectItem(selectedIndex)
          return true // Handled
        }
        return false // Not handled if no items
      }
      // Handle backspace in snippet mode to go back
      if (snippetMode && event.key === 'Backspace' && searchQuery === '') {
        event.preventDefault() // Prevent deleting the trigger char
        goBack()
        return true // Handled
      }
      return false // Not handled by this component
    },
  }))

  // --- Render Logic ---
  return (
    <Command className='w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md'>
      <CommandInput
        // autoFocus // Consider autoFocusing for better UX
        placeholder={snippetMode ? 'Search snippets...' : 'Type a command or search...'}
        value={searchQuery}
        onValueChange={(value) => setSearchQuery(value)}
        // Handle backspace directly in input for the "go back" case
        onKeyDown={(e) => {
          if (snippetMode && e.key === 'Backspace' && !searchQuery) {
            e.preventDefault()
            goBack()
          }
        }}
      />
      <CommandList>
        {isLoading && <CommandEmpty>Loading snippets...</CommandEmpty>}
        {!isLoading && currentItems.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}

        <CommandGroup heading={snippetMode ? 'Snippets' : 'Suggestions'}>
          {/* Add dedicated "Back" item for mouse users */}
          {snippetMode && (
            <CommandItem
              key='back'
              onSelect={goBack} // Use onSelect for clicks
              className='cursor-pointer text-sm text-muted-foreground'
              value='--back--' // Add a value to prevent potential key conflicts
            >
              ← Back to commands
            </CommandItem>
          )}

          {currentItems.map((item, index) => (
            <CommandItem
              key={item.type === 'snippet' ? item.id : item.title} // Unique key
              onSelect={() => selectItem(index)} // Use onSelect for mouse clicks
              className={`cursor-pointer ${selectedIndex === index ? 'bg-accent text-accent-foreground' : ''}`}
              value={item.title} // Set value for Command Primitive interaction
            >
              <div className='flex w-full items-center justify-between'>
                <div className='flex items-center'>
                  {item.icon}
                  <div className='ml-2'>
                    <p className='text-sm font-medium'>{item.title}</p>
                    {item.description && (
                      <p className='text-xs text-muted-foreground'>{item.description}</p>
                    )}
                  </div>
                </div>
                {/* Optional: Add keyboard shortcut hints */}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
// Keep displayName for devtools clarity
;(SlashCommandList as any).displayName = 'SlashCommandList'

/**
 * Renders the suggestion popup for slash commands.
 *
 * @returns
 */
const renderSuggestionPopup = () => {
  let component: ReactRenderer | null = null
  let popup: Instance<TippyProps>[] | null = null // Tippy instance array

  const destroyPopup = () => {
    if (popup) {
      popup[0]?.destroy()
      popup = null
    }
    if (component) {
      component.destroy()
      component = null
    }
  }

  return {
    onStart: (props: SuggestionProps<CombinedCommandItem>) => {
      component = new ReactRenderer(SlashCommandList, { props, editor: props.editor })

      if (!props.clientRect) {
        return
      }

      popup = tippy('body', {
        getReferenceClientRect: props.clientRect as () => DOMRect, // Type assertion
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        // Tippy options for better behavior
        arrow: false,
        // hideOnClick: true, // Hide when clicking inside/outside (default usually true)
        // inertia: true, // Smooth transition
        // duration: [100, 100],
        theme: 'light-border', // Or use a custom theme matching shadcn
        // Add a popper offset if needed
        popperOptions: {
          modifiers: [{ name: 'offset', options: { offset: [0, 8] } }], // [skidding, distance]
        },
        onHidden() {
          // Clean up when tippy hides itself (e.g., click outside)
          // Important: Check if component exists before destroying
          // because onExit might be called separately by Tiptap
          if (component && popup) {
            // console.log("Tippy hidden, destroying...");
            destroyPopup()
          }
        },
      })
    },

    onUpdate(props: SuggestionProps<CombinedCommandItem>) {
      component?.updateProps(props)

      if (!props.clientRect || !popup) {
        return
      }

      popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
    },

    onKeyDown(props: SuggestionProps<CombinedCommandItem> & { event: KeyboardEvent }): boolean {
      if (props.event.key === 'Escape') {
        popup?.[0]?.hide()
        // destroyPopup(); // Tippy's onHidden should handle cleanup
        return true // Handled
      }

      // Forward keydown to the SlashCommandList component instance
      if (component?.ref?.onKeyDown) {
        return component.ref.onKeyDown(props)
      }

      return false // Not handled
    },

    onExit() {
      // console.log("Tiptap onExit called, destroying...");
      // Use timeout to prevent race condition with tippy's hide/destroy
      // setTimeout(destroyPopup, 10);
      destroyPopup() // Try direct cleanup first
    },
  }
}

// --- Slash Command Extension Definition ---
export const SlashCommand = Extension.create<SuggestionOptions<CombinedCommandItem>>({
  // Pass item type to options
  name: 'slash-command',

  addOptions() {
    return {
      // Inherit default options and override specific ones
      ...this.parent?.(), // Inherit default suggestion options if available
      suggestion: {
        char: '/',
        startOfLine: false, // Allow command anywhere

        // This function is called by Tiptap before rendering.
        // We only need it to return *something* non-empty to trigger the render.
        // The actual items are managed within SlashCommandList.
        items: ({ query }: { query: string }): CombinedCommandItem[] => {
          // Return a dummy array (or potentially pre-filter base commands if desired)
          // We MUST return an array, even if empty, for suggestion to work.
          // Returning [{}] signals that the render function should be called.
          return [{} as ActionCommandItem] // Cast necessary if empty doesn't work
        },

        // This function is called when an item is selected (Enter/Click)
        // It receives the selected item object from the renderer component
        command: ({ editor, range, props: item }) => {
          // `item` is the selected CommandItemType object (Action or Snippet)
          // Execute the command associated with the selected item
          // console.log("Executing command for:", item.title);
          item.command({ editor, range })
        },

        // Control when the suggestion popup should be allowed to appear
        allow: ({ editor, range, state }) => {
          // Don't trigger if inside code blocks or links etc.
          const isCode = editor.isActive('codeBlock') || editor.isActive('code')
          const isLink = editor.isActive('link')

          // For Debugging: Uncomment to see why it might not trigger
          const $position = state.doc.resolve(range.from)
          const previousChar = state.doc.textBetween(range.from - 1, range.from, '\n', ' ')

          // Allow triggering anywhere except inside code or links
          return !isCode && !isLink
        },

        allow: ({ editor, range, state }) => {
          // Example: Allow only at start of a new node or after a space
          const $position = state.doc.resolve(range.from)
          const isAtStart = $position.parentOffset === 0
          const previousChar = state.doc.textBetween(range.from - 1, range.from, '\n', ' ')
          const isAfterSpace = /\s/.test(previousChar)

          // Don't trigger if inside code blocks or links etc.
          const isCode = editor.isActive('codeBlock') || editor.isActive('code')
          const isLink = editor.isActive('link')

          return !isCode && !isLink && (isAtStart || isAfterSpace)
        },

        // Use the custom renderer with Tippy.js
        render: renderSuggestionPopup,
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion, // Pass all suggestion options
      }),
    ]
  },
})

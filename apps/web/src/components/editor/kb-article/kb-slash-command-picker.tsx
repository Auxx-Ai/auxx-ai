// apps/web/src/components/editor/kb-article/kb-slash-command-picker.tsx
'use client'

import {
  CommandBreadcrumb,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { generateId } from '@auxx/utils'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
import {
  BASIC_BLOCK_COMMANDS,
  type BlockCommandDef,
  runBlockCommand,
} from '~/components/editor/slash-commands/block-commands'
import {
  type SlashCommandItem,
  SlashCommandPicker,
  type SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import { api } from '~/trpc/react'

type Range = { from: number; to: number }

interface KBSlashCommandPickerProps {
  query: string
  onExecute: (command: (editor: Editor, range: Range) => void) => void
  onClose: () => void
  /** Open the article-link dialog. The picker deletes the slash range first
   * and passes the resulting cursor position to the host. */
  onLinkArticle?: (editor: Editor, insertPos: number) => void
  /** Live editor instance — used to filter container blocks (`tabs`,
   * `accordion`) out of the menu when the cursor is inside a panel. */
  editor?: Editor | null
}

// --- KB-only block commands -----------------------------------------------

const KB_BLOCK_COMMANDS: BlockCommandDef[] = [
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
  {
    id: 'cards',
    title: 'Card grid',
    description: 'Linked navigation cards',
    keywords: ['cards', 'card', 'grid', 'links', 'nav'],
    iconId: 'grid',
    custom: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .updateAttributes('block', {
          blockType: 'cards',
          level: null,
          checked: false,
          cards: [
            { id: generateId(), title: 'Card 1' },
            { id: generateId(), title: 'Card 2' },
          ],
        })
        .splitBlock()
        .updateAttributes('block', { blockType: 'text', level: null, checked: false })
        .run()
    },
  },
  {
    id: 'tabs',
    title: 'Tabs',
    description: 'Tabbed content with multiple panels',
    keywords: ['tabs', 'tab', 'switcher', 'panels'],
    iconId: 'columns',
    custom: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'tabs',
          attrs: { activeTab: null },
          content: [makeEmptyPanelJSON('Tab 1'), makeEmptyPanelJSON('Tab 2')],
        })
        .run()
    },
  },
  {
    id: 'accordion',
    title: 'Accordion',
    description: 'Collapsible Q&A or FAQ items',
    keywords: ['accordion', 'faq', 'collapse', 'toggle', 'questions'],
    iconId: 'chevrons-up-down',
    custom: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'accordion',
          attrs: { allowMultiple: true },
          content: [makeEmptyPanelJSON('Question 1'), makeEmptyPanelJSON('Question 2')],
        })
        .run()
    },
  },
  {
    id: 'table',
    title: 'Table',
    description: 'Grid of cells with optional header row',
    keywords: ['table', 'grid', 'spreadsheet', 'rows', 'columns'],
    iconId: 'table',
    custom: (editor, range) => {
      // Use `insertContent` (not `insertTable`) so PM can REPLACE the
      // wrapping `block` with the table — same path as tabs/accordion.
      // `Block.defining: true` means `replaceSelectionWith` (used by the
      // built-in `insertTable` command) tries to fit the table INSIDE the
      // block, fails, and substitutes a default block. `insertContent`
      // takes a different path that lifts out of the wrapping block.
      // After insertion PM leaves the cursor at the end of the inserted
      // content (last cell). Walk the doc forward from `range.from` to
      // find the first cell and place the cursor inside its empty block.
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(makeEmptyTableJSON(3, 3, true))
        .command(({ tr, dispatch }) => {
          let target: number | null = null
          tr.doc.nodesBetween(range.from, tr.doc.content.size, (node, pos) => {
            if (target !== null) return false
            if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
              // pos = before the cell's open token; +2 lands inside the
              // empty block that lives inside the cell.
              target = pos + 2
              return false
            }
            return true
          })
          if (target !== null && dispatch) {
            dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(target))))
          }
          return true
        })
        .run()
    },
  },
]

// --- KB-only tool items ---------------------------------------------------

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
  {
    id: 'article-link',
    title: 'Link to article',
    description: 'Insert a link to another KB article',
    keywords: ['link', 'article', 'reference', 'href', 'url'],
    iconId: 'link',
  },
]

const TOOL_IDS = new Set(TOOL_COMMANDS.map((t) => t.id))

function makeEmptyPanelJSON(label: string) {
  // No explicit id — the `blockIdPlugin` stamps a sequential `b<n>` id on the
  // panel (and its child block) once the container is inserted.
  return {
    type: 'panel' as const,
    attrs: { label },
    content: [{ type: 'block' as const, attrs: { blockType: 'text' as const }, content: [] }],
  }
}

function makeEmptyTableJSON(rows: number, cols: number, withHeaderRow: boolean) {
  const emptyBlock = { type: 'block' as const, attrs: { blockType: 'text' as const }, content: [] }
  const makeCell = (header: boolean) => ({
    type: header ? ('tableHeader' as const) : ('tableCell' as const),
    content: [emptyBlock],
  })
  const makeRow = (header: boolean) => ({
    type: 'tableRow' as const,
    content: Array.from({ length: cols }, () => makeCell(header)),
  })
  const allRows = []
  for (let r = 0; r < rows; r++) {
    allRows.push(makeRow(withHeaderRow && r === 0))
  }
  return { type: 'table' as const, content: allRows }
}

const PANEL_RESTRICTED_COMMAND_IDS = new Set(['tabs', 'accordion', 'table'])
const CELL_RESTRICTED_COMMAND_IDS = new Set(['tabs', 'accordion', 'table', 'cards'])

function selectionIsInsidePanel(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'panel') return true
  }
  return false
}

function selectionIsInsideTableCell(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
  }
  return false
}

interface SlashCommandNavItem {
  id: string
  label: string
  type: 'snippets' | 'folder'
}

// Snippet-mode items reuse `SlashCommandItem` plus a `kind` tag so the
// section's `onSelect` / `onArrowRight` can dispatch without scanning data.
interface SnippetItem extends SlashCommandItem {
  kind: 'folder' | 'snippet'
  folderCount?: number
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
  onLinkArticle,
  editor,
  searchQuery,
  setSearchQuery,
  onEnterPlaceholderMode,
}: KBSlashCommandPickerProps & {
  searchQuery: string
  setSearchQuery: (q: string) => void
  onEnterPlaceholderMode: () => void
}) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<SlashCommandNavItem>()

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

  // Mirror the external query into the local controlled input *only at root*.
  // While drilled into a snippets folder the input doubles as a folder
  // search field and we don't want the picker plugin (which still receives
  // typed characters from outside the input) to clobber it.
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

  // Root-level snippet *search* (cross-folder hits when typing at root) —
  // rendered as its own section below the suggestions group.
  const rootSnippetResults = useMemo(() => {
    if (!isAtRoot || !q) return []
    return allSnippets.filter((s) => s.title.toLowerCase().includes(q))
  }, [isAtRoot, allSnippets, q])

  // Build the merged default-mode "Suggestions" list — tools first, then
  // basic blocks, then KB-only blocks. Preserves the pre-refactor ordering
  // and rendering as a single CommandGroup.
  const suggestionItems: SlashCommandItem[] = useMemo(() => {
    if (isInSnippets) return []
    const tools = onLinkArticle
      ? TOOL_COMMANDS
      : TOOL_COMMANDS.filter((c) => c.id !== 'article-link')
    let blocks: BlockCommandDef[] = [...BASIC_BLOCK_COMMANDS, ...KB_BLOCK_COMMANDS]
    // Containers can't nest inside a panel — ProseMirror's schema would
    // reject the insert, but hiding from the menu keeps it tidy.
    if (editor && selectionIsInsidePanel(editor)) {
      blocks = blocks.filter((c) => !PANEL_RESTRICTED_COMMAND_IDS.has(c.id))
    }
    // Cells reject containers structurally and visually push cards around;
    // hide both inside cells.
    if (editor && selectionIsInsideTableCell(editor)) {
      blocks = blocks.filter((c) => !CELL_RESTRICTED_COMMAND_IDS.has(c.id))
    }
    return [...tools, ...blocks]
  }, [isInSnippets, onLinkArticle, editor])

  const enterSnippetsDrillDown = useCallback(() => {
    push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
    setSearchQuery('')
  }, [push, setSearchQuery])

  const enterFolder = useCallback(
    (id: string, label: string) => {
      push({ id, label, type: 'folder' })
      setSearchQuery('')
    },
    [push, setSearchQuery]
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
      if (item.id === 'article-link' && onLinkArticle) {
        onExecute((editor, range) => {
          editor.chain().focus().deleteRange(range).run()
          onLinkArticle(editor, range.from)
        })
        return
      }
      // Anything left is a block command.
      if (TOOL_IDS.has(item.id)) return
      onExecute(runBlockCommand(item as BlockCommandDef))
    },
    [enterSnippetsDrillDown, onEnterPlaceholderMode, onLinkArticle, onExecute]
  )

  const handleSuggestionArrowRight = useCallback(
    (item: SlashCommandItem) => {
      if (item.id === 'snippet') {
        enterSnippetsDrillDown()
        return true
      }
      if (item.id === 'placeholder') {
        onEnterPlaceholderMode()
        return true
      }
      return false
    },
    [enterSnippetsDrillDown, onEnterPlaceholderMode]
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
            const folderId = item.id.replace(/^folder-/, '')
            enterFolder(folderId, item.title)
            return
          }
          insertSnippet(item.id.replace(/^snippet-/, ''))
        },
        onArrowRight: (item) => {
          if (item.kind === 'folder') {
            const folderId = item.id.replace(/^folder-/, '')
            enterFolder(folderId, item.title)
            return true
          }
          return false
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
      items: suggestionItems,
      onSelect: handleSuggestionSelect,
      onArrowRight: handleSuggestionArrowRight,
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
    suggestionItems,
    handleSuggestionSelect,
    handleSuggestionArrowRight,
    rootSnippetResults,
    enterFolder,
    insertSnippet,
  ])

  const onBackspaceEmpty = useCallback(() => {
    if (isAtRoot) return false
    pop()
    return true
  }, [isAtRoot, pop])

  const onArrowLeftEmpty = useCallback(() => {
    if (isAtRoot) return false
    pop()
    return true
  }, [isAtRoot, pop])

  return (
    <SlashCommandPicker
      query={query}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      onClose={onClose}
      sections={sections}
      header={<CommandBreadcrumb rootLabel='Commands' />}
      placeholder={isInSnippets ? 'Search snippets...' : 'Type a command or search...'}
      emptyMessage={isInSnippets ? 'No snippets found.' : 'No results found.'}
      onBackspaceEmpty={onBackspaceEmpty}
      onArrowLeftEmpty={onArrowLeftEmpty}
      loading={snippetsLoading}
    />
  )
}

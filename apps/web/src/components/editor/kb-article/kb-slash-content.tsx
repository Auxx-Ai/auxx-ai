// apps/web/src/components/editor/kb-article/kb-slash-content.tsx
'use client'

import {
  CommandBreadcrumb,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { buildAuxxArticleUrl, generateId } from '@auxx/utils'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
import {
  BASIC_BLOCK_COMMANDS,
  type BlockCommandDef,
  runBlockCommand,
} from '~/components/editor/slash-commands/block-commands'
import type {
  SlashCommandItem,
  SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import { type SlashContentHandle, SlashList } from '~/components/editor/slash-commands/slash-list'
import { useArticleList } from '~/components/kb/hooks/use-article-list'
import { ArticlePicker } from '~/components/kb/ui/articles/article-picker'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { api } from '~/trpc/react'
import { useKBEditorContext } from './editor-context'

type Range = { from: number; to: number }

interface KBSlashContentProps {
  /** Keyboard handle — the `/` chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /** Live filter — the `/` chip's text content. */
  query: string
  onExecute: (command: (editor: Editor, range: Range) => void) => void
  onClose: () => void
  /**
   * Update the chip's drill scope (sublabel) — also clears the chip query.
   * Called on every drill push/pop so the pill reads `/ SNIPPETS …`.
   */
  onScopeChange: (scope: string | null) => void
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
    drillDown: true,
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

// A type alias, not an interface: `NavigationItem`'s `[key: string]: unknown`
// constraint is only satisfied by types with an implicit index signature, which
// interfaces don't get.
type SlashCommandNavItem = {
  id: string
  label: string
  type: 'snippets' | 'folder'
}

// Snippet-mode items reuse `SlashCommandItem` plus a `kind` tag so the
// section's `onSelect` can dispatch without scanning data.
interface SnippetItem extends SlashCommandItem {
  kind: 'folder' | 'snippet'
  folderCount?: number
}

/**
 * KB slash content, chip-driven: the `/` chip owns the query (typed inline
 * in the editor) and forwards keyboard via the imperative handle. Drill
 * scope (snippets / folders / placeholder mode) is mirrored onto the chip's
 * sublabel via `onScopeChange`, which also clears the chip query so each
 * level starts with a fresh filter.
 */
export function KBSlashContent(props: KBSlashContentProps) {
  const [mode, setMode] = useState<'default' | 'placeholder' | 'articleLink'>('default')

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

  if (mode === 'articleLink') {
    return (
      <ArticleLinkMode
        ref={props.ref}
        onBack={exitMode}
        onClose={props.onClose}
        onExecute={props.onExecute}
      />
    )
  }

  return (
    <CommandNavigation<SlashCommandNavItem>>
      <KBSlashContentInner
        {...props}
        onEnterPlaceholderMode={() => {
          setMode('placeholder')
          props.onScopeChange('Placeholder')
        }}
        onEnterArticleLinkMode={() => {
          setMode('articleLink')
          props.onScopeChange('Link article')
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

/**
 * Article-link mode embeds `ArticlePicker` (the same form the bubble-menu
 * link flow uses) as a drilled level — no separate popover. Like placeholder
 * mode it's an input-driven picker whose own search takes real focus; the
 * chip goes inert for the duration. Picking deletes the chip and inserts the
 * linked title in one transaction.
 */
function ArticleLinkMode({
  ref,
  onBack,
  onClose,
  onExecute,
}: {
  ref?: React.Ref<SlashContentHandle>
  onBack: () => void
  onClose: () => void
  onExecute: KBSlashContentProps['onExecute']
}) {
  const { knowledgeBaseId } = useKBEditorContext()
  const articles = useArticleList(knowledgeBaseId)
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, 'article-link')

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
      <ArticlePicker
        knowledgeBaseId={knowledgeBaseId}
        allowedKinds={['page', 'link']}
        drillableKinds={['tab', 'category', 'header']}
        rootLabel='Link to article'
        searchPlaceholder='Search articles…'
        flattenSearch
        autoFocusSearch
        onBack={onBack}
        backLabel='Commands'
        onPick={(articleId) => {
          const found = articles.find((a) => a.id === articleId)
          const href = buildAuxxArticleUrl(articleId)
          const text = found?.title || 'article'
          onExecute((editor, range) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href, target: null } }],
              })
              // Strip the stored link mark so the next typed character isn't linked.
              .command(({ tr }) => {
                const linkMark = editor.schema.marks.link
                if (linkMark) tr.removeStoredMark(linkMark)
                return true
              })
              .run()
          })
        }}
        onClose={onClose}
      />
    </div>
  )
}

function KBSlashContentInner({
  ref,
  query,
  onExecute,
  onScopeChange,
  editor,
  onEnterPlaceholderMode,
  onEnterArticleLinkMode,
}: KBSlashContentProps & {
  onEnterPlaceholderMode: () => void
  onEnterArticleLinkMode: () => void
}) {
  const { push, pop, isAtRoot, current, stack } = useCommandNavigation<SlashCommandNavItem>()
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
    return [...TOOL_COMMANDS, ...blocks]
  }, [isInSnippets, editor])

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
      if (item.id === 'article-link') {
        onEnterArticleLinkMode()
        return
      }
      // Anything left is a block command.
      if (TOOL_IDS.has(item.id)) return
      onExecute(runBlockCommand(item as BlockCommandDef))
    },
    [enterSnippetsDrillDown, onEnterPlaceholderMode, onEnterArticleLinkMode, onExecute]
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

// apps/web/src/components/mail/email-editor/mail-slash-content.tsx
'use client'

import type { DraftActionPayload } from '@auxx/lib/quick-actions/client'
import {
  CommandBreadcrumb,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { Editor } from '@tiptap/react'
import { Check } from 'lucide-react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useActionCatalog } from '~/components/apps/hooks/use-action-catalog'
import { AppIcon } from '~/components/apps/ui/app-icon'
import type { PickerTrigger } from '~/components/editor/inline-picker'
import { PlaceholderSlashContent } from '~/components/editor/slash-commands/placeholder-slash-content'
import type {
  SlashCommandItem,
  SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import { type SlashContentHandle, SlashList } from '~/components/editor/slash-commands/slash-list'
import type { FileItem } from '~/components/files/files-store'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { useSignatures } from '~/components/signatures/hooks'
import type { SerializedQuickAction } from '~/components/workflow/apps/workflow-block-loader'
import { api } from '~/trpc/react'
import type { AIOperation, AIToneType } from '~/types/ai-tools'
import { AiSlashContent } from './ai-slash-content'
import { FileSlashContent } from './file-slash-content'
import { useSnippetSearch } from './hooks'
import { toDraftActionPayload } from './quick-action-panel'

type Range = { from: number; to: number }

/**
 * Optional AI-tools wiring for the `/` menu's "Ask AI" item. When absent, the
 * "Ask AI" item simply doesn't render — keeps `MailSlashContent` usable by any
 * chip-pipeline consumer without forcing AI wiring. Email and chat pass
 * `handleAIOperation` from `useComposerAITools`. Selecting "Ask AI" opens the
 * focus-owning {@link AiSlashContent} panel (its own instruction input).
 */
export interface MailAiSlashConfig {
  /** Runs the shared AI entrypoint. Mirrors the toolbar `onOperation` contract. */
  onRunAI: (
    operation: AIOperation,
    options?: { tone?: AIToneType; language?: string; instruction?: string }
  ) => void
}

/**
 * Draft-level wiring for the `@` menu. When absent, the `@` root renders no
 * signature/action items (and the trigger isn't registered — see tiptap-editor).
 * Data (signatures, available actions) is fetched inside the component; only the
 * current selection + mutators are passed, since they own the draft state.
 */
export interface MailReferenceConfig {
  /** Currently-selected signature id (instance id), or null when none. */
  signatureId: string | null
  /** Set / clear the draft signature. Same setter as the belowEditor editor. */
  onSignatureChange: (id: string | null) => void
  /** Currently-selected quick-action ids — drives the checked state. */
  actionIds: string[]
  /** Push a quick action onto the draft. */
  onAddAction: (payload: DraftActionPayload) => void
  /** Remove a quick action from the draft by action id. */
  onRemoveAction: (actionId: string) => void
  /** Scopes `useQuickActions` to the active thread. */
  threadId?: string
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
   * Optional attachment wiring — when present, adds the "Attach file" drill-in
   * item. Receives the chosen library file; the composer routes it into its own
   * attachment tray (`useFileSelect.addExistingFiles`). Absent → no file item.
   */
  onAttachFile?: (file: FileItem) => void
  /**
   * Optional upload wiring — when present, the file drill-in pins an "Upload from
   * computer" row that opens the native dialog and routes fresh files into the
   * composer's attachment tray (`useFileSelect.addFiles`).
   */
  onUploadFiles?: (files: File[]) => void
  /** Which trigger opened the chip. Defaults to `'/'`. `'@'` roots the reference menu. */
  trigger?: PickerTrigger
  /** Draft-level signature/action wiring for the `@` menu. */
  references?: MailReferenceConfig
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
    id: 'text',
    title: 'Text',
    description: 'Plain text block',
    keywords: ['p', 'paragraph', 'body', 'normal'],
    iconId: 'text',
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
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

// Added to the suggestions only when the composer supplies `onAttachFile`.
const ATTACH_FILE_COMMAND: SlashCommandItem = {
  id: 'attach-file',
  title: 'Attach file',
  description: 'Attach a file from your library',
  keywords: ['file', 'attachment', 'upload', 'document', 'image'],
  iconId: 'paperclip',
  drillDown: true,
}

// --- AI "Ask AI" root item -------------------------------------------------
// Selecting it opens the focus-owning `AiSlashContent` panel (instruction input
// + preset ops). Icon is supplied by the section's `renderItem` (branded
// SparkleIcon), so no `iconId` here.
const AI_ROOT_COMMAND: SlashCommandItem = {
  id: 'ask-ai',
  title: 'Ask AI',
  description: 'Compose or rewrite with AI',
  keywords: ['ai', 'compose', 'rewrite', 'grammar', 'tone', 'translate', 'expand', 'shorten'],
  drillDown: true,
}

type NavItem = {
  id: string
  label: string
  type: 'snippets' | 'folder' | 'ai' | 'ai-tone' | 'ai-translate' | 'signatures' | 'actions'
}

// --- `@` reference root (signature + action drill-ins) --------------------
// Only rendered when `references` is supplied (email composer). Both items
// drill into a list; selection is draft-level state, not a body insertion.

const REFERENCE_ROOT_ITEMS: SlashCommandItem[] = [
  {
    id: 'use-signature',
    title: 'Use signature',
    description: 'Apply a saved signature to this reply',
    keywords: ['signature', 'sign', 'footer', 'sign-off'],
    iconId: 'feather',
    drillDown: true,
  },
  {
    id: 'add-action',
    title: 'Add action',
    description: 'Run an app action when you send',
    keywords: ['action', 'app', 'automation', 'workflow'],
    iconId: 'zap',
    drillDown: true,
  },
]

// Sentinel row id for clearing the selected signature from the drill list.
const REMOVE_SIGNATURE_ID = '__remove_signature__'

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
  const [mode, setMode] = useState<'default' | 'placeholder' | 'file'>('default')

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

  if (mode === 'file' && props.onAttachFile) {
    return (
      <FileSlashContent
        ref={props.ref}
        query={props.query}
        onBack={exitMode}
        backLabel='Commands'
        onClose={props.onClose}
        onAttachFile={(file) => {
          props.onAttachFile?.(file)
          exitMode()
        }}
        onUploadFiles={
          props.onUploadFiles
            ? (files) => {
                props.onUploadFiles?.(files)
                exitMode()
              }
            : undefined
        }
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
        onEnterFileMode={() => {
          setMode('file')
          props.onScopeChange('Files')
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
  onClose,
  onEnterPlaceholderMode,
  onEnterFileMode,
  onAttachFile,
  aiSlash,
  trigger = '/',
  references,
  blockCommands = MAIL_BLOCK_COMMANDS,
}: MailSlashContentProps & {
  onEnterPlaceholderMode: () => void
  onEnterFileMode: () => void
}) {
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

  const incrementUsage = api.snippet.incrementUsage.useMutation({
    onError: (error) => console.error('Failed to update snippet usage count', error),
  })

  const q = query.toLowerCase()

  const {
    allSnippets,
    loading: snippetsLoading,
    currentSnippets,
    currentFolders,
    subtreeSnippetResults,
    rootSnippetResults,
  } = useSnippetSearch({ query, currentFolderId, isAtRoot })

  // `@` reference data — fetched inside the component (like snippets). Hooks
  // run unconditionally; the lists only render under the `@` trigger.
  const { signatures } = useSignatures()
  const {
    actions: availableActions,
    groups: actionGroups,
    isLoading: actionsLoading,
  } = useActionCatalog()

  // Signature/action selections are draft-level state, not body insertions, so
  // (like the AI ops) the executor only strips the chip; the actual mutation
  // goes through `references`. Both also close the menu by removing the chip.
  const selectSignature = useCallback(
    (id: string | null) => {
      if (!references) return
      onExecute((editor, range) => editor.chain().focus().deleteRange(range).run())
      references.onSignatureChange(id)
    },
    [references, onExecute]
  )

  const toggleAction = useCallback(
    (action: SerializedQuickAction) => {
      if (!references) return
      const isSelected = references.actionIds.includes(action.id)
      onExecute((editor, range) => editor.chain().focus().deleteRange(range).run())
      if (isSelected) {
        references.onRemoveAction(action.id)
      } else {
        references.onAddAction(toDraftActionPayload(action))
      }
    },
    [references, onExecute]
  )

  const enterReferenceScope = useCallback(
    (type: 'signatures' | 'actions', label: string) => {
      push({ id: type, label, type })
      onScopeChange(label)
    },
    [push, onScopeChange]
  )

  const handleReferenceRootSelect = useCallback(
    (item: SlashCommandItem) => {
      if (item.id === 'use-signature') enterReferenceScope('signatures', 'Signature')
      else if (item.id === 'add-action') enterReferenceScope('actions', 'Add action')
    },
    [enterReferenceScope]
  )

  const enterSnippetsDrillDown = useCallback(() => {
    push({ id: 'snippets', label: 'Snippets', type: 'snippets' })
    onScopeChange('Snippets')
  }, [push, onScopeChange])

  // "Ask AI" pushes onto the real nav stack (so `CommandBreadcrumb` renders
  // "Commands › Ask AI"); the AI scope renders `AiSlashContent` instead of the
  // focusless `SlashList`.
  const enterAiScope = useCallback(() => {
    push({ id: 'ai', label: 'Ask AI', type: 'ai' })
    onScopeChange('Ask AI')
  }, [push, onScopeChange])

  const enterFolder = useCallback(
    (id: string, label: string) => {
      push({ id, label, type: 'folder' })
      onScopeChange(label)
    },
    [push, onScopeChange]
  )

  useImperativeHandle(ref, () => ({ ...remote, popLevel: popDrill }), [remote, popDrill])

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
        enterAiScope()
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
      if (item.id === 'attach-file') {
        onEnterFileMode()
        return
      }
      const cmd = blockCommands.find((c) => c.id === item.id)
      if (cmd) onExecute(cmd.run)
    },
    [
      blockCommands,
      enterAiScope,
      enterSnippetsDrillDown,
      onEnterPlaceholderMode,
      onEnterFileMode,
      onExecute,
    ]
  )

  const sections: SlashCommandSection<SlashCommandItem>[] = useMemo(() => {
    // `@` reference menu — a focused signature/action surface. Distinct from
    // the `/` formatting menu; never mixes block commands or Ask AI.
    if (trigger === '@') {
      if (!references) return []

      if (current?.type === 'signatures') {
        const sigItems: SlashCommandItem[] = signatures.map((s) => ({ id: s.id, title: s.name }))
        if (references.signatureId) {
          sigItems.push({ id: REMOVE_SIGNATURE_ID, title: 'Remove signature', iconId: 'x' })
        }
        const signaturesSection: SlashCommandSection<SlashCommandItem> = {
          id: 'signatures',
          heading: 'Signatures',
          items: sigItems,
          itemValue: (item) => item.id,
          onSelect: (item) => selectSignature(item.id === REMOVE_SIGNATURE_ID ? null : item.id),
          renderItem: (item) => (
            <div className='flex w-full items-center gap-2'>
              <EntityIcon
                iconId={item.iconId ?? 'feather'}
                size='sm'
                className='text-muted-foreground'
              />
              <span className='flex-1 truncate'>{item.title}</span>
              {references.signatureId === item.id && (
                <Check className='size-3.5 shrink-0 text-primary-600' />
              )}
            </div>
          ),
        }
        return [signaturesSection]
      }

      if (current?.type === 'actions') {
        // One section per app — heading is the app title, each row shows the
        // resolved action icon (its own `iconKey`, falling back to the app
        // avatar). `AppIcon` (not `EntityIcon`) so URL avatars render.
        return actionGroups.map<SlashCommandSection<SlashCommandItem>>((group) => ({
          id: `actions:${group.app.id}`,
          heading: group.app.title,
          items: group.actions.map((a) => ({
            id: a.id,
            title: a.label,
            description: a.description,
            iconId: a.iconId,
          })),
          itemValue: (item) => item.id,
          onSelect: (item) => {
            const action = availableActions.find((a) => a.id === item.id)
            if (action) toggleAction(action)
          },
          renderItem: (item) => (
            <div className='flex w-full items-center gap-2'>
              <AppIcon iconId={item.iconId ?? 'zap'} size='sm' />
              <span className='flex-1 truncate'>{item.title}</span>
              {references.actionIds.includes(item.id) && (
                <Check className='size-3.5 shrink-0 text-primary-600' />
              )}
            </div>
          ),
        }))
      }

      return [
        {
          id: 'reference-root',
          heading: 'Insert',
          items: REFERENCE_ROOT_ITEMS,
          onSelect: handleReferenceRootSelect,
        },
      ]
    }

    if (isInSnippets) {
      // While searching, show flattened subtree matches (snippets only) so
      // snippets nested in subfolders surface. While browsing, show this
      // level's folders + direct snippets.
      const snippetItems: SnippetItem[] = q
        ? subtreeSnippetResults.map<SnippetItem>((s) => ({
            id: `snippet-${s.id}`,
            title: s.title,
            kind: 'snippet',
          }))
        : [
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
              size='sm'
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
      items: [
        ...(aiSlash ? [AI_ROOT_COMMAND] : []),
        ...TOOL_COMMANDS,
        ...(onAttachFile ? [ATTACH_FILE_COMMAND] : []),
        ...blockCommands,
      ],
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
              <EntityIcon iconId={item.iconId} size='sm' className='text-muted-foreground' />
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
            <EntityIcon iconId='file-text' size='sm' className='text-muted-foreground' />
            <span>{item.title}</span>
          </div>
        ),
      }
      out.push(rootSnippetsSection as unknown as SlashCommandSection<SlashCommandItem>)
    }

    return out
  }, [
    q,
    isInSnippets,
    currentFolders,
    currentSnippets,
    subtreeSnippetResults,
    current,
    handleSuggestionSelect,
    rootSnippetResults,
    enterFolder,
    insertSnippet,
    aiSlash,
    blockCommands,
    onAttachFile,
    trigger,
    references,
    signatures,
    availableActions,
    actionGroups,
    selectSignature,
    toggleAction,
    handleReferenceRootSelect,
  ])

  const isInActions = current?.type === 'actions'

  // The "Ask AI" scope renders its own focus-owning panel (instruction input +
  // presets) instead of the focusless `SlashList`. It lives inside this same
  // `CommandNavigation`, so its `CommandBreadcrumb` shows the real path.
  if (isInAi && aiSlash) {
    return (
      <AiSlashContent
        editor={editor}
        onScopeChange={onScopeChange}
        onClose={onClose}
        // Strip the chip (mirrors snippet/placeholder executors) then run AI on
        // the now-clean doc — the existing processing UI takes over.
        onRunAI={(operation, options) => {
          onExecute((e, range) => e.chain().focus().deleteRange(range).run())
          aiSlash.onRunAI(operation, options)
        }}
      />
    )
  }

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <SlashList
        query={query}
        sections={sections}
        header={<CommandBreadcrumb rootLabel={trigger === '@' ? 'Insert' : 'Commands'} />}
        emptyMessage={
          isInSnippets
            ? 'No snippets found.'
            : isInActions
              ? 'No actions available.'
              : 'No results found.'
        }
        // Only drill-downs that fetch need a loading state — the static root
        // suggestions render instantly. Snippets and `@`-actions are the two.
        loading={(isInSnippets && snippetsLoading) || (isInActions && actionsLoading)}
      />
    </div>
  )
}

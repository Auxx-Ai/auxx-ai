// apps/web/src/components/editor/slash-commands/slash-content.tsx
'use client'

import type { Editor } from '@tiptap/react'
import { useImperativeHandle, useMemo, useRef } from 'react'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { DEFAULT_BLOCKS, type EditorBlock } from '../blocks/allowed-blocks'
import {
  BASIC_BLOCK_COMMANDS,
  type BlockCommandDef,
  filterBlockCommands,
  runBlockCommand,
} from './block-commands'
import type { SlashCommandItem, SlashCommandSection } from './slash-command-picker'
import { type SlashContentHandle, SlashList } from './slash-list'

/**
 * Contract between the slash popover host (`PromptEditorContent`,
 * `KBArticleEditor`) and the content it mounts. The `/` chip owns the query
 * and keyboard; content components are presentational + an imperative
 * handle for the forwarded keys.
 */
export interface SlashContentProps {
  ref?: React.Ref<SlashContentHandle>
  /** Live filter — the chip's text content. */
  query: string
  /** Current drill scope (chip sublabel) — null at root. */
  scope: string | null
  editor: Editor
  allowedBlocks: EditorBlock[]
  /**
   * Run an executor with the chip's range. The executor must
   * `deleteRange(range)` inside its own chain so chip removal + the
   * command's edit land in ONE transaction (one undo step) — same contract
   * as the legacy suggestion-based slash commands.
   */
  onExecute: (cmd: (editor: Editor, range: { from: number; to: number }) => void) => void
  /** Replace the chip with an inline reference badge (`route:*`, `code:*`, …). */
  onInsertReference: (id: string) => void
  /** Update the chip's drill scope (sublabel) — also clears the chip query. */
  onScopeChange: (scope: string | null) => void
  /** Close the chip (keeps the typed text, mirroring `@`). */
  onClose: () => void
}

/**
 * Default slash content: the basic block commands, filtered by the
 * surface's `allowedBlocks`. Persona / template / workflow prompt editors
 * mount this; KB and procedures pass their own content via `slashContent`.
 */
export function BlocksSlashContent({
  ref,
  query,
  allowedBlocks = DEFAULT_BLOCKS,
  onExecute,
}: SlashContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, query)

  useImperativeHandle(ref, () => ({ ...remote, popLevel: () => false }), [remote])

  const sections: SlashCommandSection<SlashCommandItem>[] = useMemo(
    () => [
      {
        id: 'blocks',
        heading: 'Blocks',
        items: filterBlockCommands(BASIC_BLOCK_COMMANDS, allowedBlocks),
        onSelect: (item) => onExecute(runBlockCommand(item as BlockCommandDef)),
      },
    ],
    [allowedBlocks, onExecute]
  )

  return (
    <div ref={containerRef}>
      <SlashList query={query} sections={sections} />
    </div>
  )
}

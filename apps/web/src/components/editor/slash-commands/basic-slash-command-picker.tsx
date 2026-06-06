// apps/web/src/components/editor/slash-commands/basic-slash-command-picker.tsx
'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_BLOCKS, type EditorBlock } from '../blocks/allowed-blocks'
import {
  BASIC_BLOCK_COMMANDS,
  type BlockCommandDef,
  filterBlockCommands,
  runBlockCommand,
} from './block-commands'
import {
  type SlashCommandItem,
  SlashCommandPicker,
  type SlashCommandSection,
} from './slash-command-picker'

type Range = { from: number; to: number }

interface BasicSlashCommandPickerProps {
  query: string
  onExecute: (command: (editor: Editor, range: Range) => void) => void
  onClose: () => void
  /** Block kinds to show. Defaults to the full set. */
  allowedBlocks?: EditorBlock[]
}

/**
 * Slim slash menu used by surfaces that only need basic block commands —
 * no snippets, placeholders, or article links. Persona editor uses this;
 * future agent-trigger / workflow-prompt editors can mount it too.
 */
export function BasicSlashCommandPicker({
  query,
  onExecute,
  onClose,
  allowedBlocks = DEFAULT_BLOCKS,
}: BasicSlashCommandPickerProps) {
  const [searchQuery, setSearchQuery] = useState(query)

  // Mirror the external query into the controlled input so typing past the
  // trigger keeps the input in sync with the suggestion plugin.
  useEffect(() => {
    setSearchQuery(query)
  }, [query])

  const sections: SlashCommandSection<SlashCommandItem>[] = useMemo(
    () => [
      {
        id: 'blocks',
        heading: 'Blocks',
        items: filterBlockCommands(BASIC_BLOCK_COMMANDS, allowedBlocks),
        onSelect: (item) => onExecute(runBlockCommand(item as BlockCommandDef)),
      },
    ],
    [onExecute, allowedBlocks]
  )

  return (
    <SlashCommandPicker
      query={query}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      onClose={onClose}
      sections={sections}
    />
  )
}

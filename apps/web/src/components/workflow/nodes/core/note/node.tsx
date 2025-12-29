// apps/web/src/components/workflow/nodes/core/note/node.tsx

import React, { memo, useRef, useCallback, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NoteNode as NoteNodeType, NoteNodeData, NoteTheme } from './types'
import { THEME_MAP, MIN_NOTE_WIDTH, MIN_NOTE_HEIGHT } from './constants'
import { NoteEditor } from './editor/note-editor'
import { NoteToolbar } from './editor/note-toolbar'
import { cn } from '@auxx/ui/lib/utils'
import { useNodeCrud, useNodesInteractions } from '~/components/workflow/hooks'
import { NodeResizer } from '~/components/workflow/ui/node-resizer'
import { produce } from 'immer'

export const NoteNode = memo<NoteNodeType>(({ id, data, selected, width, height }) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [editor, setEditor] = useState<any>(null)

  // Use new hooks for data management
  const { inputs, setInputs } = useNodeCrud<NoteNodeData>(id, data)
  const { handleDeleteNode, handleCopyNode, handleNodesPaste } = useNodesInteractions()

  // Get current user for author
  const currentUser = 'Current User' // This should come from your auth context

  const theme: NoteTheme = inputs?.theme || 'yellow'
  const showAuthor = inputs?.showAuthor || false

  const handleThemeChange = useCallback(
    (newTheme: NoteTheme) => {
      setInputs({ ...inputs, theme: newTheme })
    },
    [inputs, setInputs]
  )

  const handleFontSizeChange = useCallback(
    (size: number) => {
      setInputs({ ...inputs, fontSize: size })
    },
    [inputs, setInputs]
  )

  const handleEditorChange = useCallback(
    (content: string) => {
      setInputs({ ...inputs, text: content })
    },
    [inputs, setInputs]
  )

  const handleShowAuthorChange = useCallback(
    (show: boolean) => {
      const newData = produce(inputs, (draft) => {
        draft.showAuthor = show
        draft.author = show ? currentUser : ''
      })
      setInputs(newData)
    },
    [inputs, setInputs, currentUser]
  )

  const handleCopy = useCallback(() => {
    // Use the copy handler from interactions hook
    handleCopyNode(id)
  }, [id, handleCopyNode])

  const handleDuplicate = useCallback(() => {
    // First copy the node
    handleCopyNode(id)
    // Then paste it with offset
    setTimeout(() => {
      handleNodesPaste({ x: 50, y: 50 })
    }, 50)
  }, [id, handleCopyNode, handleNodesPaste])

  const handleDelete = useCallback(() => {
    handleDeleteNode(id)
  }, [id, handleDeleteNode])
  // No need for click outside effect - ReactFlow handles selection

  return (
    <div
      ref={ref}
      className={cn(
        'note-node group relative flex flex-col rounded-md border shadow-xs hover:shadow-md h-full',
        THEME_MAP[theme].bg,
        selected ? THEME_MAP[theme].border : 'border-black/5'
      )}
      style={{ width, height }}>
      {/* Invisible handles to prevent React Flow warnings */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        style={{ opacity: 0, pointerEvents: 'none' }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        style={{ opacity: 0, pointerEvents: 'none' }}
        isConnectable={false}
      />
      <NodeResizer
        nodeId={id}
        selected={selected!}
        minWidth={MIN_NOTE_WIDTH}
        minHeight={MIN_NOTE_HEIGHT}
      />

      {/* Color bar at top */}
      <div className={cn('h-2 shrink-0 rounded-t-md opacity-50', THEME_MAP[theme].title)} />

      {/* Toolbar - shown when selected */}
      {selected && (
        <div className="absolute left-1/2 top-[-41px] -translate-x-1/2 z-10">
          <NoteToolbar
            editor={editor}
            theme={theme}
            fontSize={inputs?.fontSize || 14}
            showAuthor={showAuthor}
            onThemeChange={handleThemeChange}
            onFontSizeChange={handleFontSizeChange}
            onCopy={handleCopy}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onShowAuthorChange={handleShowAuthorChange}
          />
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 overflow-hidden px-3 py-2.5">
        <div className={cn(selected && 'nodrag nopan nowheel cursor-text')}>
          <NoteEditor
            content={inputs?.text || ''}
            onChange={handleEditorChange}
            placeholder="Write your note..."
            fontSize={inputs?.fontSize || 14}
            editable={true}
            theme={THEME_MAP[theme]}
            onEditorReady={setEditor}
            onFocus={() => setIsEditorFocused(true)}
            onBlur={() => setIsEditorFocused(false)}
          />
        </div>
      </div>

      {/* Author display */}
      {showAuthor && inputs?.author && <div className="p-3 pt-0 text-xs">{inputs.author}</div>}
    </div>
  )
})

NoteNode.displayName = 'NoteNode'

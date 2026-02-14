// apps/web/src/components/workflow/nodes/core/manual/connected-inputs-editor.tsx

import { generateKeyBetween } from '@auxx/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore, useStoreApi } from '@xyflow/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useAvailableVariables, useNodesInteractions } from '~/components/workflow/hooks'
import { useNodeDataUpdate } from '~/components/workflow/hooks/use-node-data-update'
import { useReadOnly } from '~/components/workflow/hooks/use-read-only'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { useConfirm } from '~/hooks/use-confirm'
import type { FormInputNodeData } from '../../inputs/form-input/types'
import { ConnectedInputItem } from './connected-input-item'

/**
 * Internal data structure for a connected input node
 */
interface ConnectedInput {
  id: string
  title: string
  required: boolean
  position: string | undefined
  inputType: string | undefined // For hash tracking (icon changes)
  icon: React.ReactNode
}

/**
 * Props for ConnectedInputsEditor component
 */
interface ConnectedInputsEditorProps {
  /** The manual trigger node ID */
  manualNodeId: string
}

/**
 * Sortable wrapper for ConnectedInputItem
 */
function SortableInputItem({
  input,
  onEdit,
  onRemove,
}: {
  input: ConnectedInput
  onEdit: () => void
  onRemove: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: input.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}>
      <ConnectedInputItem
        title={input.title}
        required={input.required}
        icon={input.icon}
        attributes={attributes}
        listeners={listeners}
        style={style}
        isDragging={isDragging}
        isHovered={isHovered}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </div>
  )
}

/**
 * Editor component for managing connected form-input nodes in the manual trigger panel
 * Supports drag-and-drop reordering with fractional indexing
 */
export function ConnectedInputsEditor({ manualNodeId }: ConnectedInputsEditorProps) {
  const store = useStoreApi()
  const { isReadOnly } = useReadOnly()
  const { handleNodeDataUpdateWithSync } = useNodeDataUpdate()
  const { handleNodeSelect, handleCenterOnNode, handleDeleteNode } = useNodesInteractions()
  const [confirm, ConfirmDialog] = useConfirm()

  // Get connected form-input nodes from useAvailableVariables
  const { groups } = useAvailableVariables({ nodeId: manualNodeId })

  // Get form-input node IDs from groups
  const formInputNodeIds = useMemo(() => {
    return groups
      .filter((group) => group.type === 'node' && group.nodeType === 'form-input')
      .map((group) => group.id.replace('node-', ''))
  }, [groups])

  // Hash-based selector to get node data reactively (prevents re-renders on position drag)
  const hashRef = useRef<string>('')
  const dataRef = useRef<ConnectedInput[]>([])

  const connectedInputs = useStore(
    useCallback(
      (state) => {
        const inputs: ConnectedInput[] = formInputNodeIds.map((nodeId) => {
          const node = state.nodes.find((n) => n.id === nodeId)
          const nodeData = node?.data as FormInputNodeData | undefined
          const group = groups.find((g) => g.id === `node-${nodeId}`)

          return {
            id: nodeId,
            title: group?.name || nodeData?.label || 'Form Input',
            required: nodeData?.required ?? false,
            position: nodeData?.position,
            inputType: nodeData?.inputType,
            icon: unifiedNodeRegistry.getNodeIcon('form-input', 'size-3', nodeData),
          }
        })

        // Create hash of relevant data (positions, required, title, inputType)
        const newHash = inputs
          .map((n) => `${n.id}:${n.title}:${n.required}:${n.position ?? ''}:${n.inputType ?? ''}`)
          .sort()
          .join('|')

        // Only return new array if hash changed
        if (newHash !== hashRef.current) {
          hashRef.current = newHash
          dataRef.current = inputs
        }

        return dataRef.current
      },
      [formInputNodeIds, groups]
    )
  )

  // Sort by position (fractional indexing)
  const sortedInputs = useMemo(() => {
    return [...connectedInputs].sort((a, b) => {
      if (!a.position && !b.position) return 0
      if (!a.position) return 1
      if (!b.position) return -1
      return a.position.localeCompare(b.position)
    })
  }, [connectedInputs])

  // DnD state
  const [activeInput, setActiveInput] = useState<ConnectedInput | null>(null)

  // Set up DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handle drag start
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const input = sortedInputs.find((i) => i.id === event.active.id) || null
      setActiveInput(input)
    },
    [sortedInputs]
  )

  // Handle drag end - update position using fractional indexing
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = sortedInputs.findIndex((i) => i.id === active.id)
        const newIndex = sortedInputs.findIndex((i) => i.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          // Calculate what the new sorted order would be after the move
          const newOrder = arrayMove(sortedInputs, oldIndex, newIndex)

          // Check if any items have no position OR if positions are not unique (e.g., all "a0")
          const positions = newOrder.map((item) => item.position).filter(Boolean)
          const uniquePositions = new Set(positions)
          const needsReindex =
            positions.length !== newOrder.length || uniquePositions.size !== positions.length

          if (needsReindex) {
            // Assign positions to ALL items based on the new order
            // This ensures consistent ordering when items start without positions
            let lastPosition: string | null = null
            newOrder.forEach((item) => {
              const newPosition = generateKeyBetween(lastPosition, null)
              lastPosition = newPosition

              // Update each item's position
              handleNodeDataUpdateWithSync({
                id: item.id,
                data: { position: newPosition },
              })
            })
          } else {
            // All items have positions - just update the moved item
            const movedItemNewIndex = newIndex
            const prevItem = movedItemNewIndex > 0 ? newOrder[movedItemNewIndex - 1] : null
            const nextItem =
              movedItemNewIndex < newOrder.length - 1 ? newOrder[movedItemNewIndex + 1] : null

            const prevPosition = prevItem?.position ?? null
            const nextPosition = nextItem?.position ?? null

            // Generate a position between the neighbors
            const newPosition = generateKeyBetween(prevPosition, nextPosition)

            // Update the node's position
            handleNodeDataUpdateWithSync({
              id: active.id as string,
              data: { position: newPosition },
            })
          }
        }
      }

      setActiveInput(null)
    },
    [sortedInputs, handleNodeDataUpdateWithSync]
  )

  // Handle drag cancel
  const handleDragCancel = useCallback(() => {
    setActiveInput(null)
  }, [])

  // Handle edit - navigate to the form-input node
  const handleEdit = useCallback(
    (nodeId: string) => {
      handleNodeSelect(nodeId, false)
      handleCenterOnNode(nodeId)
    },
    [handleNodeSelect, handleCenterOnNode]
  )

  // Handle remove - delete the form-input node
  const handleRemove = useCallback(
    async (nodeId: string, title: string) => {
      const confirmed = await confirm({
        title: 'Remove input?',
        description: `This will delete the "${title}" form input node from the workflow.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        handleDeleteNode(nodeId)
      }
    },
    [confirm, handleDeleteNode]
  )

  // Empty state
  if (sortedInputs.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        No inputs connected. Add form input nodes to collect user data.
      </p>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        modifiers={[restrictToVerticalAxis]}>
        <div className='space-y-1'>
          <SortableContext
            items={sortedInputs.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
            disabled={isReadOnly}>
            {sortedInputs.map((input) => (
              <SortableInputItem
                key={input.id}
                input={input}
                onEdit={() => handleEdit(input.id)}
                onRemove={() => handleRemove(input.id, input.title)}
              />
            ))}
          </SortableContext>
        </div>
        <DragOverlay adjustScale={false} modifiers={[restrictToParentElement]}>
          {activeInput ? (
            <ConnectedInputItem
              title={activeInput.title}
              required={activeInput.required}
              icon={activeInput.icon}
              isOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

// apps/web/src/components/workflow/nodes/base/next-step/operator.tsx

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { MoreHorizontal, Replace, Trash2, Unlink } from 'lucide-react'
import { useCallback } from 'react'
import {
  useAvailableBlocks,
  useEdgeValidation,
  useNodesInteractions,
} from '~/components/workflow/hooks'
import { BlockSelector } from '~/components/workflow/ui/block-selector'
import type { OperatorProps } from './types'

// Utility function to find intersection of two arrays
function intersection<T>(arr1: T[], arr2: T[]): T[] {
  return arr1.filter((x) => arr2.includes(x))
}

type ChangeItemProps = {
  data: OperatorProps['data']
  nodeId: string
  sourceHandle: string
  onClose: () => void
}

const ChangeItem = ({ data, nodeId, sourceHandle, onClose }: ChangeItemProps) => {
  const { availablePrevBlocks } = useAvailableBlocks(
    data.type,
    false, // isInLoop
    'target'
  )
  const { availableNextBlocks } = useAvailableBlocks(
    data.type,
    false, // isInLoop
    'source'
  )
  const store = useStoreApi()
  const { handleDeleteNode } = useNodesInteractions()

  const handleSelect = useCallback(
    (type: string, toolDefaultValue: any) => {
      const { nodes, setNodes } = store.getState()

      // Find current node
      const currentNode = nodes.find((node) => node.id === nodeId)
      if (!currentNode) return

      // Delete current node
      handleDeleteNode(nodeId)

      // Add new node in same position using setNodes with produce
      const newNode = {
        id: nodeId, // Keep same ID to maintain connections
        type: type, // Keep same type
        // type: 'custom',
        position: currentNode.position,
        data: { ...toolDefaultValue, type, label: toolDefaultValue?.label || type },
      }

      setNodes(
        produce(nodes, (draft) => {
          // Remove old node
          const nodeIndex = draft.findIndex((node) => node.id === nodeId)
          if (nodeIndex !== -1) {
            draft.splice(nodeIndex, 1)
          }
          // Add new node
          draft.push(newNode)
        })
      )

      onClose()
    },
    [nodeId, handleDeleteNode, store, onClose]
  )

  const renderTrigger = useCallback(() => {
    return (
      <button className='flex h-8 w-full cursor-pointer items-center rounded-lg px-2 hover:bg-muted'>
        <Replace className='mr-2 size-3' />
        Change node
      </button>
    )
  }, [])

  return (
    <BlockSelector
      onSelect={handleSelect}
      customTrigger={renderTrigger()}
      availableBlocksTypes={intersection(availablePrevBlocks, availableNextBlocks).filter(
        (item) => item !== data.type
      )}
    />
  )
}

const Operator = ({ open, onOpenChange, data, nodeId, sourceHandle }: OperatorProps) => {
  const store = useStoreApi()
  const { getConnectedEdges } = useEdgeValidation()
  const { handleDeleteNode } = useNodesInteractions()

  const handleNodeDelete = useCallback(() => {
    handleDeleteNode(nodeId)
    onOpenChange(false)
  }, [nodeId, handleDeleteNode, onOpenChange])

  const handleNodeDisconnect = useCallback(() => {
    const { edges, setEdges } = store.getState()

    // Find all edges connected to this node
    const connectedEdges = getConnectedEdges(nodeId)

    // Remove all connected edges using setEdges with produce
    setEdges(
      produce(edges, (draft) => {
        connectedEdges.forEach((edge) => {
          const edgeIndex = draft.findIndex((e) => e.id === edge.id)
          if (edgeIndex !== -1) {
            draft.splice(edgeIndex, 1)
          }
        })
      })
    )

    onOpenChange(false)
  }, [nodeId, getConnectedEdges, store, onOpenChange])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant='ghost' className='size-6 p-0'>
          <MoreHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-1' align='end'>
        <div className='space-y-1'>
          <ChangeItem
            data={data}
            nodeId={nodeId}
            sourceHandle={sourceHandle}
            onClose={() => onOpenChange(false)}
          />
          <button
            className='flex h-8 w-full cursor-pointer items-center rounded-lg px-2 hover:bg-muted'
            onClick={handleNodeDisconnect}>
            <Unlink className='mr-2 size-3' />
            Disconnect
          </button>
          <div className='my-1 h-px bg-border' />
          <button
            className='flex h-8 w-full cursor-pointer items-center rounded-lg px-2 text-destructive hover:bg-destructive/10'
            onClick={handleNodeDelete}>
            <Trash2 className='mr-2 size-3' />
            Delete
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default Operator

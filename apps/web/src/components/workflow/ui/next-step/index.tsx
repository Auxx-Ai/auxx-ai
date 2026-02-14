// apps/web/src/components/workflow/nodes/base/next-step/index.tsx

import { useStoreApi } from '@xyflow/react'
import { memo, useMemo } from 'react'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { getIcon } from '../../utils'
import Container from './container'
import Line from './line'
import type { NextStepProps } from './types'

const NextStep = ({ data, nodeId }: NextStepProps) => {
  const state = useStoreApi()
  const { nodes, edges } = state.getState()

  const branches = useMemo(() => {
    return data._targetBranches || []
  }, [data])

  // Get outgoing edges and connected nodes
  const connectedEdges = edges.filter((edge) => edge.source === nodeId)
  const outgoers = connectedEdges
    .map((edge) => {
      return nodes.find((node) => node.id === edge.target)
    })
    .filter(Boolean)

  // Get node icon
  const nodeDefinition = unifiedNodeRegistry.getDefinition(data.type as any)

  const list = useMemo(() => {
    let items: Array<{ branch: { id: string; name: string }; nextNodes: any[] }> = []
    if (branches?.length) {
      items = branches.map((branch: any) => {
        const connected = connectedEdges.filter((edge) => edge.sourceHandle === branch.id)
        const nextNodes = connected
          .map((edge) => outgoers.find((outgoer) => outgoer?.id === edge.target))
          .filter(Boolean)

        return { branch, nextNodes }
      })
    } else {
      const connected = connectedEdges.filter((edge) => edge.sourceHandle === 'source')
      const nextNodes = connected
        .map((edge) => outgoers.find((outgoer) => outgoer?.id === edge.target))
        .filter(Boolean)

      items = [{ branch: { id: 'source', name: '', type: 'default' }, nextNodes }]
    }

    return items
  }, [branches, connectedEdges, outgoers])

  return (
    <div className='flex py-1'>
      <div className='relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] shadow-xs'>
        {getIcon(nodeDefinition?.icon ?? 'Box', 'size-4', {
          color: nodeDefinition?.color || '#6b7280',
        })}
      </div>
      <Line list={list.length ? list.map((item: any) => item.nextNodes.length + 1) : [1]} />
      <div className='grow space-y-2'>
        {list.map((item: any, index: number) => {
          return (
            <Container
              key={index}
              nodeId={nodeId}
              nodeData={data}
              sourceHandle={item.branch.id}
              branchType={item.branch.type}
              nextNodes={item.nextNodes}
              branchName={item.branch.name}
            />
          )
        })}
      </div>
    </div>
  )
}

export default memo(NextStep)

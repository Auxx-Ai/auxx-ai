import { pluralize } from '@auxx/utils/strings'
import type { ReactFlowState } from '@xyflow/react'
import { Panel, useStore } from '@xyflow/react'
import { memo } from 'react'

const nodesLengthSelector = (state: ReactFlowState) => state.nodes.length || 0
const edgesLengthSelector = (state: ReactFlowState) => state.edges.length || 0
const selectedNodesSelector = (state: ReactFlowState) =>
  state.nodes.filter((node) => node.selected).length || 0
const selectedEdgesSelector = (state: ReactFlowState) =>
  state.edges.filter((edge) => edge.selected).length || 0

const CanvasNodeInfo = memo(() => {
  const selectedNodes = useStore(selectedNodesSelector)
  const selectedEdges = useStore(selectedEdgesSelector)

  console.log('Selected nodes:', selectedNodes, 'Selected edges:', selectedEdges)

  if (selectedNodes === 0 && selectedEdges === 0) return null
  return (
    <Panel position='bottom-center'>
      <div className='text-xs text-muted-foreground glass px-2 py-1 rounded select-none'>
        {selectedNodes > 0 && (
          <>
            {selectedNodes} {pluralize(selectedNodes, 'node')}
          </>
        )}
        {selectedNodes > 0 && selectedEdges > 0 && ' & '}
        {selectedEdges > 0 && (
          <>
            {selectedEdges} {pluralize(selectedEdges, 'connection')}
          </>
        )}
        {(selectedNodes > 0 || selectedEdges > 0) && ' selected'}
      </div>
    </Panel>
  )
})

CanvasNodeInfo.displayName = 'CanvasNodeInfo'

export { CanvasNodeInfo }

// apps/web/src/components/workflow/nodes/base/next-step/item.tsx

import { memo, useCallback, useState } from 'react'
import Operator from './operator'
import { Button } from '@auxx/ui/components/button'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { useNodesInteractions, useNodesReadOnly } from '~/components/workflow/hooks'
import { cn } from '@auxx/ui/lib/utils'
import type { ItemProps } from './types'
import { getIcon } from '../../utils'

const Item = ({ nodeId, sourceHandle, data }: ItemProps) => {
  const [open, setOpen] = useState(false)
  const { getNodesReadOnly } = useNodesReadOnly()
  const nodesReadOnly = getNodesReadOnly()
  const { handleNodeSelect } = useNodesInteractions()

  // Get node icon
  const nodeDefinition = unifiedNodeRegistry.getDefinition(data.type as any)

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])

  const handleNodeSelectClick = useCallback(() => {
    handleNodeSelect(nodeId, false)
  }, [nodeId, handleNodeSelect])

  return (
    <div className="group relative flex h-9 cursor-pointer items-center rounded-lg border-[0.5px] bg-background px-2 text-xs text-primary-500 shadow-xs last-of-type:mb-0 hover:bg-primary-50">
      {getIcon(nodeDefinition?.icon ?? 'Box', 'mr-1.5 h-4 w-4 shrink-0', {
        color: nodeDefinition?.color || '#6b7280',
      })}
      <div className="grow truncate text-xs font-medium text-primary-400" title={data.title}>
        {data.title}
      </div>
      {!nodesReadOnly && (
        <>
          <Button
            className="mr-1 hidden shrink-0 group-hover:flex"
            size="sm"
            variant="ghost"
            onClick={handleNodeSelectClick}>
            Jump
          </Button>
          <div className={cn('hidden shrink-0 items-center group-hover:flex', open && 'flex')}>
            <Operator
              data={data}
              nodeId={nodeId}
              sourceHandle={sourceHandle}
              open={open}
              onOpenChange={handleOpenChange}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default memo(Item)

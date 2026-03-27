// apps/web/src/components/workflow/ui/variables/variable-tag.tsx

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Globe, Settings } from 'lucide-react'
import type React from 'react'
import { useMemo } from 'react'
import { useNodeTitle } from '~/components/workflow/hooks'
import { useVariable } from '~/components/workflow/hooks/use-var-store-sync'
import { useVarStore } from '~/components/workflow/store/use-var-store'
import { BaseType } from '~/components/workflow/types/unified-types'
import { getVarTypeName, VarTypeIcon } from '~/components/workflow/utils'
import {
  buildVariableLabelPath,
  getNodeIdFromVariableId,
  getPathFromVariableId,
} from '~/components/workflow/utils/variable-utils'

/** Slash SVG separator between node title and variable path */
const Slash: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    width='5'
    height='12'
    viewBox='0 0 5 12'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className='mr-0.5 text-divider-deep'
    data-icon='Line3'
    aria-hidden='true'
    {...props}>
    <path id='Line 3' d='M1 11.3545L3.94174 0.645781' stroke='#D0D5DD' strokeLinecap='round' />
  </svg>
)

export type VariableTagProps = {
  variableId: string
  nodeId?: string
  isShort?: boolean
  selected?: boolean
  /** Callback when variable ID changes (e.g., array accessor updated via context menu) */
  onVariableIdChange?: (newId: string) => void
}

const VariableTag = ({
  variableId,
  nodeId,
  isShort = true,
  selected = false,
  onVariableIdChange,
}: VariableTagProps) => {
  const { variable, isValid, isSystemVar, isEnvVar, isNodeVar } = useVariable(variableId, nodeId)

  const variableNodeId = useMemo(
    () => (variable ? getNodeIdFromVariableId(variable.id) : undefined),
    [variable]
  )

  const nodeTitle = useNodeTitle(isNodeVar ? variableNodeId : undefined)
  const typeIcon = (
    <VarTypeIcon type={variable?.type ?? BaseType.STRING} className='mr-0.5 size-3.5 shrink-0' />
  )
  const varTypeTitle = getVarTypeName(variable?.type ?? BaseType.STRING)

  const variableName = useMemo(() => {
    if (!variable) return ''
    if (isSystemVar) return variable.id
    if (isEnvVar) return getPathFromVariableId(variable.id)
    const resolveVar = useVarStore.getState().actions.getVariableById
    return buildVariableLabelPath(variable.id, resolveVar) || getPathFromVariableId(variable.id)
  }, [variable, isSystemVar, isEnvVar])

  const pathSegments = useMemo(() => variableName.split('.').filter(Boolean), [variableName])

  const errorMessage = useMemo(() => {
    if (!variable) return 'Variable not found'
    if (isNodeVar && !nodeId) return 'Cannot validate variable - no context node'
    if (isNodeVar && !variableNodeId) return 'Variable missing source node information'
    return 'Invalid variable reference'
  }, [variable, isNodeVar, nodeId, variableNodeId])

  // Variable not found — show error state
  if (!variable) {
    return (
      <div
        title={variableId}
        className='inline-flex shrink-0 h-5 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-xs shadow-xs cursor-pointer group-aria-selected/var:bg-destructive'>
        <AlertTriangle className='mr-0.5 size-3 text-destructive group-aria-selected/var:text-white/90' />
        <span className='text-destructive group-aria-selected/var:text-white/90'>Unknown Var</span>
      </div>
    )
  }

  /** Render variable path with segment collapsing for long node variable paths */
  const renderPath = () => {
    // For non-short mode, system/env vars, or short paths — show full text
    if (!isShort || !isNodeVar || pathSegments.length <= 2) {
      return <span className='truncate'>{variableName}</span>
    }

    // 3+ segments: collapse middle into ellipsis
    const first = pathSegments[0]
    const last = pathSegments[pathSegments.length - 1]
    const middle = pathSegments.slice(1, -1)

    return (
      <>
        <span className='truncate shrink-[2]'>{first}</span>
        <span className='shrink-0 opacity-60' title={middle.join(' > ')}>
          .….
        </span>
        <span className='truncate'>{last}</span>
      </>
    )
  }

  const tag = (
    <div
      className={cn(
        'inline-flex shrink-0 h-5 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-xs shadow-xs cursor-pointer',
        !isValid && 'border-destructive bg-destructive/10',
        'group-aria-selected/var:border-transparent group-aria-selected/var:bg-info group-aria-selected/var:text-background group-aria-selected/var:ring-0 group-aria-selected/var:ring-info/90',
        isEnvVar && 'group-aria-selected/var:bg-violet-500',
        isSystemVar && 'group-aria-selected/var:bg-gray-500',
        !isValid && 'group-aria-selected/var:bg-destructive'
      )}
      onClick={(e) => {
        if ((e.metaKey || e.ctrlKey) && isNodeVar) {
          e.stopPropagation()
        }
      }}>
      {isNodeVar && (
        <>
          {nodeTitle && (
            <>
              <div className='truncate shrink-[2] min-w-[16px] font-medium text-muted-foreground group-aria-selected/var:text-white/90'>
                {nodeTitle}
              </div>
              <Slash className='mx-0.5 size-3 shrink-0 text-muted-foreground group-aria-selected/var:text-white/90' />
            </>
          )}
          <span title={varTypeTitle} className='shrink-0'>
            {typeIcon}
          </span>
        </>
      )}
      {isSystemVar && (
        <Settings className='mr-0.5 size-3.5 shrink-0 text-gray-500 group-aria-selected/var:text-white/50' />
      )}
      {isEnvVar && (
        <Globe className='mr-0.5 size-3.5 shrink-0 text-violet-600 group-aria-selected/var:text-white/50' />
      )}
      <div
        className={cn(
          'inline-flex items-center min-w-0 font-medium',
          isSystemVar && 'text-gray-500',
          isEnvVar && 'text-violet-600',
          isNodeVar && 'text-green-500',
          !isValid && 'text-destructive',
          'group-aria-selected/var:text-white'
        )}>
        {renderPath()}
      </div>
      {!isValid && (
        <AlertTriangle className='ml-0.5 size-3 text-destructive group-aria-selected/var:text-white/90' />
      )}
    </div>
  )

  // Invalid variable — show error tooltip
  if (!isValid) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{tag}</TooltipTrigger>
          <TooltipContent>
            <p>{errorMessage}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Valid variable — show path info on hover
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{tag}</TooltipTrigger>
        <TooltipContent side='bottom' className='text-xs'>
          {nodeTitle && <span className='text-muted-foreground'>{nodeTitle} &middot; </span>}
          {variableName}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default VariableTag

// apps/web/src/components/workflow/nodes/components/variable-tag.tsx

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Globe, Settings } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo } from 'react'
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

// apps/web/src/components/workflow/ui/variables/line3-icon.tsx

/**
 * Line3Icon
 * SVG icon representing a diagonal line, used as a divider in variable tags.
 */
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

type VariableTagProps = {
  variableId: string // Variable ID to fetch from store
  nodeId?: string // Node ID to calculate upstream variables for validation
  isShort?: boolean
  selected?: boolean // Optional prop to indicate if the tag is selected
}

const VariableTag = ({
  variableId,
  nodeId,
  isShort = true,
  selected = false,
}: VariableTagProps) => {
  // Fetch variable from store using the proper hook
  // Pass nodeId to verify variable is available upstream
  const { variable, isValid, isSystemVar, isEnvVar, isNodeVar } = useVariable(variableId, nodeId)
  // Extract node ID from variable ID using helper
  const variableNodeId = useMemo(
    () => (variable ? getNodeIdFromVariableId(variable.id) : undefined),
    [variable]
  )

  // Get the node title for node variables
  const nodeTitle = useNodeTitle(isNodeVar ? variableNodeId : undefined)
  const typeIcon = (
    <VarTypeIcon type={variable?.type ?? BaseType.STRING} className='mr-0.5 size-3.5 shrink-0' />
  )
  const varTypeTitle = getVarTypeName(variable?.type ?? BaseType.STRING)

  // Get the display name for the variable using helper functions
  const variableName = useMemo(() => {
    if (!variable) return ''
    // For system variables, show the full ID (e.g., "sys.userId")
    if (isSystemVar) return variable.id
    // For env variables, show the path (e.g., "API_KEY")
    if (isEnvVar) return getPathFromVariableId(variable.id)
    // For node variables, build a label-based path (e.g., "Contact.first_name" instead of "cm1abc.first_name")
    const resolveVar = useVarStore.getState().actions.getVariableById
    return buildVariableLabelPath(variable.id, resolveVar) || getPathFromVariableId(variable.id)
  }, [variable, isSystemVar, isEnvVar])

  // Calculate error message for invalid variables
  const errorMessage = useMemo(() => {
    if (!variable) {
      return 'Variable not found'
    }

    // For node variables without a nodeId context
    if (isNodeVar && !nodeId) {
      return 'Cannot validate variable - no context node'
    }

    // If we have a valid variable from store but upstream check fails
    // if (
    //   isNodeVar &&
    //   variableNodeId &&
    //   upstreamNodeIds &&
    //   !upstreamNodeIds.has(variableNodeId)
    // ) {
    //   return 'Node is not connected (upstream)'
    // }

    // If variable doesn't have a nodeId in its ID
    if (isNodeVar && !variableNodeId) {
      return 'Variable missing source node information'
    }

    return 'Invalid variable reference'
  }, [variable, isNodeVar, nodeId, variableNodeId])

  const renderContent = useCallback(
    (withMaxWidth: boolean = true) => (
      <div
        className={cn(
          'inline-flex shrink-0 h-5 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-xs shadow-xs cursor-pointer',
          !isValid && 'border-destructive bg-destructive/10',
          // Use group-aria-selected to style based on parent's aria-selected state
          'group-aria-selected/var:border-transparent group-aria-selected/var:bg-info group-aria-selected/var:text-background group-aria-selected/var:ring-0 group-aria-selected/var:ring-info/90',
          isEnvVar && 'group-aria-selected/var:bg-violet-500',
          isSystemVar && 'group-aria-selected/var:bg-gray-500',
          !isValid && 'group-aria-selected/var:bg-destructive' // Override selected color for invalid vars
        )}
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && isNodeVar) {
            e.stopPropagation()
            // handleVariableJump()
          }
        }}>
        {isNodeVar && (
          <>
            {nodeTitle && (
              <>
                <div
                  className={cn(
                    'truncate shrink-0 font-medium text-muted-foreground group-aria-selected/var:text-white/90',
                    withMaxWidth && 'max-w-[50px]'
                  )}
                  title={nodeTitle}>
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
            'truncate font-medium ',
            isSystemVar && 'text-gray-500',
            isEnvVar && 'text-violet-600',
            isNodeVar && 'text-green-500',
            !isValid && 'text-destructive',
            'group-aria-selected/var:text-white'
          )}
          title={variableName}>
          {variableName}
        </div>

        {!isValid && (
          <AlertTriangle className='ml-0.5 size-3 text-destructive group-aria-selected/var:text-white/90' />
        )}
      </div>
    ),
    [isValid, isEnvVar, isSystemVar, isNodeVar, nodeTitle, typeIcon, varTypeTitle, variableName]
  )

  const content = renderContent(true)

  // If variable not found in store, show error
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

  if (!isValid) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent>
            <p>{errorMessage}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className='group/variable relative'>
      <div className='flex justify-center'>{content}</div>
      <div className='flex opacity-0 group-hover/variable:opacity-100 pointer-events-none group-hover/variable:pointer-events-auto absolute top-0 left-0 z-[1000]'>
        {renderContent(false)}
      </div>
    </div>
  )
}

export default VariableTag

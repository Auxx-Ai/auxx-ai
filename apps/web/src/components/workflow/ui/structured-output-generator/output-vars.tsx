// apps/web/src/components/workflow/ui/structured-output-generator/output-vars.tsx
'use client'
import type { FC, ReactNode } from 'react'
import React, { useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'

type Props = {
  className?: string
  title?: string
  children: ReactNode
  operations?: ReactNode
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}

const OutputVars: FC<Props> = ({
  title,
  children,
  operations,
  collapsed = false,
  onCollapse,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(!collapsed)

  const handleToggle = (open: boolean) => {
    setIsOpen(open)
    onCollapse?.(!open)
  }

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle} className={cn('group', className)}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="flex items-center gap-1 hover:opacity-80">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
          <span className="text-sm font-medium text-gray-700">{title || 'Output Variables'}</span>
        </CollapsibleTrigger>
        {operations}
      </div>
      <CollapsibleContent>
        <div className="pl-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type VarItemProps = {
  name: string
  type: string
  description?: string
  subItems?: { name: string; type: string; description?: string; subItems?: any }[]
  isIndent?: boolean
  depth?: number
}

export const VarItem: FC<VarItemProps> = ({ name, type, description, subItems, isIndent }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasSubItems = subItems && subItems.length > 0

  return (
    <div className={cn('flex', isIndent && 'relative left-[-7px]')}>
      {isIndent && <TreeIndentLine />}
      <div className=" w-full">
        <div className="flex items-center justify-between">
          <button
            onClick={() => hasSubItems && setIsExpanded(!isExpanded)}
            className={cn(
              'flex items-center -ms-2 px-2 leading-[18px] rounded-lg py-0.5',
              hasSubItems &&
                'hover:opacity-70 transition-opacity cursor-pointer hover:bg-primary-200'
            )}
            type="button"
            disabled={!hasSubItems}>
            <code className="text-sm font-mono font-semibold text-primary-500">{name}</code>
            <div className="flex items-center gap-1">
              <div className="text-xs font-normal ml-2 text-primary-400">{type}</div>
              {hasSubItems &&
                (isExpanded ? (
                  <ChevronDown className="size-3 text-gray-500" />
                ) : (
                  <ChevronRight className="size-3 text-gray-500" />
                ))}
            </div>
          </button>
        </div>
        {description && (
          <div className="text-xs font-normal mt-0.5 text-primary-400">{description}</div>
        )}
        {hasSubItems && isExpanded && (
          <div className="ml-3 mt-0">
            {subItems.map((item, index) => (
              <VarItem
                key={index}
                name={item.name}
                type={item.type}
                description={item.description}
                subItems={item.subItems}
                isIndent
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type TreeIndentLineProps = { className?: string }

const TreeIndentLine: FC<TreeIndentLineProps> = ({ className }) => {
  // const depthArray = Array.from({ length: depth }, (_, index) => index)
  return (
    <div className={cn('flex', className)}>
      {/* {depthArray.map((d) => ( */}
      <div className={cn('shrink-0 ml-0 mr-3 w-px bg-primary-300')} />
      {/* ))} */}
    </div>
  )
}

export default React.memo(OutputVars)

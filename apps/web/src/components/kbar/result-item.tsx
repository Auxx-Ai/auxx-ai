// ResultItem.tsx

// import * as React from "react";
import { EntityIcon } from '@auxx/ui/components/icons'
import type { ActionId, ActionImpl } from 'kbar'
import { motion } from 'motion/react'
import React, { useMemo } from 'react'

type Prop = {
  action: ActionImpl
  active: boolean
  currentRootActionId: ActionId
} & React.RefAttributes<HTMLDivElement>
const ResultItem: React.FC<Prop> = ({ action, active, currentRootActionId, ref }) => {
  const ancestors = useMemo(() => {
    if (!currentRootActionId) return action.ancestors
    const index = action.ancestors.findIndex((ancestor) => ancestor.id === currentRootActionId)
    return action.ancestors.slice(index + 1)
  }, [action.ancestors, currentRootActionId])

  return (
    <div
      ref={ref}
      className='relative mx-2 z-10 flex cursor-default select-none items-center justify-between px-2 py-1'>
      {active && (
        <motion.div
          layoutId='kbar-result-item'
          className='absolute inset-0 z-[-1]! rounded-full ring-1 ring-border-illustration bg-accent/50 dark:bg-[#404754]/50'
          transition={{ duration: 0.14, type: 'spring', ease: 'easeInOut' }}></motion.div>
      )}
      <div className='relative z-10 flex items-center gap-2'>
        {typeof action.icon === 'string' ? (
          <EntityIcon
            iconId={action.icon}
            color='gray'
            size='sm'
            inverse
            className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
          />
        ) : (
          action.icon && <span className='text-muted-foreground [&>svg]:size-4'>{action.icon}</span>
        )}
        <div className='flex flex-col text-sm text-foreground'>
          <div>
            {ancestors.length > 0 &&
              ancestors.map((ancestor) => (
                <React.Fragment key={ancestor.id}>
                  <span className='mr-2 opacity-50'>{ancestor.name}</span>
                  <span className='mr-2'>&rsaquo;</span>
                </React.Fragment>
              ))}
            <span>{action.name}</span>
          </div>
          {/* {action.subtitle && (
            <span className='text-sm text-muted-foreground'>{action.subtitle}</span>
          )} */}
        </div>
      </div>
      {action.shortcut?.length ? (
        <div className='relative z-10 grid grid-flow-col gap-1'>
          {action.shortcut.map((sc, i) => (
            <kbd
              key={i}
              // key={sc}
              className='flex items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-1.5 py-1 text-xs font-medium text-muted-foreground dark:border-[#323842]/80'>
              {sc}
            </kbd>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default ResultItem

// ResultItem.tsx

// import * as React from "react";
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
      className={`relative z-10 flex cursor-pointer items-center justify-between px-3 py-1`}>
      {active && (
        <motion.div
          layoutId='kbar-result-item'
          className='absolute inset-0 z-[-1]! border-l-4 border-neutral-500 bg-neutral-100 dark:border-white dark:bg-gray-700'
          transition={{ duration: 0.14, type: 'spring', ease: 'easeInOut' }}></motion.div>
      )}
      <div className='relative z-10 flex items-center gap-2'>
        <span className='text-neutral-500 [&>svg]:size-5'>{action.icon && action.icon}</span>
        <div className='flex flex-col text-sm text-neutral-600'>
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
          {action.subtitle && (
            <span className='text-sm text-neutral-400 dark:text-gray-400'>{action.subtitle}</span>
          )}
        </div>
      </div>
      {action.shortcut?.length ? (
        <div className='relative z-10 grid grid-flow-col gap-1'>
          {action.shortcut.map((sc, i) => (
            <kbd
              key={i}
              // key={sc}
              className='flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'>
              {sc}
            </kbd>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default ResultItem

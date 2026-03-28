// apps/web/src/components/workflow/ui/getting-started-overlay.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { isMac } from '@auxx/utils'
import type { ReactFlowState } from '@xyflow/react'
import { useStore } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { memo, useState } from 'react'
import { useTriggerDefinitions } from '~/components/workflow/hooks'
import { AddNodeTrigger } from './add-node-trigger'

const hasNodesSelector = (state: ReactFlowState) => state.nodes.length > 0

interface GettingStartedOverlayProps {
  open: boolean
  onClose: () => void
}

const mod = isMac() ? 'cmd' : 'ctrl'

const SHORTCUTS = [
  { keys: [mod, 'S'], label: 'Save' },
  { keys: [mod, 'enter'], label: 'Test run' },
  { keys: [mod, 'Z'], label: 'Undo' },
  { keys: ['N'], label: 'Add block' },
  { keys: ['V'], label: 'Pan / Select' },
  { keys: ['Space'], label: 'Hold to pan' },
  { keys: ['F'], label: 'Fit view' },
  { keys: ['T'], label: 'Test panel' },
  { keys: ['E'], label: 'Env variables' },
  { keys: ['H'], label: 'Run history' },
  { keys: ['D'], label: 'Disable node' },
  { keys: ['K'], label: 'Collapse node' },
  { keys: ['Del'], label: 'Delete selected' },
  { keys: [mod, 'A'], label: 'Select all' },
  { keys: [mod, 'C'], label: 'Copy' },
  { keys: [mod, 'V'], label: 'Paste' },
] as const

const SPECIAL_KEYS = new Set(['cmd', 'ctrl', 'enter', 'alt', 'esc', 'option', 'command'])

function ShortcutRow({ keys, label }: { keys: readonly string[]; label: string }) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <KbdGroup variant='outline' size='sm'>
        {keys.map((key) => (
          <Kbd
            key={key}
            {...(SPECIAL_KEYS.has(key) ? { shortcut: key as any } : { children: key })}
          />
        ))}
      </KbdGroup>
      <span className='text-muted-foreground text-xs'>{label}</span>
    </div>
  )
}

/**
 * Getting started overlay shown on empty canvas or via Help button.
 * Auto-shows when no trigger exists. Manually toggled via Help button or ? shortcut.
 */
export const GettingStartedOverlay = memo(function GettingStartedOverlay({
  open,
  onClose,
}: GettingStartedOverlayProps) {
  const hasNodes = useStore(hasNodesSelector)
  const triggerTypes = useTriggerDefinitions().map((d) => d.id)
  const [triggerOpen, setTriggerOpen] = useState(false)

  // Auto mode: no nodes yet. Manual mode: help button toggled.
  const shouldShow = open || !hasNodes

  if (!shouldShow) return null

  return (
    <div
      className='absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/20 dark:bg-black/40'
      onClick={(e) => {
        if (e.target === e.currentTarget && hasNodes) onClose()
      }}>
      <div
        className='bg-background/90 backdrop-blur-md border rounded-xl shadow-lg max-w-[720px] w-full mx-4 p-6'
        onClick={(e) => e.stopPropagation()}>
        <h2 className='text-sm font-medium mb-4'>Getting Started</h2>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          {/* Quick Start */}
          <div className='space-y-3'>
            <h3 className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
              Quick Start
            </h3>
            <ol className='space-y-2.5 text-sm'>
              <li className='flex gap-2'>
                <span className='text-muted-foreground font-medium shrink-0'>1.</span>
                <div>
                  <span className='font-medium'>Add a trigger</span>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    Choose what starts your workflow (e.g. new ticket, scheduled)
                  </p>
                </div>
              </li>
              <li className='flex gap-2'>
                <span className='text-muted-foreground font-medium shrink-0'>2.</span>
                <div>
                  <span className='font-medium'>Add blocks</span>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    Press{' '}
                    <Kbd variant='outline' size='sm'>
                      N
                    </Kbd>{' '}
                    or right-click the canvas to add processing steps
                  </p>
                </div>
              </li>
              <li className='flex gap-2'>
                <span className='text-muted-foreground font-medium shrink-0'>3.</span>
                <div>
                  <span className='font-medium'>Connect nodes</span>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    Drag from a node's output handle to another node's input
                  </p>
                </div>
              </li>
              <li className='flex gap-2'>
                <span className='text-muted-foreground font-medium shrink-0'>4.</span>
                <div>
                  <span className='font-medium'>Test your workflow</span>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    Press{' '}
                    <Kbd variant='outline' size='sm'>
                      T
                    </Kbd>{' '}
                    to open the test panel
                  </p>
                </div>
              </li>
            </ol>

            {!hasNodes && (
              <div className='pt-2 relative'>
                <div className='absolute inset-x-0 bottom-0 opacity-50 blur-md transition-all duration-300 dark:opacity-35'>
                  <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 bottom-5 h-3 from-pink-400 to-purple-400 rounded-xl' />
                </div>
                <div className='bg-card/75 ring-border-illustration shadow-black/6.5 relative overflow-hidden rounded-xl shadow-md ring-1 p-3'>
                  <AddNodeTrigger
                    position='standalone'
                    allowedNodeTypes={triggerTypes}
                    open={triggerOpen}
                    onOpenChange={setTriggerOpen}
                    onNodeAdded={() => setTriggerOpen(false)}>
                    <Button variant='default' size='xs' className='w-full'>
                      <Plus />
                      Add Trigger
                    </Button>
                  </AddNodeTrigger>
                </div>
                <p className='text-xs text-muted-foreground mt-2 text-center relative'>
                  Click to add your first trigger
                </p>
              </div>
            )}
          </div>

          {/* Keyboard Shortcuts */}
          <div className='space-y-3'>
            <h3 className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
              Shortcuts
            </h3>
            <div className='space-y-1.5'>
              {SHORTCUTS.map((s) => (
                <ShortcutRow key={s.label} keys={s.keys} label={s.label} />
              ))}
            </div>
          </div>

          {/* Variable Tips */}
          <div className='space-y-3'>
            <h3 className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
              Variable Tips
            </h3>
            <div className='space-y-2 text-xs text-muted-foreground'>
              <p>
                Type{' '}
                <code className='text-foreground font-mono bg-muted px-1 rounded'>{'{{ }}'}</code>{' '}
                in text fields to insert variables from previous nodes.
              </p>
              <p>
                <span className='font-medium text-foreground'>Array variables:</span> Right-click a
                variable tag to pick an item — first, last, all, or by index.
              </p>
              <p>Each node's output is available as variables in downstream nodes.</p>
              <p>
                <span className='font-medium text-foreground'>Right-click nodes</span> to access
                options like change block type, disable, or collapse.
              </p>
            </div>
          </div>
        </div>

        <div className='flex justify-end mt-4'>
          <p className='text-xs text-muted-foreground'>
            Press{' '}
            <Kbd variant='outline' size='sm'>
              ?
            </Kbd>{' '}
            or <Kbd variant='outline' size='sm' shortcut='esc' /> to close
          </p>
        </div>
      </div>
    </div>
  )
})

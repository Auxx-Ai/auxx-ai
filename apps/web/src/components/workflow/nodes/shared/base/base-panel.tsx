// apps/web/src/components/workflow/nodes/shared/base/base-panel.tsx

import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Button } from '@auxx/ui/components/button'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import {
  Cog,
  Copy,
  Medal,
  MoreHorizontal,
  Pin,
  PinOff,
  Power,
  PowerOff,
  RefreshCw,
  Settings2,
  Target,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import React, {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppSettingsDialog } from '~/components/apps/app-settings-dialog'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
// Hooks
import {
  useNodeAddition,
  useNodeCrud,
  useNodesInteractions,
  useNonTriggerDefinitions,
  useReadOnly,
  useRunSingleNode,
  useTitleValidation,
} from '~/components/workflow/hooks'
// Store imports
import { usePanelStore } from '~/components/workflow/store/panel-store'
// types
import { NodeType } from '~/components/workflow/types'
import { AppIcon } from '~/components/workflow/ui/app-icon'
import { BlockSelector } from '~/components/workflow/ui/block-selector'
import CollapseWrap from '~/components/workflow/ui/collapse-wrap'
import NextStep from '~/components/workflow/ui/next-step'
// Specific UI imports
import { ReplaceTrigger } from '~/components/workflow/ui/replace-trigger'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { unifiedNodeRegistry } from '../../unified-registry'
import { SingleRunInputTab } from '../single-run-input-tab'
import { SingleRunResultTab } from '../single-run-result-tab'

interface BasePanelProps {
  title?: string
  nodeId: string
  children: ReactNode
  showNextStep?: boolean
  data?: any
  /** App context for the "App Settings" button — only set for app workflow nodes */
  appContext?: {
    appId: string
    appSlug: string
    installationId: string
    installationType: 'development' | 'production'
    appName: string
  }
}

/**
 * Component to display keyboard shortcuts alongside menu items
 */
const KeyboardShortcut = ({ shortcut }: { shortcut: string }) => (
  <span className='ml-auto pl-2 text-xs text-muted-foreground'>{shortcut}</span>
)

function AppSettingsTrigger({
  appId,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button> & {
  appId: string
}) {
  const { appInstallations, appConnections } = useExtensionsContext()

  const installation = appInstallations.find((i) => i.app.id === appId)
  const hasConnectionDef = !!installation?.connectionDefinition

  const connection = appConnections.find((c) => c.appId === appId)
  const status = connection?.connectionStatus ?? 'not_connected'

  const dotColor = !hasConnectionDef
    ? null
    : status === 'connected'
      ? 'bg-green-500'
      : status === 'expired'
        ? 'bg-amber-400'
        : 'bg-red-500'

  return (
    <div className='relative'>
      <Button variant='ghost' size='xs' {...props}>
        <Settings2 /> App Settings
      </Button>
      {dotColor && (
        <span
          className={`absolute top-0 right-0 size-2 rounded-full ${dotColor} ring-1 ring-background`}
        />
      )}
    </div>
  )
}

/**
 * Base panel component that provides common structure for node nodeDatauration panels
 * Restored to match original functionality with title, desc, and showNextStep
 */
export const BasePanel = memo<BasePanelProps>(
  ({ title, nodeId, children, data, showNextStep = true, appContext }) => {
    const { inputs: nodeData, setInputs } = useNodeCrud(nodeId, data)
    // Debounce setInputs to prevent double renders (local state + nodeData update)
    const debouncedSetInputs = useDebouncedCallback(setInputs, 300)

    const closePanel = usePanelStore((state) => state.closePanel)
    const isPinned = usePanelStore((state) => state.isPinned)
    const togglePinned = usePanelStore((state) => state.togglePinned)

    // Use panel store for tab management
    const activeTab = usePanelStore((state) => state.basePanelActiveTab)
    const setActiveTab = usePanelStore((state) => state.setBasePanelTab)

    const { isReadOnly } = useReadOnly()
    const pathname = usePathname()
    const nodeType = data.type

    // Get all non-trigger definitions for node replacement
    const nonTriggerDefinitions = useNonTriggerDefinitions()

    // Filter available node types for replacement (exclude current type and END node)
    const availableNodeTypes = useMemo(() => {
      return nonTriggerDefinitions
        .filter((def) => def.id !== nodeType && def.id !== NodeType.END)
        .map((def) => def.id)
    }, [nonTriggerDefinitions, nodeType])

    // Node addition hook for replacing nodes
    const { addNode } = useNodeAddition()

    // Node interaction handlers
    const { handleCopyNode, handleDeleteNode, handleCenterOnNode, handleSelectAll } =
      useNodesInteractions()

    const isMountedRef = useRef(true)

    // Use enhanced hook with simplified interface
    const { runWithDefaults } = useRunSingleNode(nodeId)

    // Use title validation hook
    const { titleError, validateTitle } = useTitleValidation(nodeId)

    // Local state for title editing to prevent saving invalid titles
    const [localTitle, setLocalTitle] = useState(nodeData?.title || title || '')
    const [localDesc, setLocalDesc] = useState(nodeData?.desc || '')
    const [isDescCollapsed, setIsDescCollapsed] = useState(true)

    // Ensure mounted ref is true when component is active
    useEffect(() => {
      isMountedRef.current = true
      return () => {
        isMountedRef.current = false
      }
    }, []) // Reset when nodeId changes

    // Update local state when nodeData changes (e.g., from external updates)
    useEffect(() => {
      setLocalTitle(nodeData?.title || title || '')
      setLocalDesc(nodeData?.desc || '')
    }, [nodeData?.title, nodeData?.desc, title])

    // Get node icon and color from registry
    const nodeDefinition = unifiedNodeRegistry.getDefinition(nodeType)
    const nodeIconName = unifiedNodeRegistry.getNodeIconName(nodeType, nodeData)
    const nodeColor = unifiedNodeRegistry.getColor(nodeType)
    const isTrigger = unifiedNodeRegistry.isTrigger(nodeType)

    // onChange handler - update local state and validate
    const handleTitleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isReadOnly) return
        const newTitle = e.target.value

        // Update local state
        setLocalTitle(newTitle)

        // Validate title while typing
        const isValid = validateTitle(newTitle)

        // Only update node data if title is valid (debounced to prevent double renders)
        if (isValid && newTitle.trim()) {
          debouncedSetInputs({ ...nodeData, title: newTitle })
        }
      },
      [isReadOnly, validateTitle, nodeData, debouncedSetInputs]
    )

    const handleDescChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (isReadOnly) return
        const newDesc = e.target.value

        // Update local state
        setLocalDesc(newDesc)

        // Update node data (debounced to prevent double renders)
        debouncedSetInputs({ ...nodeData, desc: newDesc })
      },
      [isReadOnly, nodeData, debouncedSetInputs]
    )

    // onBlur handler - validate and revert if invalid
    const handleTitleBlur = useCallback(() => {
      if (isReadOnly || !isMountedRef.current) return

      // If title is invalid or empty, revert to the last valid title
      if (titleError || !localTitle.trim()) {
        const validTitle = nodeData?.title || title || ''
        setLocalTitle(validTitle)
        validateTitle(validTitle)
      }
    }, [isReadOnly, nodeData?.title, title, localTitle, titleError, validateTitle])

    // Description doesn't need blur handler since there's no validation
    const handleDescBlur = useCallback(() => {
      // No-op - description is updated on change
    }, [])

    // Handle Enter key to trigger blur for better UX
    const handleTitleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          // Revert changes on Escape
          const validTitle = nodeData?.title || title || ''
          setLocalTitle(validTitle)
          validateTitle(validTitle)
          e.currentTarget.blur()
        }
      },
      [nodeData?.title, title, validateTitle]
    )

    const handleDescKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
          // Revert changes on Escape
          const originalDesc = nodeData?.desc || ''
          setLocalDesc(originalDesc)
          setInputs({ ...nodeData, desc: originalDesc })
          e.currentTarget.blur()
        }
      },
      [nodeData?.desc, nodeData, setInputs]
    )

    // Callback to store inferred output schema on node data
    const handleApplySchema = useCallback(
      (schema: SchemaRoot) => {
        setInputs({
          ...nodeData,
          inferredSchema: schema,
        })
      },
      [setInputs, nodeData]
    )

    // Ultra-simple run handler that delegates everything
    const handleRun = useCallback(() => {
      if (isReadOnly || !nodeType || !data || !nodeDefinition) return
      // Switch to result tab immediately to show loading spinner
      setActiveTab('result')
      runWithDefaults(data, nodeDefinition)
    }, [isReadOnly, nodeType, data, nodeDefinition, runWithDefaults, setActiveTab])

    const pinSidebar = useCallback(() => {
      togglePinned()
    }, [togglePinned])

    // Handler for when a block is selected from the selector
    const handleBlockSelect = useCallback(
      async (selectedNodeType: string, config?: any) => {
        try {
          await addNode({
            nodeType: selectedNodeType,
            position: 'replace',
            replaceNodeId: nodeId,
            config,
          })
        } catch (error) {
          console.error('Failed to replace node:', error)
        }
      },
      [addNode, nodeId]
    )

    // Check if node type can be disabled
    const canBeDisabled = useMemo(() => {
      if (!nodeType) return false
      // Trigger and End nodes should not be disabled
      return nodeType !== NodeType.MESSAGE_RECEIVED && nodeType !== NodeType.END
    }, [nodeType])

    return (
      <div className='flex-1 h-full w-full flex flex-col [--sticky-offset:89px] overflow-y-auto'>
        <DrawerHeader
          icon={
            <AppIcon
              iconId={nodeIconName}
              className='size-6 text-white'
              style={{ backgroundColor: nodeColor }}
            />
          }
          title={
            <div className='relative flex-1'>
              <Input
                id='title'
                variant='transparent'
                value={localTitle}
                onChange={handleTitleChange}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                placeholder='Enter node title'
                tabIndex={-1}
                className={cn(
                  'mr-2 h-7 min-w-0 w-full appearance-none rounded-md border focus-visible:ring-1 focus-visible:ring-blue-500 px-1 outline-none',
                  titleError ? 'border-red-500 ring-1 ring-red-500' : 'border-transparent',
                  'focus:shadow-xs'
                )}
              />
              {titleError && (
                <div className='absolute top-full left-0 mt-1 text-xs text-red-500 z-20'>
                  {titleError === 'empty' && 'Title cannot be empty'}
                  {titleError === 'duplicate' && 'Title must be unique'}
                  {titleError === 'contains-dot' && 'Title cannot contain dots'}
                </div>
              )}
            </div>
          }
          onClose={() => {
            handleSelectAll(false)
            closePanel()
          }}
          actions={
            <>
              <Tooltip content='Center viewport on this node'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-full'
                  onClick={() => handleCenterOnNode(nodeId)}
                  tabIndex={-1}>
                  <Target />
                </Button>
              </Tooltip>
              <Tooltip content={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-full'
                  onClick={pinSidebar}
                  tabIndex={-1}>
                  {isPinned ? <PinOff /> : <Pin />}
                </Button>
              </Tooltip>
              <DockToggleButton size='icon-sm' />

              {!isReadOnly && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon-sm' className='rounded-full' tabIndex={-1}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    {!isTrigger && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <RefreshCw />
                          Change Block
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className='p-0 w-[220px]'>
                          <BlockSelector
                            inline={true}
                            open={true}
                            onOpenChange={() => {}}
                            onSelect={handleBlockSelect}
                            availableBlocksTypes={availableNodeTypes}
                          />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem onClick={() => handleCopyNode(nodeId)}>
                      <Copy />
                      Copy
                      <KeyboardShortcut shortcut='⌘C' />
                    </DropdownMenuItem>
                    {canBeDisabled && (
                      <DropdownMenuItem
                        onClick={() => {
                          // useNodeStore.getState().toggleNodeDisabled(nodeId)
                        }}>
                        {data?.disabled ? (
                          <>
                            <Power />
                            Enable Node
                          </>
                        ) : (
                          <>
                            <PowerOff />
                            Disable Node
                          </>
                        )}
                        <KeyboardShortcut shortcut='D' />
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => handleDeleteNode(nodeId)}
                      variant='destructive'>
                      <Trash2 />
                      Delete
                      <KeyboardShortcut shortcut='Del' />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          }>
          {/* Description area */}
          <CollapseWrap
            minHeight={60}
            isCollapsed={isDescCollapsed}
            onCollapsedChange={setIsDescCollapsed}>
            <div className='leading-0 group flex rounded-lg px-2 py-[5px]'>
              <AutosizeTextarea
                id='desc'
                minHeight={1}
                value={localDesc}
                onChange={handleDescChange}
                onFocus={() => setIsDescCollapsed(false)}
                onBlur={() => {
                  handleDescBlur()
                  setIsDescCollapsed(true)
                }}
                onKeyDown={handleDescKeyDown}
                className='w-full bg-transparent dark:bg-transparent border-none resize-none appearance-none text-xs leading-[18px] caret-[#295EFF] outline-none'
                placeholder='Enter node description'
              />
            </div>
          </CollapseWrap>
        </DrawerHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab} className='flex-1 flex flex-col '>
          <div className='w-full border-b flex flex-col flex-1'>
            <TabsList
              variant='outline'
              className='sticky top-[var(--sticky-offset)] z-9 bg-background/60 backdrop-blur-sm'>
              <TabsTrigger value='settings' variant='outline' size='sm'>
                <Cog />
                Settings
              </TabsTrigger>
              {nodeDefinition?.canRunSingle && (
                <>
                  {!isReadOnly && (
                    <TabsTrigger value='input' variant='outline' size='sm'>
                      <TextCursorInput />
                      Input
                    </TabsTrigger>
                  )}
                  <TabsTrigger value='result' variant='outline' size='sm'>
                    <Medal />
                    Result
                  </TabsTrigger>
                </>
              )}
              {appContext && (
                <div className='ml-auto'>
                  <AppSettingsDialog
                    appSlug={appContext.appSlug}
                    installationType={appContext.installationType}
                    returnTo={pathname}
                    trigger={<AppSettingsTrigger appId={appContext.appId} />}
                  />
                </div>
              )}
            </TabsList>
            <TabsContent value='settings' className='flex-1 flex flex-col mt-0'>
              <div className='flex-1 flex-col flex'>
                <div className='flex-1 flex flex-col'>{children}</div>

                {/* Next Step Section */}
                {showNextStep && data && (
                  <>
                    {isTrigger && <ReplaceTrigger nodeId={nodeId} nodeType={nodeType} />}
                    <div className='border-t bg-background sticky bottom-0 z-10 max-h-[211px] overflow-y-auto'>
                      <div className='p-3'>
                        <div className='mb-2 text-xs font-semibold uppercase text-muted-foreground'>
                          Next Steps
                        </div>
                        <NextStep data={data} nodeId={nodeId} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
            {nodeDefinition?.canRunSingle && (
              <>
                {!isReadOnly && (
                  <TabsContent value='input' className='flex-1 flex flex-col p-0 mt-0'>
                    <SingleRunInputTab nodeId={nodeId} data={data} onRun={handleRun} />
                  </TabsContent>
                )}
                <TabsContent value='result' className='flex-1 flex flex-col p-0 mt-0'>
                  <SingleRunResultTab
                    nodeId={nodeId}
                    onRun={handleRun}
                    onApplySchema={handleApplySchema}
                    inferredSchema={nodeData?.inferredSchema}
                  />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </div>
    )
  }
)

BasePanel.displayName = 'BasePanel'

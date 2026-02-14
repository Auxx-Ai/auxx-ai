// apps/web/src/components/workflow/ui/workflow-versions-popover.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useReactFlow } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import React from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { WorkflowVersionItem } from './workflow-version-item'

interface WorkflowVersionsPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

/**
 * Popover component for managing workflow versions
 * Allows users to view, select, rename, restore, and delete workflow versions
 */
const WorkflowVersionsPopover: React.FC<WorkflowVersionsPopoverProps> = ({
  open,
  onOpenChange,
  workflowId,
}) => {
  const [confirm, ConfirmDialog] = useConfirm()
  const [searchQuery, setSearchQuery] = React.useState('')

  // Store state
  // const showVersions = useCanvasStore((state) => state.showVersions)
  const selectedVersion = useCanvasStore((state) => state.selectedVersion)
  const readOnly = useCanvasStore((state) => state.readOnly)
  const selectVersion = useCanvasStore((state) => state.selectVersion)
  const setReadOnly = useCanvasStore((state) => state.setReadOnly)
  const setVersionPreviewData = useCanvasStore((state) => state.setVersionPreviewData)

  // console.log('Rendering WorkflowVersionsPopover', {
  //   open,
  //   workflowId,
  //   showVersions,
  //   versionsQueryEnabled: open && !!workflowId,
  // })

  const workflow = useWorkflowStore((state) => state.workflow)
  const isDirty = useWorkflowStore((state) => state.isDirty)

  // ReactFlow hooks for node and edge management
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow()
  const nodes = getNodes()
  const edges = getEdges()

  // State for preserving original draft data
  const [originalDraftData, setOriginalDraftData] = React.useState<{
    nodes: any[]
    edges: any[]
    viewport: any
  } | null>(null)

  // API queries and mutations
  const {
    data: versions = [],
    refetch: refetchVersions,
    error: versionsError,
  } = api.workflow.getVersions.useQuery({ workflowId }, { enabled: open && !!workflowId })

  const getVersionById = api.workflow.getVersionById.useQuery(
    { workflowId, versionId: selectedVersion! },
    { enabled: !!selectedVersion && selectedVersion !== 'current-draft' }
  )

  // Get API utils for manual queries in restore function
  const apiUtils = api.useUtils()

  const deleteVersionMutation = api.workflow.deleteVersion.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Version deleted',
        description: 'The workflow version has been deleted successfully.',
      })
      refetchVersions()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting version', description: error.message })
    },
  })

  const renameVersionMutation = api.workflow.renameVersion.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Version renamed',
        description: 'The workflow version has been renamed successfully.',
      })
      refetchVersions()
    },
    onError: (error) => {
      toastError({ title: 'Error renaming version', description: error.message })
    },
  })

  // Filter versions based on search query
  const filteredVersions = React.useMemo(() => {
    if (!searchQuery) return versions
    return versions.filter((version) =>
      version.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [versions, searchQuery])

  // Format date for display
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(date))
  }

  // Handle version selection
  const handleVersionSelect = async (versionId: string) => {
    // Find the version to check if it's a draft
    const selectedVersionData = versions.find((v) => v.id === versionId)
    const isDraftVersion = selectedVersionData?.isDraft || false

    if (isDraftVersion) {
      // Return to current draft (stay in edit mode)
      if (originalDraftData) {
        // Defer canvas updates to avoid React hook issues
        queueMicrotask(() => {
          // Restore original draft data
          setNodes(originalDraftData.nodes)
          setEdges(originalDraftData.edges)
          // TODO: Restore viewport
        })
        setOriginalDraftData(null)
      }
      selectVersion(null)
      setReadOnly(false)
      setVersionPreviewData(null)
    } else {
      // Save current draft data if not already saved
      if (!originalDraftData && !readOnly) {
        setOriginalDraftData({
          nodes: [...nodes],
          edges: [...edges],
          viewport: {}, // TODO: Get current viewport
        })
      }

      // Load version preview (read-only mode)
      try {
        selectVersion(versionId)
        setReadOnly(true)

        // The version data will be loaded via the query and useEffect
      } catch (error) {
        toastError({
          title: 'Error loading version',
          description: 'Failed to load the selected version.',
        })
        selectVersion(null)
        setReadOnly(false)
      }
    }
  }

  // Handle version deletion
  const handleDeleteVersion = async (versionId: string, versionTitle: string) => {
    const confirmed = await confirm({
      title: 'Delete Version?',
      description: `Are you sure you want to delete "${versionTitle}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteVersionMutation.mutate({ workflowId, versionId })
    }
  }

  // Handle version restoration
  const handleRestoreVersion = async (versionId: string, versionTitle: string) => {
    const confirmed = await confirm({
      title: 'Restore Version?',
      description: `Are you sure you want to restore "${versionTitle}"? ${
        isDirty
          ? 'Your current unsaved changes will be lost.'
          : 'This will replace your current workflow.'
      }`,
      confirmText: 'Restore',
      cancelText: 'Cancel',
      destructive: isDirty,
    })

    if (confirmed) {
      try {
        // Get the version data
        const versionData = await apiUtils.workflow.getVersionById.fetch({ workflowId, versionId })

        if (versionData?.graph) {
          const graph = versionData.graph as any

          // Defer canvas updates to avoid React hook issues
          queueMicrotask(() => {
            // Clear current canvas and load version data
            if (graph.nodes && Array.isArray(graph.nodes)) {
              setNodes(graph.nodes)
            } else {
              setNodes([])
            }

            if (graph.edges && Array.isArray(graph.edges)) {
              setEdges(graph.edges)
            } else {
              setEdges([])
            }
          })

          // Exit read-only mode
          selectVersion(null)
          setReadOnly(false)
          setVersionPreviewData(null)
          setOriginalDraftData(null)

          toastSuccess({
            title: 'Version restored',
            description: `"${versionTitle}" has been restored as the current workflow.`,
          })
        }
      } catch (error) {
        console.error('Error restoring version:', error)
        toastError({
          title: 'Error restoring version',
          description: 'Failed to restore the selected version.',
        })
      }
    }
  }

  // Handle version rename
  const handleRenameVersion = React.useCallback(
    (versionId: string, newTitle: string) => {
      renameVersionMutation.mutate({ workflowId, versionId, title: newTitle })
    },
    [workflowId, renameVersionMutation]
  )

  // Load version data when selectedVersion changes
  React.useEffect(() => {
    if (getVersionById.data && selectedVersion) {
      console.log('Loading version data for')

      // Set version preview data for UI
      setVersionPreviewData({
        id: getVersionById.data.id,
        title: getVersionById.data.title || `Version ${getVersionById.data.version}`,
        version: getVersionById.data.version,
        createdAt: getVersionById.data.createdAt,
        isPublished: getVersionById.data.isPublished,
        isDraft: getVersionById.data.isDraft,
      })

      // Load version graph data into canvas
      if (getVersionById.data.graph) {
        try {
          const graph = getVersionById.data.graph as any

          // Defer canvas updates to avoid React hook issues
          queueMicrotask(() => {
            // Load version nodes and edges
            if (graph.nodes && Array.isArray(graph.nodes)) {
              setNodes(graph.nodes)
            } else {
              setNodes([])
            }

            if (graph.edges && Array.isArray(graph.edges)) {
              setEdges(graph.edges)
            } else {
              setEdges([])
            }

            // TODO: Load viewport if available
            // if (graph.viewport) {
            //   setViewport(graph.viewport)
            // }
          })
        } catch (error) {
          console.error('Error loading version graph data:', error)
          toastError({
            title: 'Error loading version',
            description: 'Failed to load version graph data.',
          })
        }
      }
    }
  }, [getVersionById.data, selectedVersion, setEdges, setNodes, setVersionPreviewData])

  // Early return if no workflow ID
  if (!workflowId) {
    return (
      <Tooltip content='Version History (Cmd+Shift+H)'>
        <Button
          variant='ghost'
          size='icon'
          disabled
          title='Save the workflow first to access version history'>
          <GitBranch />
        </Button>
      </Tooltip>
    )
  }
  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <div>
            <Tooltip content='Version History' shortcut='⌘⇧+H'>
              <Button variant={open ? 'secondary' : 'ghost'} size='icon-sm' data-selected={open}>
                <GitBranch />
              </Button>
            </Tooltip>
          </div>
        </PopoverTrigger>
        <PopoverContent
          className='w-80 p-0 bg-transparent backdrop-blur-sm border-primary-900/10'
          align='start'
          // onInteractOutside={(e) => {
          //   e.preventDefault()
          // }}
        >
          <Command className='bg-white/40 dark:bg-white/5'>
            <CommandInput
              placeholder='Search versions...'
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {versionsError ? (
                <div className='p-4 text-center text-destructive'>
                  <p className='text-sm'>Failed to load versions</p>
                  <p className='text-xs text-muted-foreground mt-1'>{versionsError.message}</p>
                </div>
              ) : (
                <>
                  <CommandEmpty>No versions found.</CommandEmpty>
                  <CommandGroup>
                    {/* Version Items */}
                    {filteredVersions.map((version) => (
                      <WorkflowVersionItem
                        key={version.id}
                        version={version}
                        isSelected={
                          version.isDraft
                            ? selectedVersion === null
                            : selectedVersion === version.id
                        }
                        onSelect={() => handleVersionSelect(version.id)}
                        onRename={handleRenameVersion}
                        onRestore={handleRestoreVersion}
                        onDelete={handleDeleteVersion}
                        formatDate={formatDate}
                        isDirty={isDirty}
                        workflowName={workflow?.name || 'Untitled Workflow'}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <ConfirmDialog />
    </>
  )
}

export default React.memo(WorkflowVersionsPopover)

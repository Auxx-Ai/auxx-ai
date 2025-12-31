// apps/web/src/components/workflow/nodes/ui/node-handle/hooks/use-node-interactions.ts

import { useCallback, useRef } from 'react'
import {
  useStoreApi,
  useReactFlow,
  getConnectedEdges,
  type Node,
  type Edge,
  type OnConnect,
  type OnConnectStart,
  type OnConnectEnd,
  type OnNodesChange,
} from '@xyflow/react'

import { produce } from 'immer'
import { uniqueBy } from '@auxx/lib/utils'
import {
  useSelectionActions,
  useWorkflowSave,
  useHelpline,
  useNodeValidation,
  useNodesReadOnly,
} from '~/components/workflow/hooks'
import { calculateZIndex } from '~/components/workflow/utils/edge-utils'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-save-to-history'
import type { HandleNodeAddParams, HandleConnectionParams } from '../ui/node-handle/types'
import { generateId } from '~/components/workflow/utils'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { toastSuccess, toastInfo, toastError } from '@auxx/ui/components/toast'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useVarStore } from '~/components/workflow/store/use-var-store'
import { generateUniqueTitle } from '~/components/workflow/utils/unique-title-generator'
import { centerOnNode } from '~/components/workflow/utils/viewport-utils'
import {
  LAYOUT_SPACING,
  type ResizeParamsWithDirection,
} from '~/components/workflow/utils/layout-constants'
import { NodeFactory } from '~/components/workflow/utils/node-layout'
import { storeEventBus } from '~/components/workflow/store/event-bus'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '~/components/workflow/utils'
import { NodeType } from '~/components/workflow/types/node-types'
import type { FlowNode } from '~/components/workflow/store/types'
// Variable syncing now handled automatically by VarStoreSyncProvider

// Type for node mouse event handlers
type NodeMouseHandler = (event: React.MouseEvent, node: Node) => void
type NodeDisableHandler = (nodes?: Node[], toggle?: boolean) => void

export const useNodesInteractions = () => {
  const store = useStoreApi()
  const reactFlow = useReactFlow()
  // Removed workflowStore = useWorkflowStore.getState() to avoid unstable reference
  // Call getState() directly in callbacks instead
  const { getNodesReadOnly } = useNodesReadOnly()
  const { debouncedSave } = useWorkflowSave()
  const { isValidConnection } = useNodeValidation()
  const { selectNode } = useSelectionActions()
  const closePanel = usePanelStore((state) => state.closePanel)
  const isPinned = usePanelStore((state) => state.isPinned)
  const { saveStateToHistory } = useWorkflowHistory()
  // const { handleNodeLoopChildDrag } = useLoopConfig()
  // Helpline functionality
  const { handleSetHelpline, handleClearHelpline } = useHelpline()

  // REMOVED: storeSyncCallbacks - using debouncedSave instead

  // Track drag start positions for multi-select
  const dragNodeStartPosition = useRef<{ x: number; y: number } | null>(null)
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map())

  const handleNodeAdd = useCallback(
    (params: HandleNodeAddParams, connectionParams: HandleConnectionParams) => {
      // Get current state from ReactFlow store
      const { nodes, setNodes, edges, setEdges } = store.getState()
      if (connectionParams.prevNodeId) {
        // Adding node after source
        const prevNode = nodes.find((n) => n.id === connectionParams.prevNodeId)
        if (prevNode) {
          // Create new node using NodeFactory
          const newNode = NodeFactory.createNode({
            nodeType: params.nodeType,
            position: { x: prevNode.position.x + 250, y: prevNode.position.y },
            existingNodes: nodes,
            data: params.toolDefaultValue,
            parentId: prevNode.parentId, // Inherit parent if adding inside loop
            parentNode: prevNode.parentId
              ? nodes.find((n) => n.id === prevNode.parentId)
              : undefined,
          })

          // Update node ID to use the consistent format
          const newNodeId = newNode.id

          // Update nodes in ReactFlow
          setNodes([...nodes, newNode])

          // Select the newly created node
          selectNode(newNodeId, false)

          // Create edge from previous node to new node
          if (connectionParams.prevNodeSourceHandle) {
            // All nodes now use 'target' handle consistently
            const targetHandle = 'target'

            const newEdge: Edge = {
              id: generateId('edge'),
              source: connectionParams.prevNodeId,
              sourceHandle: connectionParams.prevNodeSourceHandle,
              target: newNodeId,
              targetHandle: targetHandle,
              data: {
                sourceType: prevNode.data.type,
                targetType: params.nodeType,
                // Include loop metadata if prev node is in a loop
                isInLoop: prevNode.data?.isInLoop,
                loopId: prevNode.data?.loopId,
              },
            }
            // Calculate and set zIndex for edge
            newEdge.zIndex = calculateZIndex(newEdge, nodes)

            // Update edges in ReactFlow
            setEdges([...edges, newEdge])
          }

          // Sync and save to history
          debouncedSave()
          saveStateToHistory(WorkflowHistoryEvent.NodeAdd)
        }
      } else if (connectionParams.nextNodeId) {
        // Adding node before target
        const nextNode = nodes.find((n) => n.id === connectionParams.nextNodeId)
        if (nextNode) {
          // Create new node using NodeFactory
          const newNode = NodeFactory.createNode({
            nodeType: params.nodeType,
            position: { x: nextNode.position.x - 250, y: nextNode.position.y },
            existingNodes: nodes,
            data: params.toolDefaultValue,
            parentId: nextNode.parentId, // Inherit parent if adding inside loop
            parentNode: nextNode.parentId
              ? nodes.find((n) => n.id === nextNode.parentId)
              : undefined,
          })

          // Update node ID to use the consistent format
          const newNodeId = newNode.id

          // Update nodes in ReactFlow
          setNodes([...nodes, newNode])

          // Select the newly created node
          selectNode(newNodeId, false)

          // Create edge from new node to next node
          if (connectionParams.nextNodeTargetHandle) {
            const newEdge: Edge = {
              id: generateId('edge'),
              source: newNodeId,
              sourceHandle: 'source',
              target: connectionParams.nextNodeId,
              targetHandle: connectionParams.nextNodeTargetHandle,
              data: {
                sourceType: params.nodeType,
                targetType: nextNode.data.type,
                // Include loop metadata if next node is in a loop
                isInLoop: nextNode.data?.isInLoop,
                loopId: nextNode.data?.loopId,
              },
            }
            // Calculate and set zIndex for edge
            newEdge.zIndex = calculateZIndex(newEdge as FlowEdge, nodes as FlowNode[])

            // Update edges in ReactFlow
            setEdges([...edges, newEdge])
          }

          // Sync and save to history
          debouncedSave()
          saveStateToHistory(WorkflowHistoryEvent.NodeAdd)
        }
      }
    },
    [store, selectNode, debouncedSave, saveStateToHistory]
  )

  // Node action methods for dropdown menu

  const handleCopyNode = useCallback(
    (nodeId?: string) => {
      if (getNodesReadOnly()) return
      const { nodes } = store.getState()
      const { setClipboardElements } = useWorkflowStore.getState()
      // const nodes = reactFlow.getNodes() as unknown as FlowNode[]

      let nodesToCopy: FlowNode[] = []

      if (nodeId) {
        // If nodeId is provided, copy that specific node
        const nodeToCopy = nodes.find((node) => node.id === nodeId)
        if (nodeToCopy) {
          nodesToCopy = [nodeToCopy]
        }
      } else {
        // If no nodeId is provided, copy all selected nodes
        nodesToCopy = nodes.filter((node) => node.selected)
      }
      nodesToCopy = nodesToCopy.filter((node) => !unifiedNodeRegistry.isTrigger(node.data.type))

      if (nodesToCopy.length === 0) {
        toastInfo({ title: 'Nothing to copy', description: 'No nodes selected' })
        return
      }

      // Store in clipboard
      setClipboardElements(nodesToCopy)

      // Show success toast
      const nodeText = nodesToCopy.length === 1 ? 'node' : 'nodes'
      toastSuccess({
        title: 'Copied to clipboard',
        description: `${nodesToCopy.length} ${nodeText} copied`,
      })
    },
    [getNodesReadOnly, store]
  )

  const handleNodesPaste = useCallback(
    (mousePosition?: { x: number; y: number }) => {
      if (getNodesReadOnly()) return

      // Get current state from ReactFlow store
      const { nodes, setNodes, edges, setEdges } = store.getState()
      const { clipboardElements } = useWorkflowStore.getState()

      if (!clipboardElements || clipboardElements.length === 0) {
        toastInfo({ title: 'Nothing to paste', description: 'Clipboard is empty' })
        return
      }

      // Find the top-left position of clipboard elements
      let minX = Infinity
      let minY = Infinity
      clipboardElements.forEach((node) => {
        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
      })

      // Determine paste position
      let pastePosition = { x: 100, y: 100 } // Default position
      if (mousePosition) {
        // If mouse position provided, use it
        const { screenToFlowPosition } = reactFlow
        pastePosition = screenToFlowPosition(mousePosition)
      } else {
        // Otherwise, offset from original position
        pastePosition = { x: minX + 50, y: minY + 50 }
      }

      // Calculate offset
      const offsetX = pastePosition.x - minX
      const offsetY = pastePosition.y - minY

      // Create ID mapping for nodes
      const idMapping: Record<string, string> = {}
      const nodesToPaste: Node[] = []

      // Paste nodes with new IDs
      clipboardElements.forEach((node) => {
        const newId = generateId()
        idMapping[node.id] = newId

        // Calculate zIndex if node has parentId
        let zIndex = node.zIndex || 0
        if (node.parentId) {
          const parentNode = nodes.find((n) => n.id === node.parentId)
          if (parentNode) {
            // Base zIndex for nodes in loops
            zIndex = 1000

            // Add depth calculation
            let depth = 1
            let currentParent: Node | undefined = parentNode
            while (currentParent?.parentId) {
              depth++
              currentParent = nodes.find((n) => n.id === currentParent?.parentId)
              if (!currentParent) break
            }

            // Higher depth = higher zIndex
            zIndex += depth * 10
          }
        }

        const newNode: Node = {
          ...node,
          id: newId,
          position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
          selected: true,
          data: { ...node.data, title: generateUniqueTitle(node.data.title || 'Node', nodes) },
          zIndex,
        }

        if (!unifiedNodeRegistry.isTrigger(node.data.type)) {
          nodesToPaste.push(newNode)
        }

        // if (node.data.type === NodeType.LOOP) {
        //   newNode.data.loopData = { ...node.data.loopData, isLoop: true }
        // }
      })

      // Update nodes in ReactFlow
      setNodes([...nodes, ...nodesToPaste])

      // Handle edges between pasted nodes
      const clipboardNodeIds = new Set(clipboardElements.map((n) => n.id))
      const edgesToPaste: Edge[] = []

      // Find all edges that connect clipboard nodes
      edges.forEach((edge) => {
        if (clipboardNodeIds.has(edge.source) && clipboardNodeIds.has(edge.target)) {
          const sourceId = idMapping[edge.source]
          const targetId = idMapping[edge.target]

          if (sourceId && targetId) {
            const newEdge: Edge = {
              ...edge,
              id: `${sourceId}-${edge.sourceHandle || 'source'}-${targetId}-${edge.targetHandle || 'target'}`,
              source: sourceId,
              target: targetId,
              data: { ...edge.data },
            }
            edgesToPaste.push(newEdge)
          }
        }
      })

      // Update edges if any
      if (edgesToPaste.length > 0) {
        setEdges([...edges, ...edgesToPaste])
      }

      // Save to history
      saveStateToHistory(WorkflowHistoryEvent.NodePaste)
      debouncedSave()

      // Show success toast
      const nodeText = nodesToPaste.length === 1 ? 'node' : 'nodes'
      const edgeText = edgesToPaste.length === 1 ? 'connection' : 'connections'
      let description = `${nodesToPaste.length} ${nodeText} pasted`
      if (edgesToPaste.length > 0) {
        description += ` with ${edgesToPaste.length} ${edgeText}`
      }

      toastSuccess({ title: 'Pasted from clipboard', description })

      // Select the pasted nodes after a small delay to ensure state is updated
      // const pastedIds = nodesToPaste.map((n) => n.id)
      // setTimeout(() => {
      //   const { setNodes } = store.getState()
      //   setNodes((nodes) =>
      //     nodes.map((node) => ({ ...node, selected: pastedIds.includes(node.id) }))
      //   )
      // }, 50)
    },
    [getNodesReadOnly, reactFlow, store, saveStateToHistory, debouncedSave]
  )

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (getNodesReadOnly()) return

      const { nodes, setNodes, edges, setEdges } = store.getState()
      // const nodes = getNodes()
      const currentNodeIndex = nodes.findIndex((node) => node.id === nodeId)
      const currentNode = nodes[currentNodeIndex]
      console.log('Deleting node', nodeId, currentNode)
      if (!currentNode) return

      if (unifiedNodeRegistry.isTrigger(currentNode.data.type)) {
        return false
      }

      // Handle Loop nodes
      if (currentNode.data.type === NodeType.LOOP) {
        const loopChildren = nodes.filter((node) => node.parentId === currentNode.id)

        if (loopChildren.length) {
          if (currentNode.data._isBundled) {
            loopChildren.forEach((child) => {
              handleDeleteNode(child.id)
            })
            return handleDeleteNode(nodeId)
          } else {
            if (loopChildren.length === 1) {
              handleDeleteNode(loopChildren[0].id)
              handleDeleteNode(nodeId)
              return
            }
            loopChildren.forEach((child) => {
              handleDeleteNode(child.id)
            })
            handleDeleteNode(nodeId)
            debouncedSave()
          }
        }
      }

      // Update connected edges and nodes
      const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        connectedEdges.map((edge) => ({ type: 'remove', edge })),
        nodes
      )
      const newNodes = produce(nodes, (draft: Node[]) => {
        draft.forEach((node) => {
          if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
            node.data = { ...node.data, ...nodesConnectedSourceOrTargetHandleIdsMap[node.id] }
          }

          if (node.id === currentNode.parentId)
            node.data._children = node.data._children?.filter((child) => child !== nodeId)
        })
        draft.splice(currentNodeIndex, 1)
      })

      setNodes(newNodes)

      const newEdges = produce(edges, (draft) => {
        return draft.filter(
          (edge) => !connectedEdges.find((connectedEdge) => connectedEdge.id === edge.id)
        )
      })
      setEdges(newEdges)

      // Variables are automatically removed by VarStoreSyncProvider

      // Downstream nodes are automatically updated by VarStoreSyncProvider

      debouncedSave()

      if (currentNode.data.type === 'note') saveStateToHistory(WorkflowHistoryEvent.NoteDelete)
      else saveStateToHistory(WorkflowHistoryEvent.NodeDelete)

      closePanel()
    },
    [getNodesReadOnly, store, debouncedSave, saveStateToHistory, closePanel]
  )

  const handleCenterOnNode = useCallback(
    (
      nodeId: string,
      options?: { offset?: { x: number; y: number }; animation?: { duration: number } }
    ) => {
      // Try direct call first using the ReactFlow instance
      const getInstance = () => reactFlow
      const success = centerOnNode(nodeId, getInstance, options)

      if (!success) {
        // Fallback to event dispatch if direct call fails
        window.dispatchEvent(
          new CustomEvent('workflow:centerOnNode', { detail: { nodeId, ...options } })
        )
      }
    },
    [store]
  )

  /**
   * When hovering a node, highlight connected edges and parallel nodes
   */
  const handleNodeEnter = useCallback<NodeMouseHandler>(
    (_, node) => {
      // Return early if we are in read-only
      if (getNodesReadOnly()) return
      // Return if the node is a note
      if (node.data.type === NodeType.NOTE || node.data.type === NodeType.LOOP) return

      const { nodes, setNodes, edges, setEdges } = store.getState()

      const newEdges = produce(edges, (draft) => {
        const connectedEdges = getConnectedEdges([node], edges)

        connectedEdges.forEach((edge) => {
          const currentEdge = draft.find((e) => e.id === edge.id)
          if (currentEdge) {
            currentEdge.data = currentEdge.data || {}
            currentEdge.data._connectedNodeIsHovering = true
          }
        })
      })
      setEdges(newEdges)
      const connectedEdges = getConnectedEdges([node], edges).filter(
        (edge) => edge.target === node.id
      )

      const targetNodes: Node[] = []
      for (let i = 0; i < connectedEdges.length; i++) {
        const sourceConnectedEdges = getConnectedEdges(
          [{ id: connectedEdges[i].source } as Node],
          edges
        ).filter(
          (edge) =>
            edge.source === connectedEdges[i].source &&
            edge.sourceHandle === connectedEdges[i].sourceHandle
        )
        const sourceConnection = sourceConnectedEdges
          .map((edge) => nodes.find((n) => n.id === edge.target)!)
          .filter(Boolean)
        // DONT DELETE NOTE:  for some reason some sourceConnectedEdges are empty, .filter(Boolean)
        targetNodes.push(...sourceConnection)
      }
      const uniqTargetNodes = uniqueBy(targetNodes, 'id')
      if (uniqTargetNodes.length > 1) {
        const newNodes = produce(nodes, (draft: any) => {
          draft.forEach((n: any) => {
            if (uniqTargetNodes.some((targetNode) => n.id === targetNode.id)) {
              n.data = n.data || {}
              n.data._inParallelHovering = true
            }
          })
        })
        setNodes(newNodes)
      }
    },
    [store, getNodesReadOnly]
  )

  /**
   * When leaving a node, remove highlights from connected edges and parallel nodes
   */
  const handleNodeLeave = useCallback<NodeMouseHandler>(
    (_, node) => {
      // Return early if we are in read-only
      if (getNodesReadOnly()) return
      // Return if the node is a note
      if (node.data.type === NodeType.NOTE) return

      const { nodes, setNodes, edges, setEdges } = store.getState()
      const newNodes = produce(nodes, (draft: any) => {
        draft.forEach((node: any) => {
          node.data = node.data || {}
          node.data._inParallelHovering = false
        })
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          edge.data = edge.data || {}
          edge.data._connectedNodeIsHovering = false
        })
      })
      setEdges(newEdges)
    },
    [store, getNodesReadOnly]
  )

  // Handle node resize
  const handleNodeResize = useCallback(
    (nodeId: string, params: ResizeParamsWithDirection) => {
      if (getNodesReadOnly()) return

      const { nodes, setNodes } = store.getState()
      const { x, y, width, height } = params

      const currentNode = nodes.find((n) => n.id === nodeId)!

      // Track what dimensions are actually changing
      const currentWidth = (currentNode.width ?? currentNode.data.width) as number
      const currentHeight = (currentNode.height ?? currentNode.data.height) as number
      const widthChanged = Math.abs(width - currentWidth) > 0.5
      const heightChanged = Math.abs(height - currentHeight) > 0.5

      // Only validate children constraints if this is a container node with children
      const childrenNodes = (currentNode.data._children as any)?.length
        ? nodes.filter((n) =>
            (currentNode.data._children as any)?.find((c: any) => c.nodeId === n.id)
          )
        : []

      if (childrenNodes.length > 0) {
        let rightNode: Node | undefined
        let bottomNode: Node | undefined

        childrenNodes.forEach((n) => {
          if (rightNode) {
            if (n.position.x + n.width! > rightNode.position.x + rightNode.width!) rightNode = n
          } else {
            rightNode = n
          }
          if (bottomNode) {
            if (n.position.y + n.height! > bottomNode.position.y + bottomNode.height!)
              bottomNode = n
          } else {
            bottomNode = n
          }
        })

        // Validate width constraint only if width is changing
        if (widthChanged && rightNode) {
          const minRequiredWidth =
            rightNode.position.x + rightNode.width! + LAYOUT_SPACING.NODE_HORIZONTAL_PADDING
          if (width < minRequiredWidth) {
            return
          }
        }

        // Validate height constraint only if height is changing
        if (heightChanged && bottomNode) {
          const minRequiredHeight =
            bottomNode.position.y + bottomNode.height! + LAYOUT_SPACING.NODE_VERTICAL_PADDING
          if (height < minRequiredHeight) {
            return
          }
        }
      }

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((n) => {
          if (n.id === nodeId) {
            n.data.width = width
            n.data.height = height
            n.width = width
            n.height = height
            n.position.x = x
            n.position.y = y
          }
        })
      })
      setNodes(newNodes)
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.NodeResize)
    },
    [getNodesReadOnly, store, debouncedSave, saveStateToHistory]
  )

  const handleNodeDrag = useCallback(
    (e: any, node: Node) => {
      if (getNodesReadOnly()) return

      const { nodes, setNodes } = store.getState()
      e.stopPropagation()

      // Get all selected nodes
      const selectedNodes = nodes.filter((n) => n.selected)
      const isMultiDrag = selectedNodes.length > 1 && selectedNodes.some((n) => n.id === node.id)

      if (isMultiDrag) {
        // Calculate delta from the dragged node's start position
        const startPos = dragNodeStartPosition.current
        if (!startPos) return

        const deltaX = node.position.x - startPos.x
        const deltaY = node.position.y - startPos.y

        // Update all selected nodes with the same delta
        const newNodes = produce(nodes, (draft) => {
          draft.forEach((n) => {
            if (n.selected) {
              // Get the original position for this node from our stored positions
              const originalPos = dragStartPositions.current.get(n.id)
              if (originalPos) {
                n.position = { x: originalPos.x + deltaX, y: originalPos.y + deltaY }
              }
            }
          })
        })
        setNodes(newNodes)
      } else {
        // const { restrict } = handleNodeLoopChildDrag(node)
        // Single node drag - original behavior
        const newNodes = produce(nodes, (draft) => {
          const currentNode = draft.find((n) => n.id === node.id)!
          // if (restrict.x !== undefined) {
          //   currentNode.position.x = restrict.x
          // } else {
          //   currentNode.position.x = node.position.x
          // }
          // if (restrict.y !== undefined) {
          //   currentNode.position.y = restrict.y
          // } else {
          //   currentNode.position.y = node.position.y
          // }
          currentNode.position = { ...node.position }
        })
        setNodes(newNodes)
      }

      // Update helplines during drag
      handleSetHelpline(node as unknown as FlowNode)
    },
    [getNodesReadOnly, store, handleSetHelpline]
  )

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (getNodesReadOnly()) return

      // Store initial position of the dragged node
      dragNodeStartPosition.current = { x: node.position.x, y: node.position.y }

      // Store initial positions of all selected nodes for multi-drag
      const { nodes } = store.getState()
      const selectedNodes = nodes.filter((n) => n.selected)

      dragStartPositions.current.clear()
      selectedNodes.forEach((n) => {
        dragStartPositions.current.set(n.id, { x: n.position.x, y: n.position.y })
      })

      // Set dragging state with all selected node IDs
      const setDragging = useWorkflowStore.getState().setDragging
      const draggedNodeIds = selectedNodes.length > 1 ? selectedNodes.map((n) => n.id) : [node.id]
      setDragging(true, draggedNodeIds)
    },
    [getNodesReadOnly, store]
  )

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (getNodesReadOnly()) return

      const startPos = dragNodeStartPosition.current
      if (!startPos) return
      // Check if position actually changed
      const positionChanged = startPos.x !== node.position.x || startPos.y !== node.position.y

      if (positionChanged) {
        // Get the canvas update function from workflow editor
        // const { canvasInteractionCallbacks } = useWorkflowEditor()

        // Update the canvas component's nodes state with the final position
        // This ensures the canvas component's nodes array is in sync with React Flow
        // canvasInteractionCallbacks.updateNodeOnCanvas(node.id, { position: node.position })

        // Position already updated by ReactFlow during drag
        // Just trigger save
        debouncedSave()

        // If node was moved into/out of a loop, trigger sync for variable availability
        if (node.parentId) {
          useVarStore.getState().actions.triggerSync()
        }

        // Note: No need to call updateNode directly since storeSyncCallbacks.syncNodeToStore already does it

        // TODO: Save to history if not a select-triggered drag (x,y != 0,0)
        // if (startPos.x !== 0 && startPos.y !== 0) {
        //   saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)
        // }
      }
      handleClearHelpline()

      // Clear dragging state
      const setDragging = useWorkflowStore.getState().setDragging
      setDragging(false, [])

      // Reset start positions
      dragNodeStartPosition.current = null
      dragStartPositions.current.clear()
    },
    [getNodesReadOnly, debouncedSave]
  )

  const handleNodeSelect = useCallback(
    (nodeId: string, cancelSelection?: boolean, isMultiSelect?: boolean) => {
      const { nodes, setNodes, edges, setEdges } = store.getState()

      // Find the clicked node
      const clickedNode = nodes.find((node) => node.id === nodeId)
      const isAlreadySelected = clickedNode?.selected

      // In single-select mode, if clicking already selected node, do nothing
      if (!cancelSelection && isAlreadySelected && !isMultiSelect) return

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (node.id === nodeId) {
            if (isMultiSelect) {
              // Toggle selection in multi-select mode
              node.selected = !node.selected
            } else {
              // Single select mode
              node.selected = !cancelSelection
            }
          } else if (!isMultiSelect) {
            // Only deselect others if not in multi-select mode
            node.selected = false
          }
          // In multi-select mode, other nodes keep their selection state
        })
      })
      setNodes(newNodes)

      // Get all selected nodes after the update
      const selectedNodeIds = newNodes.filter((n) => n.selected).map((n) => n.id)

      // Collect all edges connected to any selected node
      const connectedEdgeIds = new Set<string>()
      selectedNodeIds.forEach((selectedNodeId) => {
        const nodeEdges = getConnectedEdges([{ id: selectedNodeId } as Node], edges)
        nodeEdges.forEach((edge) => connectedEdgeIds.add(edge.id))
      })

      // Update edge highlighting
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          edge.data = { ...edge.data, _connectedNodeIsSelected: connectedEdgeIds.has(edge.id) }
        })
      })
      setEdges(newEdges)

      // Emit selection changed event with all selected nodes
      storeEventBus.emit({ type: 'selection:changed', data: { nodes: selectedNodeIds, edges: [] } })

      // handleSyncWorkflowDraft()
    },
    [store]
  )

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      // Check if Ctrl/Cmd is pressed for multi-select
      const isMultiSelect = event.ctrlKey || event.metaKey
      handleNodeSelect(node.id, false, isMultiSelect)
    },
    [handleNodeSelect]
  )

  const handleSelectAll = useCallback(
    (selectAll: boolean) => {
      const { nodes, setNodes, edges, setEdges } = store.getState()

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((n) => {
          // Select/deselect all nodes except triggers
          if (n.data?.type && !unifiedNodeRegistry.isTrigger(n.data.type)) {
            n.selected = selectAll
          }
        })
      })
      setNodes(newNodes)

      // Update edge highlighting for all selected nodes
      if (selectAll) {
        const selectedNodeIds = newNodes.filter((n) => n.selected).map((n) => n.id)
        const connectedEdgeIds = new Set<string>()

        selectedNodeIds.forEach((nodeId) => {
          const nodeEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
          nodeEdges.forEach((edge) => connectedEdgeIds.add(edge.id))
        })

        const newEdges = produce(edges, (draft) => {
          draft.forEach((edge) => {
            edge.data = { ...edge.data, _connectedNodeIsSelected: connectedEdgeIds.has(edge.id) }
          })
        })
        setEdges(newEdges)
      } else {
        // Clear all edge highlights
        const newEdges = produce(edges, (draft) => {
          draft.forEach((edge) => {
            edge.data = { ...edge.data, _connectedNodeIsSelected: false }
          })
        })
        setEdges(newEdges)
      }

      // Emit selection changed event
      const selectedNodes = selectAll ? newNodes.filter((n) => n.selected).map((n) => n.id) : []
      storeEventBus.emit({ type: 'selection:changed', data: { nodes: selectedNodes, edges: [] } })
    },
    [store]
  )

  const handlePaneClick = useCallback(() => {
    const { nodes, setNodes, edges, setEdges, userSelectionActive } = store.getState()

    // Don't deselect if a selection box operation is active
    if (userSelectionActive) {
      return
    }

    // Don't deselect if panel is pinned - user wants to keep current node selected
    if (isPinned) {
      return
    }

    // Deselect all nodes
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.selected = false
        // node.data._isBundled = false
      })
    })
    setNodes(newNodes)

    // Update connected edges
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        // edge.selected = false
        edge.data = { ...edge.data, _connectedNodeIsSelected: false }
      })
    })
    setEdges(newEdges)

    // Emit selection cleared event
    storeEventBus.emit({ type: 'selection:changed', data: { nodes: [], edges: [] } })
  }, [store, isPinned])

  // Helper to update node connection metadata
  const updateNodeConnectionMetadata = useCallback((nodes: Node[], edge: Edge) => {
    return produce(nodes, (draft) => {
      // Update source node
      const sourceNode = draft.find((n) => n.id === edge.source)
      if (sourceNode) {
        const handles = sourceNode.data._connectedSourceHandleIds || []
        if (!handles.includes(edge.sourceHandle || 'source')) {
          sourceNode.data._connectedSourceHandleIds = [...handles, edge.sourceHandle || 'source']
        }
      }

      // Update target node
      const targetNode = draft.find((n) => n.id === edge.target)
      if (targetNode) {
        const handles = targetNode.data._connectedTargetHandleIds || []
        if (!handles.includes(edge.targetHandle || 'target')) {
          targetNode.data._connectedTargetHandleIds = [...handles, edge.targetHandle || 'target']
        }
      }
    })
  }, [])

  // Connection handlers
  const handleNodeConnect = useCallback<OnConnect>(
    ({ source, sourceHandle, target, targetHandle }) => {
      // 1. Basic validation
      if (source === target) return
      if (getNodesReadOnly()) return
      // 2. Get current state
      const { nodes, edges, setNodes, setEdges } = store.getState()

      // 3. Find nodes
      const sourceNode = nodes.find((n) => n.id === source)
      const targetNode = nodes.find((n) => n.id === target)

      if (!sourceNode || !targetNode) return

      // 4. Validate connection
      const connection = { source, sourceHandle, target, targetHandle }
      if (!isValidConnection(connection)) {
        console.warn('Invalid connection:', connection)
        return
      }

      // 5. Check for duplicates
      if (
        edges.find(
          (e) =>
            e.source === source &&
            e.sourceHandle === sourceHandle &&
            e.target === target &&
            e.targetHandle === targetHandle
        )
      )
        return

      // 6. Create edge with loop metadata
      const newEdge: Edge = {
        id: `${source}-${sourceHandle || 'source'}-${target}-${targetHandle || 'target'}`,
        source,
        target,
        sourceHandle,
        targetHandle,
        data: {
          sourceType: sourceNode.data?.type || '',
          targetType: targetNode.data?.type || '',
          // Include loop metadata if source node is in a loop
          isInLoop: sourceNode.data?.isInLoop,
          loopId: sourceNode.data?.loopId,
        },
      }

      // Calculate and set zIndex for edge
      // newEdge.zIndex = calculateEdgeZIndex(newEdge as FlowEdge, nodes as FlowNode[])

      // 7. Update connected handles metadata
      let updatedNodes = updateNodeConnectionMetadata(nodes, newEdge)

      // NEW: Handle input connection metadata
      if (targetHandle === 'input') {
        // Update target node's input connections
        updatedNodes = produce(updatedNodes, (draft) => {
          const targetNodeIndex = draft.findIndex((n) => n.id === target)
          if (targetNodeIndex !== -1) {
            const targetNode = draft[targetNodeIndex]
            if (!targetNode.data.inputNodes) {
              targetNode.data.inputNodes = []
            }
            if (!targetNode.data.inputNodes.includes(source)) {
              targetNode.data.inputNodes.push(source)
            }
          }
        })
      }

      // 8. Update state
      setNodes(updatedNodes)
      setEdges([...edges, newEdge])

      // 9. Clear connection state
      const workflowStore = useWorkflowStore.getState()
      workflowStore.setConnectingNodePayload(undefined)
      workflowStore.setEnteringNodePayload(undefined)

      // 11. Sync and save
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.EdgeAdd)
    },
    [
      store,
      getNodesReadOnly,
      debouncedSave,
      saveStateToHistory,
      isValidConnection,
      updateNodeConnectionMetadata,
    ]
  )

  const handleNodeConnectStart = useCallback<OnConnectStart>(
    (_, { nodeId, handleType, handleId }) => {
      if (getNodesReadOnly()) return

      const node = reactFlow.getNode(nodeId)
      if (!node) return

      // Skip note nodes
      if (node.data.type === 'note') return

      // Set connecting state
      const workflowStore = useWorkflowStore.getState()
      workflowStore.setConnectingNodePayload({
        nodeId,
        nodeType: node.data.type,
        handleType,
        handleId,
      })
    },
    [getNodesReadOnly, reactFlow]
  )

  const handleNodeConnectEnd = useCallback<OnConnectEnd>(() => {
    // Clear connection state
    const workflowStore = useWorkflowStore.getState()
    workflowStore.setConnectingNodePayload(undefined)
    workflowStore.setEnteringNodePayload(undefined)
  }, [])

  const handleNodeDisable = useCallback<NodeDisableHandler>(
    (nodes, toggle) => {
      if (getNodesReadOnly()) return
      const { nodes: allNodes, setNodes } = store.getState()

      let selectedNodes: Node[] = []
      if (nodes) {
        selectedNodes = nodes
      } else {
        selectedNodes = allNodes.filter((n) => n.selected)
      }

      // If no nodes to disable, return
      if (selectedNodes.length === 0) return

      // Check if any of the selected nodes are triggers
      const hasTriggerNode = selectedNodes.some((node) =>
        unifiedNodeRegistry.isTrigger(node.data.type)
      )

      if (hasTriggerNode) {
        toastError({
          title: 'Cannot disable trigger nodes',
          description: 'Trigger nodes cannot be disabled or enabled',
        })
        return
      }

      // If toggle is undefined, use the first node's disabled state
      const shouldDisable = toggle !== undefined ? toggle : !selectedNodes[0].data.disabled

      // Update nodes
      const newNodes = produce(allNodes, (draft) => {
        selectedNodes.forEach((selectedNode) => {
          const node = draft.find((n) => n.id === selectedNode.id)
          if (node) {
            node.data.disabled = shouldDisable
          }
        })
      })

      setNodes(newNodes)
      debouncedSave()
    },
    [store, getNodesReadOnly, debouncedSave]
  )

  const handleNodeChange: OnNodesChange = useCallback(
    (changes) => {
      if (getNodesReadOnly()) return
      // const isDragging = useWorkflowStore.getState().isDragging
      // if (isDragging) return // Skip changes during drag

      // console.log('Node change detected:', isDragging)
      // console.log('Node changes:', changes)

      // setNodes(newNodes)
      // debouncedSave()
    },
    [store, getNodesReadOnly, debouncedSave]
  )

  /**
   * Toggle collapsed state for selected nodes
   * When collapsed, nodes shrink to minimal width showing only title and handles
   */
  const handleToggleCollapse = useCallback(
    (nodeIds?: string[]) => {
      if (getNodesReadOnly()) return

      const { nodes, setNodes } = store.getState()

      // Get nodes to toggle - either provided IDs or selected nodes
      let targetNodeIds = nodeIds
      if (!targetNodeIds || targetNodeIds.length === 0) {
        targetNodeIds = nodes.filter((n) => n.selected).map((n) => n.id)
      }

      if (targetNodeIds.length === 0) return

      // Determine new state: if any selected node is expanded, collapse all; otherwise expand all
      const anyExpanded = targetNodeIds.some((id) => {
        const node = nodes.find((n) => n.id === id)
        return node && !node.data.collapsed
      })

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (targetNodeIds!.includes(node.id)) {
            // Don't allow collapsing trigger nodes
            if (unifiedNodeRegistry.isTrigger(node.data.type)) return
            node.data.collapsed = anyExpanded
          }
        })
      })

      setNodes(newNodes)
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.NodeCollapse)
    },
    [getNodesReadOnly, store, debouncedSave, saveStateToHistory]
  )

  return {
    handleNodeDrag,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodeAdd,
    handleCopyNode,
    handleNodesPaste,
    handleDeleteNode,
    handleCenterOnNode,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeResize,
    handleNodeSelect,
    handleNodeClick,
    handlePaneClick,
    handleNodeConnect,
    handleNodeConnectStart,
    handleNodeConnectEnd,
    handleSelectAll,
    handleNodeDisable,
    handleNodeChange,
    handleToggleCollapse,
  }
}

// useNodesReadOnly is now exported from './use-read-only'

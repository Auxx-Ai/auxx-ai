// apps/web/src/components/workflow/nodes/core/registry.ts

import type { NodeProps } from '@xyflow/react'
import type { ComponentType } from 'react'
import { AiNode, AiPanel } from '~/components/workflow/nodes/core/ai'
import { AnswerNode, AnswerPanel } from '~/components/workflow/nodes/core/answer'
import { CodeNode, CodePanel } from '~/components/workflow/nodes/core/code'
import { DateTimeNode, DateTimePanel } from '~/components/workflow/nodes/core/date-time'
import { EndNode, EndPanel } from '~/components/workflow/nodes/core/end'
import { FormatNode, FormatPanel } from '~/components/workflow/nodes/core/format'
import { HttpNode, HttpNodePanel } from '~/components/workflow/nodes/core/http'
import {
  HumanConfirmationNode,
  HumanConfirmationNodePanel,
} from '~/components/workflow/nodes/core/human'
// Import all node components and panels directly
import { IfElseNode, IfElsePanel } from '~/components/workflow/nodes/core/if-else'
import {
  InformationExtractorNode,
  InformationExtractorPanel,
} from '~/components/workflow/nodes/core/information-extractor'
import { ListNode, ListPanel } from '~/components/workflow/nodes/core/list'
import { LoopNode, LoopPanel } from '~/components/workflow/nodes/core/loop'
import {
  MessageReceivedNode,
  MessageReceivedPanel,
} from '~/components/workflow/nodes/core/message-received'
import { NoteNode, NotePanel } from '~/components/workflow/nodes/core/note'
import {
  TextClassifierNode,
  TextClassifierPanel,
} from '~/components/workflow/nodes/core/text-classifier'
import { VarAssignNode, VarAssignPanel } from '~/components/workflow/nodes/core/var-assign'
import { WaitNode, WaitNodePanel } from '~/components/workflow/nodes/core/wait'
import { WebhookNode, WebhookPanel } from '~/components/workflow/nodes/core/webhook'
import { type NodeDefinition, NodeType } from '~/components/workflow/types'
import { aiDefinition } from './ai'
import { answerDefinition } from './answer'
import { ChunkerNode, ChunkerPanel, chunkerDefinition } from './chunker'
import { codeDefinition } from './code'
import { CrudNode, CrudPanel, crudDefinition } from './crud'
import { DatasetNode, DatasetPanel, datasetDefinition } from './dataset'
import { dateTimeNodeDefinition } from './date-time'
import {
  DocumentExtractorNode,
  DocumentExtractorPanel,
  documentExtractorDefinition,
} from './document-extractor'
import { endDefinition } from './end'
import { FindNode, FindPanel, findDefinition } from './find'
import { formatNodeDefinition } from './format'
import { httpNodeDefinition } from './http'
import { humanConfirmationDefinition } from './human'
import { ifElseDefinition } from './if-else'
import { informationExtractorDefinition } from './information-extractor'
import {
  KnowledgeRetrievalNode,
  KnowledgeRetrievalPanel,
  knowledgeRetrievalDefinition,
} from './knowledge-retrieval'
import { listNodeDefinition } from './list'
import { loopDefinition } from './loop'
import { ManualNode, ManualPanel, manualDefinition } from './manual'
import { messageReceivedDefinition } from './message-received'
import { noteDefinition } from './note'
import {
  ResourceTriggerNode,
  ResourceTriggerPanel,
  resourceTriggerDefinition,
} from './resource-trigger'
import {
  ScheduledTriggerNode,
  ScheduledTriggerPanel,
  scheduledTriggerDefinition,
} from './scheduled'
import { textClassifierDefinition } from './text-classifier'
import { varAssignDefinition } from './var-assign'
import { waitDefinition } from './wait'
import { webhookDefinition } from './webhook'

// import { variableDefinition } from './variable/schema'

// Import input nodes
import { INPUT_NODE_DEFINITIONS, INPUT_NODE_TYPES } from '../inputs'

/**
 * All node definitions for the workflow system
 * Now includes component references for dynamic rendering
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [
  // Core workflow nodes
  { ...answerDefinition, component: AnswerNode, panel: AnswerPanel },
  { ...codeDefinition, component: CodeNode, panel: CodePanel },
  { ...ifElseDefinition, component: IfElseNode, panel: IfElsePanel },
  { ...messageReceivedDefinition, component: MessageReceivedNode, panel: MessageReceivedPanel },
  { ...webhookDefinition, component: WebhookNode, panel: WebhookPanel },
  { ...scheduledTriggerDefinition, component: ScheduledTriggerNode, panel: ScheduledTriggerPanel },
  { ...manualDefinition, component: ManualNode, panel: ManualPanel },
  { ...resourceTriggerDefinition, component: ResourceTriggerNode, panel: ResourceTriggerPanel },
  { ...aiDefinition, component: AiNode, panel: AiPanel },
  { ...endDefinition, component: EndNode, panel: EndPanel },
  { ...noteDefinition, component: NoteNode, panel: NotePanel },
  { ...textClassifierDefinition, component: TextClassifierNode, panel: TextClassifierPanel },
  {
    ...informationExtractorDefinition,
    component: InformationExtractorNode,
    panel: InformationExtractorPanel,
  },
  { ...varAssignDefinition, component: VarAssignNode, panel: VarAssignPanel },
  { ...dateTimeNodeDefinition, component: DateTimeNode, panel: DateTimePanel },
  { ...httpNodeDefinition, component: HttpNode, panel: HttpNodePanel },
  { ...waitDefinition, component: WaitNode, panel: WaitNodePanel },
  { ...listNodeDefinition, component: ListNode, panel: ListPanel as any },
  { ...formatNodeDefinition, component: FormatNode, panel: FormatPanel },
  { ...loopDefinition, component: LoopNode, panel: LoopPanel },
  {
    ...humanConfirmationDefinition,
    component: HumanConfirmationNode,
    panel: HumanConfirmationNodePanel,
  },
  { ...findDefinition, component: FindNode, panel: FindPanel },
  { ...crudDefinition, component: CrudNode, panel: CrudPanel },
  {
    ...documentExtractorDefinition,
    component: DocumentExtractorNode,
    panel: DocumentExtractorPanel,
  },
  { ...chunkerDefinition, component: ChunkerNode, panel: ChunkerPanel },
  { ...datasetDefinition, component: DatasetNode, panel: DatasetPanel },
  {
    ...knowledgeRetrievalDefinition,
    component: KnowledgeRetrievalNode,
    panel: KnowledgeRetrievalPanel,
  },
  // AppPlaceholder removed - using StandardNode fallback for unregistered app nodes instead
  ...INPUT_NODE_DEFINITIONS,
]

/**
 * customNodeTypes
 * Register components with React Flow - use actual node types directly
 * This ensures each node type has its own component identity for React
 */
export const NODE_TYPES: Record<string, ComponentType<NodeProps>> = {
  [NodeType.IF_ELSE]: IfElseNode as ComponentType<NodeProps>,
  [NodeType.AI]: AiNode as ComponentType<NodeProps>,
  [NodeType.CODE]: CodeNode as ComponentType<NodeProps>,
  [NodeType.ANSWER]: AnswerNode as ComponentType<NodeProps>,
  [NodeType.MESSAGE_RECEIVED]: MessageReceivedNode as ComponentType<NodeProps>,
  [NodeType.WEBHOOK]: WebhookNode as ComponentType<NodeProps>,
  [NodeType.SCHEDULED]: ScheduledTriggerNode as ComponentType<NodeProps>,
  [NodeType.MANUAL]: ManualNode as ComponentType<NodeProps>,
  [NodeType.END]: EndNode as ComponentType<NodeProps>,
  [NodeType.NOTE]: NoteNode as ComponentType<NodeProps>,
  [NodeType.TEXT_CLASSIFIER]: TextClassifierNode as ComponentType<NodeProps>,
  [NodeType.INFORMATION_EXTRACTOR]: InformationExtractorNode as ComponentType<NodeProps>,
  [NodeType.VAR_ASSIGN]: VarAssignNode as ComponentType<NodeProps>,
  [NodeType.DATE_TIME]: DateTimeNode as ComponentType<NodeProps>,
  [NodeType.HTTP]: HttpNode as ComponentType<NodeProps>,
  [NodeType.WAIT]: WaitNode as ComponentType<NodeProps>,
  [NodeType.LIST]: ListNode as ComponentType<NodeProps>,
  [NodeType.FORMAT]: FormatNode as ComponentType<NodeProps>,
  [NodeType.LOOP]: LoopNode as ComponentType<NodeProps>,
  [NodeType.HUMAN_CONFIRMATION]: HumanConfirmationNode as ComponentType<NodeProps>,
  [NodeType.FIND]: FindNode as ComponentType<NodeProps>,
  [NodeType.CRUD]: CrudNode as ComponentType<NodeProps>,
  [NodeType.RESOURCE_TRIGGER]: ResourceTriggerNode as ComponentType<NodeProps>,
  [NodeType.DOCUMENT_EXTRACTOR]: DocumentExtractorNode as ComponentType<NodeProps>,
  [NodeType.CHUNKER]: ChunkerNode as ComponentType<NodeProps>,
  [NodeType.DATASET]: DatasetNode as ComponentType<NodeProps>,
  [NodeType.KNOWLEDGE_RETRIEVAL]: KnowledgeRetrievalNode as ComponentType<NodeProps>,
  // Add input node types
  ...INPUT_NODE_TYPES,
}

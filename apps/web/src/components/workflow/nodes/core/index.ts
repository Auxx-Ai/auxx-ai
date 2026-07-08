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
import { AiTraceRenderer } from './ai/trace-renderer'
import { answerDefinition } from './answer'
import { AnswerTraceRenderer } from './answer/trace-renderer'
import { ChunkerNode, ChunkerPanel, chunkerDefinition } from './chunker'
import { codeDefinition } from './code'
import { CodeTraceRenderer } from './code/trace-renderer'
import { CrudNode, CrudPanel, crudDefinition } from './crud'
import { CrudTraceRenderer } from './crud/trace-renderer'
import { DatasetNode, DatasetPanel, datasetDefinition } from './dataset'
import { dateTimeNodeDefinition } from './date-time'
import { DateTimeTraceRenderer } from './date-time/trace-renderer'
import {
  DocumentExtractorNode,
  DocumentExtractorPanel,
  documentExtractorDefinition,
} from './document-extractor'
import { endDefinition } from './end'
import { EndTraceRenderer } from './end/trace-renderer'
import { FindNode, FindPanel, findDefinition } from './find'
import { FindTraceRenderer } from './find/trace-renderer'
import { formatNodeDefinition } from './format'
import { FormatTraceRenderer } from './format/trace-renderer'
import { httpNodeDefinition } from './http'
import { HttpTraceRenderer } from './http/trace-renderer'
import { humanConfirmationDefinition } from './human'
import { HumanConfirmationTraceRenderer } from './human/trace-renderer'
import { ifElseDefinition } from './if-else'
import { IfElseTraceRenderer } from './if-else/trace-renderer'
import { informationExtractorDefinition } from './information-extractor'
import { InformationExtractorTraceRenderer } from './information-extractor/trace-renderer'
import {
  KnowledgeRetrievalNode,
  KnowledgeRetrievalPanel,
  knowledgeRetrievalDefinition,
} from './knowledge-retrieval'
import { listNodeDefinition } from './list'
import { ListTraceRenderer } from './list/trace-renderer'
import { loopDefinition } from './loop'
import { ManualNode, ManualPanel, manualDefinition } from './manual'
import { messageReceivedDefinition } from './message-received'
import { MessageReceivedTraceRenderer } from './message-received/trace-renderer'
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
import { TextClassifierTraceRenderer } from './text-classifier/trace-renderer'
import { varAssignDefinition } from './var-assign'
import { VarAssignTraceRenderer } from './var-assign/trace-renderer'
import { waitDefinition } from './wait'
import { WaitTraceRenderer } from './wait/trace-renderer'
import { webhookDefinition } from './webhook'
import {
  WebhookTriggerNode,
  WebhookTriggerPanel,
  webhookTriggerDefinition,
} from './webhook-trigger'

// import { variableDefinition } from './variable/schema'

// Import input nodes
import { INPUT_NODE_DEFINITIONS, INPUT_NODE_TYPES } from '../inputs'

/**
 * All node definitions for the workflow system
 * Now includes component references for dynamic rendering
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [
  // Core workflow nodes
  {
    ...answerDefinition,
    component: AnswerNode,
    panel: AnswerPanel,
    traceRenderer: AnswerTraceRenderer,
  },
  { ...codeDefinition, component: CodeNode, panel: CodePanel, traceRenderer: CodeTraceRenderer },
  {
    ...ifElseDefinition,
    component: IfElseNode,
    panel: IfElsePanel,
    traceRenderer: IfElseTraceRenderer,
  },
  {
    ...messageReceivedDefinition,
    component: MessageReceivedNode,
    panel: MessageReceivedPanel,
    traceRenderer: MessageReceivedTraceRenderer,
  },
  { ...webhookDefinition, component: WebhookNode, panel: WebhookPanel },
  {
    ...webhookTriggerDefinition,
    component: WebhookTriggerNode,
    panel: WebhookTriggerPanel,
  },
  { ...scheduledTriggerDefinition, component: ScheduledTriggerNode, panel: ScheduledTriggerPanel },
  { ...manualDefinition, component: ManualNode, panel: ManualPanel },
  { ...resourceTriggerDefinition, component: ResourceTriggerNode, panel: ResourceTriggerPanel },
  { ...aiDefinition, component: AiNode, panel: AiPanel, traceRenderer: AiTraceRenderer },
  { ...endDefinition, component: EndNode, panel: EndPanel, traceRenderer: EndTraceRenderer },
  { ...noteDefinition, component: NoteNode, panel: NotePanel },
  {
    ...textClassifierDefinition,
    component: TextClassifierNode,
    panel: TextClassifierPanel,
    traceRenderer: TextClassifierTraceRenderer,
  },
  {
    ...informationExtractorDefinition,
    component: InformationExtractorNode,
    panel: InformationExtractorPanel,
    traceRenderer: InformationExtractorTraceRenderer,
  },
  {
    ...varAssignDefinition,
    component: VarAssignNode,
    panel: VarAssignPanel,
    traceRenderer: VarAssignTraceRenderer,
  },
  {
    ...dateTimeNodeDefinition,
    component: DateTimeNode,
    panel: DateTimePanel,
    traceRenderer: DateTimeTraceRenderer,
  },
  {
    ...httpNodeDefinition,
    component: HttpNode,
    panel: HttpNodePanel,
    traceRenderer: HttpTraceRenderer,
  },
  {
    ...waitDefinition,
    component: WaitNode,
    panel: WaitNodePanel,
    traceRenderer: WaitTraceRenderer,
  },
  {
    ...listNodeDefinition,
    component: ListNode,
    panel: ListPanel as any,
    traceRenderer: ListTraceRenderer,
  },
  {
    ...formatNodeDefinition,
    component: FormatNode,
    panel: FormatPanel,
    traceRenderer: FormatTraceRenderer,
  },
  { ...loopDefinition, component: LoopNode, panel: LoopPanel },
  {
    ...humanConfirmationDefinition,
    component: HumanConfirmationNode,
    panel: HumanConfirmationNodePanel,
    traceRenderer: HumanConfirmationTraceRenderer,
  },
  { ...findDefinition, component: FindNode, panel: FindPanel, traceRenderer: FindTraceRenderer },
  { ...crudDefinition, component: CrudNode, panel: CrudPanel, traceRenderer: CrudTraceRenderer },
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
  [NodeType.WEBHOOK_ENDPOINT]: WebhookTriggerNode as ComponentType<NodeProps>,
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

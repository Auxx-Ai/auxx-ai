// apps/web/src/components/workflow/nodes/core/registry.ts
import { type ComponentType } from 'react'
import { type NodeProps } from '@xyflow/react'

import { type NodeDefinition, NodeType } from '~/components/workflow/types'
import { answerDefinition } from './answer'
import { codeDefinition } from './code'
import { ifElseDefinition } from './if-else'
import { aiDefinition } from './ai'
import { messageReceivedDefinition } from './message-received'
import { endDefinition } from './end'
import { noteDefinition } from './note'
import { textClassifierDefinition } from './text-classifier'
import { informationExtractorDefinition } from './information-extractor'
import { varAssignDefinition } from './var-assign'
import { dateTimeNodeDefinition } from './date-time'
import { httpNodeDefinition } from './http'
import { waitDefinition } from './wait'
import { webhookDefinition } from './webhook'
import { listNodeDefinition } from './list'
import { loopDefinition } from './loop'
import { humanConfirmationDefinition } from './human'
import { resourceTriggerDefinition } from './resource-trigger'
import { findDefinition } from './find'
import { scheduledTriggerDefinition } from './scheduled'
import { crudDefinition } from './crud'
import { manualDefinition } from './manual'
import { documentExtractorDefinition } from './document-extractor'
import { chunkerDefinition } from './chunker'
import { datasetDefinition } from './dataset'
import { knowledgeRetrievalDefinition } from './knowledge-retrieval'

// Import all node components directly
import { IfElseNode } from '~/components/workflow/nodes/core/if-else'
import { CodeNode } from '~/components/workflow/nodes/core/code'
import { AnswerNode } from '~/components/workflow/nodes/core/answer'
import { MessageReceivedNode } from '~/components/workflow/nodes/core/message-received'
import { AiNode } from '~/components/workflow/nodes/core/ai'
import { EndNode } from '~/components/workflow/nodes/core/end'
import { NoteNode } from '~/components/workflow/nodes/core/note'
import { TextClassifierNode } from '~/components/workflow/nodes/core/text-classifier'
import { InformationExtractorNode } from '~/components/workflow/nodes/core/information-extractor'
import { VarAssignNode } from '~/components/workflow/nodes/core/var-assign'
import { DateTimeNode } from '~/components/workflow/nodes/core/date-time'
import { HttpNode } from '~/components/workflow/nodes/core/http'
import { WaitNode } from '~/components/workflow/nodes/core/wait'
import { WebhookNode } from '~/components/workflow/nodes/core/webhook'
import { ListNode } from '~/components/workflow/nodes/core/list'
import { LoopNode } from '~/components/workflow/nodes/core/loop'
import { HumanConfirmationNode } from '~/components/workflow/nodes/core/human'
import { ResourceTriggerNode } from './resource-trigger'
import { FindNode } from './find'
import { ScheduledTriggerNode } from './scheduled'
import { CrudNode } from './crud'
import { ManualNode } from './manual'
import { DocumentExtractorNode } from './document-extractor'
import { ChunkerNode } from './chunker'
import { DatasetNode } from './dataset'
import { KnowledgeRetrievalNode } from './knowledge-retrieval'
// import { variableDefinition } from './variable/schema'

// Import input nodes
import { INPUT_NODE_DEFINITIONS, INPUT_NODE_TYPES } from '../inputs'

// Import app nodes
import { APP_NODE_DEFINITIONS } from '../application'
// import { ProfessionalNetworkNode } from '../application/professional-network'

// Import auto-generated nodes
import {
  AUTO_GENERATED_NODE_DEFINITIONS,
  AUTO_GENERATED_NODE_TYPES,
} from '../application/auto-generated-registry'

/**
 * All node definitions for the workflow system
 * Now includes component references for dynamic rendering
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [
  // Core workflow nodes
  { ...answerDefinition, component: AnswerNode },
  { ...codeDefinition, component: CodeNode },
  { ...ifElseDefinition, component: IfElseNode },
  { ...messageReceivedDefinition, component: MessageReceivedNode },
  { ...webhookDefinition, component: WebhookNode },
  { ...scheduledTriggerDefinition, component: ScheduledTriggerNode },
  { ...manualDefinition, component: ManualNode },
  { ...resourceTriggerDefinition, component: ResourceTriggerNode },
  { ...aiDefinition, component: AiNode },
  { ...endDefinition, component: EndNode },
  { ...noteDefinition, component: NoteNode },
  { ...textClassifierDefinition, component: TextClassifierNode },
  { ...informationExtractorDefinition, component: InformationExtractorNode },
  { ...varAssignDefinition, component: VarAssignNode },
  { ...dateTimeNodeDefinition, component: DateTimeNode },
  { ...httpNodeDefinition, component: HttpNode },
  { ...waitDefinition, component: WaitNode },
  { ...listNodeDefinition, component: ListNode },
  { ...loopDefinition, component: LoopNode },
  { ...humanConfirmationDefinition, component: HumanConfirmationNode },
  { ...findDefinition, component: FindNode },
  { ...crudDefinition, component: CrudNode },
  { ...documentExtractorDefinition, component: DocumentExtractorNode },
  { ...chunkerDefinition, component: ChunkerNode },
  { ...datasetDefinition, component: DatasetNode },
  { ...knowledgeRetrievalDefinition, component: KnowledgeRetrievalNode },
  // AppPlaceholder removed - using StandardNode fallback for unregistered app nodes instead
  ...INPUT_NODE_DEFINITIONS,
  // App integration nodes
  ...APP_NODE_DEFINITIONS,
  // Auto-generated nodes
  ...AUTO_GENERATED_NODE_DEFINITIONS,
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
  // Add app node types
  // [NodeType.PROFESSIONAL_NETWORK]: ProfessionalNetworkNode as ComponentType<NodeProps>,
  // Add auto-generated node types
  ...AUTO_GENERATED_NODE_TYPES,
}

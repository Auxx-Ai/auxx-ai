// packages/lib/src/ai/agent-framework/index.ts

export { BUILDER_MODEL } from './builder-model'
export type { ContextManagerConfig } from './context-manager'
export {
  estimateMessageTokens,
  manageContext,
  stripStaleThinkingParts,
} from './context-manager'
export { AgentEngine } from './engine'
export type { AgentJobPayload } from './enqueue-agent-job'
export { enqueueAgentJob } from './enqueue-agent-job'
export { createAgentEventPublisher, subscribeToAgentEvents } from './event-publisher'
export {
  cleanDomainStateForModelSwitch,
  flattenMessagesForModelSwitch,
} from './flatten-messages'
export type { LLMAdapterConfig } from './llm-adapter'
export { createCallModel } from './llm-adapter'
export { processAgentMessage } from './process-agent-job'

export { agentQueryLoop } from './query-loop'
export { withAgentRunLog } from './run-log'
export { buildCatchupMessages } from './sessions/catchup-replay'
export type {
  ChatTriggerContext,
  FindOrCreateThreadSessionInput,
} from './sessions/find-or-create-thread-session'
export { findOrCreateThreadSession } from './sessions/find-or-create-thread-session'
export { executeToolCall } from './tool-bridge'
export type { Subject, ToolContext, WorkflowToolContext } from './tool-context'

export type {
  AgentDefinition,
  AgentDeps,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentSessionType,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  AssistantMessageMetadata,
  AssistantSessionMessage,
  CapturedAction,
  ContentPart,
  LLMCallParams,
  LLMStreamEvent,
  PendingToolCall,
  ResumeOptions,
  Route,
  SessionMessage,
  SystemSessionMessage,
  TextPart,
  ThinkingPart,
  ToolCallPart,
  ToolCallStatus,
  UserSessionMessage,
} from './types'

export { partsToWireFormat, sessionMessagesToWire } from './utils'

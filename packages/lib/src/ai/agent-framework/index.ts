// packages/lib/src/ai/agent-framework/index.ts

export type { ContextManagerConfig } from './context-manager'

export { estimateMessageTokens, manageContext } from './context-manager'
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
export type { ToolBridgeConfig } from './tool-bridge'
export { buildToolsFromDefinitions, executeToolCall, getBuiltInTools } from './tool-bridge'

export type {
  AgentBlock,
  AgentDefinition,
  AgentDeps,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentSessionType,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  LLMCallParams,
  LLMStreamEvent,
  PendingToolCall,
  ResumeOptions,
  Route,
  SessionMessage,
} from './types'

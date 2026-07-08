// apps/homepage/src/app/platform/ai/_mocks/index.ts

export {
  ENTITY_COLOR_CLASS,
  type EntityColor,
  MockAppSidebar,
  type MockSidebarRecordItem,
  type SidebarKey,
} from './mock-app-sidebar'
export { MockAssistantSlot } from './mock-assistant-message'
export {
  MockBlockCard,
  MockDraftApprovalCard,
  MockEntityListBlock,
  MockPlanStepsBlock,
  MockThreadListBlock,
} from './mock-blocks'
export { MockBrowserChrome } from './mock-browser-chrome'
export { MockKopilotHeader, type MockKopilotHeaderProps } from './mock-kopilot-header'
export { MockKopilotPromptStory } from './mock-kopilot-prompt-story'
export { MockKopilotWindow } from './mock-kopilot-window'
export { MockMainPage } from './mock-main-page'
export { MockPanelFrame } from './mock-panel-frame'
export { MockSparkleIcon, type SparkleIconVariant } from './mock-sparkle-icon'
export { MockThinkingSteps } from './mock-thinking-steps'
export { MockToolStatusPill } from './mock-tool-status-pill'
export { MockUserMessage } from './mock-user-message'
export {
  type EntityRow,
  type KopilotStoryScript,
  type PlanStepRow,
  type RenderState,
  type ScriptBlock,
  type ScriptTurn,
  type ThinkingState,
  type ThinkingStepInit,
  type ThreadRow,
  type ToolPillIcon,
  type TurnState,
  useKopilotStory,
} from './use-kopilot-story'

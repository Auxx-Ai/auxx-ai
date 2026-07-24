// apps/web/src/components/agents/constant.ts

/** Default tab on the agent detail page. */
export const DEFAULT_AGENT_TAB = 'prompt'

/** Tab keys used by the agent detail page. */
export const AGENT_TABS = [
  'prompt',
  'procedures',
  'tools',
  'restrictions',
  'knowledge',
  'triggers',
  'permissions',
] as const
export type AgentTab = (typeof AGENT_TABS)[number]

// apps/web/src/components/getting-started/client.ts
// Client-safe display catalog for the getting-started checklist. Labels,
// descriptions, icons and CTAs live here (web concerns); the canonical key set
// + persisted state shapes come from @auxx/lib/getting-started/client.

import { type GoalKey, MAIN_GOAL_KEYS, type MainGoalKey } from '@auxx/lib/getting-started/client'

/** Chrome Web Store listing for the browser extension (published unlisted). */
export const EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/hlhbgglcglfmicfaafdecfnenpocbffl'

export type GettingStartedGoal = {
  key: GoalKey
  label: string
  description: string
  /** EntityIcon icon id (from ICON_DATA). */
  iconId: string
  /** EntityIcon color id (from ICON_COLORS). */
  color: string
  ctaText: string
  /** Where the CTA goes — internal app route or external URL. */
  href: string
  /** Relative docs path for the "Learn more" link, joined onto useEnv().docsUrl. */
  docsPath: string
  /** Optional preview image shown in the hovercard; falls back to the icon. */
  previewImage?: string
  /** External links open in a new tab. */
  external?: boolean
  /** Goals with no server signal are marked complete when the CTA is clicked. */
  markOnClick?: boolean
}

const GOALS: Record<MainGoalKey, Omit<GettingStartedGoal, 'key'>> = {
  'connect-email': {
    label: 'Connect your inbox',
    description: 'Link a Gmail or Outlook mailbox so Auxx can read and reply to support email.',
    iconId: 'mail',
    color: 'blue',
    ctaText: 'Connect inbox',
    href: '/app/settings/inbox?connect=personal',
    docsPath: '/help/getting-started/connect-inbox',
  },
  'setup-agent': {
    label: 'Set up an AI agent',
    description: 'Create and configure an AI agent to draft and send replies for you.',
    iconId: 'sparkles',
    color: 'purple',
    ctaText: 'Set up agent',
    href: '/app/agents',
    docsPath: '/help/agents/creating-an-agent',
  },
  'create-workflow': {
    label: 'Create a workflow',
    description: 'Automate triage, routing and follow-ups with a custom workflow.',
    iconId: 'git-branch',
    color: 'amber',
    ctaText: 'New workflow',
    href: '/app/workflows',
    docsPath: '/help/ai/creating-workflows',
  },
  'create-field': {
    label: 'Create a custom field',
    description: 'Capture the data your team cares about with a custom field on any record.',
    iconId: 'text-cursor-input',
    color: 'teal',
    ctaText: 'Add field',
    href: '/app/settings/custom-fields',
    docsPath: '/help/workspace/custom-fields',
  },
  'invite-team': {
    label: 'Invite your team',
    description: 'Bring teammates in to collaborate on tickets and share the workload.',
    iconId: 'user-plus',
    color: 'green',
    ctaText: 'Invite teammates',
    href: '/app/settings/members',
    docsPath: '/help/getting-started/invite-team',
  },
  'install-extension': {
    label: 'Install the extension',
    description: 'Get Auxx alongside your other tools with the browser extension.',
    iconId: 'plug',
    color: 'indigo',
    ctaText: 'Get the extension',
    href: EXTENSION_STORE_URL,
    docsPath: '/help/getting-started/install-extension',
    external: true,
    markOnClick: true,
  },
}

/** Ordered display catalog (display order = MAIN_GOAL_KEYS order). */
export const GETTING_STARTED_GOALS: GettingStartedGoal[] = MAIN_GOAL_KEYS.map((key) => ({
  key,
  ...GOALS[key],
}))

// packages/lib/src/ai/kopilot/load-master-settings.ts
import type { ToolsetEntry } from '../../agents/prompt-mention-reconciler'
import { getOrgCache } from '../../cache'

export type MasterKopilotSettings = {
  modelId: string | null
  toolsets: ToolsetEntry[]
  appAccounts: Record<string, { credId: string }>
}

/**
 * Reads master Kopilot org-scoped settings from the org-settings cache.
 *
 * The cache provider (`org-settings-provider.ts`) overlays
 * `SETTINGS_CATALOG` defaults onto DB rows, so the keys are normally
 * present. The `??` / `|| null` fallbacks here are belt-and-braces
 * against a stale catalog/cache during a deploy.
 */
export async function loadMasterKopilotSettings(orgId: string): Promise<MasterKopilotSettings> {
  const all = await getOrgCache().get(orgId, 'orgSettings')
  return {
    modelId: (all['kopilot.modelId'] as string) || null,
    toolsets: (all['kopilot.toolsets'] as ToolsetEntry[]) ?? [],
    appAccounts: (all['kopilot.appAccounts'] as Record<string, { credId: string }>) ?? {},
  }
}

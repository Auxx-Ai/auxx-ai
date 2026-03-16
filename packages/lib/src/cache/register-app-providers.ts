// packages/lib/src/cache/register-app-providers.ts

import type { AppCacheService } from './app-cache-service'
import { planMapProvider } from './providers/plan-map-provider'
import { plansProvider } from './providers/plans-provider'
import { workflowTemplatesProvider } from './providers/workflow-templates-provider'

/** Register all app-wide cache providers. Called once at service startup. */
export function registerAppProviders(appCache: AppCacheService): void {
  appCache.register('plans', plansProvider)
  appCache.register('planMap', planMapProvider)
  appCache.register('workflowTemplates', workflowTemplatesProvider)
}

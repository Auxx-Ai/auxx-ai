// apps/web/src/components/kb/ui/settings/settings-submit-registry.ts

/**
 * Tiny registry letting the sidebar's "Save Changes" button submit whichever
 * tab is active. Each tab registers its `submit` handler on mount and
 * unregisters on unmount.
 */
type Handler = () => Promise<void>

const handlers = new Map<string, Handler>()

export function registerSettingsSubmit(tab: string, handler: Handler): () => void {
  handlers.set(tab, handler)
  return () => {
    if (handlers.get(tab) === handler) handlers.delete(tab)
  }
}

export async function submitSettingsTab(tab: string): Promise<void> {
  const handler = handlers.get(tab)
  if (handler) await handler()
}

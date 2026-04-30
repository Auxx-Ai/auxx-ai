// apps/web/src/components/kb/ui/settings/settings-submit-registry.ts

/**
 * Registry of "save now" handlers for the settings sections. The KB sidebar's
 * global Save button calls every registered handler in parallel — autosave
 * sections flush their pending debounce; the Identity section submits its
 * live form.
 */
type Handler = () => Promise<void>

const handlers = new Map<string, Handler>()

export function registerSettingsSubmit(key: string, handler: Handler): () => void {
  handlers.set(key, handler)
  return () => {
    if (handlers.get(key) === handler) handlers.delete(key)
  }
}

export async function submitAllSettings(): Promise<void> {
  await Promise.all(Array.from(handlers.values()).map((fn) => fn().catch(() => {})))
}

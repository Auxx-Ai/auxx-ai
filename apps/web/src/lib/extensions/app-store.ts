// apps/web/src/lib/extensions/app-store.ts
import { EventBroker } from './event-broker'
import type { MessageClient } from './message-client'

// === Types ===

/**
 * Surface interface representing an extension surface (action, widget, etc).
 */
export interface Surface {
  id: string
  label?: string
  [key: string]: any // Surface-specific properties
}

/**
 * Map of surface types to arrays of surfaces.
 */
export interface SurfaceMap {
  'record-action'?: Surface[]
  'bulk-record-action'?: Surface[]
  'record-widget'?: Surface[]
  'workflow-step'?: Surface[]
  'workflow-trigger'?: Surface[]
  [key: string]: Surface[] | undefined
}

/**
 * Internal structure for storing surfaces data.
 */
interface SurfacesData {
  surfaces: SurfaceMap
  initialized: boolean
  changed: EventBroker<void>
}

/**
 * Asset interface representing extension assets (icons, images).
 */
export interface Asset {
  name: string
  data: string // base64 data URL
}

/**
 * Render tree interface representing extension render output.
 */
export interface RenderTree {
  children: any[] // React element instances
}

/**
 * Internal structure for managing trigger promises.
 */
interface TriggerPromise {
  resolve: (result: any) => void
  reject: (error: Error) => void
  appId: string
  appInstallationId: string
}

/**
 * Predicate function for evaluating surface visibility.
 */
interface PredicateFunction {
  (context: any): boolean
}

/**
 * Options for triggering a surface.
 */
interface TriggerSurfaceOptions {
  appId: string
  appInstallationId: string
  surfaceType: string
  surfaceId: string
  payload: any
}

/**
 * Dialog data structure
 */
export interface DialogData {
  id: string
  appId: string
  appInstallationId: string
  title: string
  size?: string
  component: any // Reconstructed React tree
  isOpen: boolean
}

// === AppStore ===

/**
 * Central store for all extension state.
 * Manages message clients, surfaces, renders, assets, and predicates.
 */
export class AppStore {
  // === State Maps ===
  private _messageClients = new Map<string, MessageClient>()
  private _surfaces = new Map<string, SurfacesData>()
  private _renders = new Map<string, RenderTree>()
  private _assets = new Map<string, Asset[]>()
  private _surfacePredicates = new Map<string, PredicateFunction>()
  private _triggerPromises = new Map<number, TriggerPromise>()
  private _dialogs = new Map<string, DialogData>()

  // === Caching for getAllSurfaces ===
  private _cachedAllSurfaces: Map<string, SurfacesData> | null = null
  private _surfacesVersion = 0

  // Counter for trigger IDs
  private _nextTriggerId = 1

  // === Events (using EventBroker for one-time listeners) ===
  readonly events = {
    surfacesChanged: new EventBroker<{ appId: string; appInstallationId: string }>(),
    rendered: new EventBroker<{ appId: string; appInstallationId: string }>(),
    messageClientChanged: new EventBroker<{ appId: string; appInstallationId: string }>(),
    renderErrored: new EventBroker<{ appId: string; appInstallationId: string; error: Error }>(),
    dialogOpened: new EventBroker<{ appId: string; appInstallationId: string; dialogId: string }>(),
    dialogClosed: new EventBroker<{ appId: string; appInstallationId: string; dialogId: string }>(),
    dialogUpdated: new EventBroker<{ appId: string; appInstallationId: string; dialogId: string }>(),
  }

  constructor() {
    console.log('[AppStore] Created')
  }

  // === Message Client Management ===

  /**
   * Register a message client for an extension.
   */
  setMessageClient({
    appId,
    appInstallationId,
    messageClient,
  }: {
    appId: string
    appInstallationId: string
    messageClient: MessageClient
  }): void {
    const key = this._getKey(appId, appInstallationId)
    this._messageClients.set(key, messageClient)
    this.events.messageClientChanged.trigger({ appId, appInstallationId })
    console.log(`[AppStore] MessageClient registered for ${appId}:${appInstallationId}`)
  }

  /**
   * Get message client for an extension.
   */
  getMessageClient({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): MessageClient | undefined {
    const key = this._getKey(appId, appInstallationId)
    return this._messageClients.get(key)
  }

  /**
   * Remove message client for an extension.
   */
  removeMessageClient({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): void {
    const key = this._getKey(appId, appInstallationId)
    this._messageClients.delete(key)
    this.events.messageClientChanged.trigger({ appId, appInstallationId })
  }

  // === Surface Registration ===

  /**
   * Register surfaces for an extension.
   * Wraps onTrigger handlers to proxy through message client.
   */
  registerSurfaces({
    appId,
    appInstallationId,
    surfaces,
  }: {
    appId: string
    appInstallationId: string
    surfaces: SurfaceMap
  }): void {
    const surfacesData = this._getSurfacesData({ appId, appInstallationId })

    // Process surfaces - wrap onTrigger handlers to proxy through message client
    const processed: SurfaceMap = {}

    Object.entries(surfaces).forEach(([surfaceType, items]) => {
      if (!items) return

      processed[surfaceType] = items.map((surface) => {
        // If surface has onTrigger, wrap it to proxy through message client
        if ('onTrigger' in surface && typeof surface.onTrigger === 'function') {
          return {
            ...surface,
            onTrigger: async (payload: any) => {
              return this._triggerSurface({
                appId,
                appInstallationId,
                surfaceType,
                surfaceId: surface.id,
                payload,
              })
            },
          }
        }

        return surface
      })
    })

    surfacesData.surfaces = processed
    surfacesData.initialized = true
    surfacesData.changed.trigger()

    // Invalidate cache when surfaces change
    this._cachedAllSurfaces = null
    this._surfacesVersion++

    this.events.surfacesChanged.trigger({ appId, appInstallationId })

    console.log(`[AppStore] Surfaces registered for ${appId}:${appInstallationId}`, {
      types: Object.keys(processed),
      counts: Object.fromEntries(
        Object.entries(processed).map(([type, items]) => [type, items?.length || 0])
      ),
    })
  }

  /**
   * Get surfaces for an extension.
   */
  getSurfaces({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): SurfaceMap {
    const surfacesData = this._getSurfacesData({ appId, appInstallationId })
    return surfacesData.surfaces
  }

  /**
   * Get all surfaces from all extensions.
   * Returns a cached Map instance to prevent unnecessary re-renders in useSyncExternalStore.
   */
  getAllSurfaces(): Map<string, SurfacesData> {
    // Return cached Map if surfaces haven't changed
    if (this._cachedAllSurfaces !== null) {
      return this._cachedAllSurfaces
    }

    // Create new Map and cache it
    this._cachedAllSurfaces = new Map(this._surfaces)
    return this._cachedAllSurfaces
  }

  /**
   * Get or create surfaces data for an extension.
   */
  private _getSurfacesData({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): SurfacesData {
    const key = this._getKey(appId, appInstallationId)
    let data = this._surfaces.get(key)

    if (!data) {
      data = {
        surfaces: {},
        initialized: false,
        changed: new EventBroker<void>(),
      }
      this._surfaces.set(key, data)

      // Invalidate cache when new extension is added
      this._cachedAllSurfaces = null
      this._surfacesVersion++
    }

    return data
  }

  /**
   * Subscribe to surface changes for a specific extension.
   */
  surfacesChanged({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): EventBroker<void> {
    const surfacesData = this._getSurfacesData({ appId, appInstallationId })
    return surfacesData.changed
  }

  // === Surface Triggering ===

  /**
   * Trigger a surface action (e.g., user clicks a button).
   * Sends message to extension and returns promise that resolves when extension completes.
   *
   * This is the public API for triggering surfaces.
   */
  async triggerSurface({
    appId,
    appInstallationId,
    surfaceType,
    surfaceId,
    payload,
  }: TriggerSurfaceOptions): Promise<any> {
    return this._triggerSurface({ appId, appInstallationId, surfaceType, surfaceId, payload })
  }

  /**
   * Internal trigger implementation.
   */
  private async _triggerSurface({
    appId,
    appInstallationId,
    surfaceType,
    surfaceId,
    payload,
  }: TriggerSurfaceOptions): Promise<any> {
    const messageClient = this.getMessageClient({ appId, appInstallationId })

    if (!messageClient) {
      throw new Error(
        `MessageClient not found for ${appId}:${appInstallationId}. Cannot trigger surface.`
      )
    }

    const triggerId = this._nextTriggerId++

    console.log(`[AppStore] Triggering surface ${surfaceType}:${surfaceId} (trigger #${triggerId})`)

    // Send message to extension
    messageClient.sendMessage('trigger-surface', {
      surfaceType,
      surfaceId,
      payload,
      triggerId,
    })

    // Return promise that will be resolved when extension calls back
    return new Promise((resolve, reject) => {
      this._triggerPromises.set(triggerId, {
        resolve,
        reject,
        appId,
        appInstallationId,
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this._triggerPromises.has(triggerId)) {
          this._triggerPromises.delete(triggerId)
          reject(new Error(`Surface trigger timed out (${surfaceType}:${surfaceId})`))
        }
      }, 30000)
    })
  }

  /**
   * Complete a surface trigger (called by extension via message).
   */
  completeTrigger({ triggerId, result }: { triggerId: number; result?: any }): void {
    const promise = this._triggerPromises.get(triggerId)

    if (!promise) {
      console.warn(`[AppStore] Trigger #${triggerId} not found (already completed or timed out)`)
      return
    }

    this._triggerPromises.delete(triggerId)
    promise.resolve(result)
    console.log(`[AppStore] Trigger #${triggerId} completed`)
  }

  /**
   * Fail a surface trigger (called by extension via message).
   */
  failTrigger({ triggerId, error }: { triggerId: number; error: string }): void {
    const promise = this._triggerPromises.get(triggerId)

    if (!promise) {
      console.warn(`[AppStore] Trigger #${triggerId} not found (already completed or timed out)`)
      return
    }

    this._triggerPromises.delete(triggerId)
    promise.reject(new Error(error))
    console.log(`[AppStore] Trigger #${triggerId} failed:`, error)
  }

  // === Assets ===

  /**
   * Register assets for an extension.
   */
  registerAssets({
    appId,
    appInstallationId,
    assets,
  }: {
    appId: string
    appInstallationId: string
    assets: Asset[]
  }): void {
    const key = this._getKey(appId, appInstallationId)
    this._assets.set(key, assets)
    console.log(`[AppStore] ${assets.length} assets registered for ${appId}:${appInstallationId}`)
  }

  /**
   * Get assets for an extension.
   */
  getAssets({ appId, appInstallationId }: { appId: string; appInstallationId: string }): Asset[] {
    const key = this._getKey(appId, appInstallationId)
    return this._assets.get(key) || []
  }

  // === Renders ===

  /**
   * Update render tree for an extension.
   */
  updateRender({
    appId,
    appInstallationId,
    children,
  }: {
    appId: string
    appInstallationId: string
    children: any[]
  }): void {
    const key = this._getKey(appId, appInstallationId)
    this._renders.set(key, { children })
    this.events.rendered.trigger({ appId, appInstallationId })
    console.log(`[AppStore] Render updated for ${appId}:${appInstallationId}`)
  }

  /**
   * Get render tree for an extension.
   */
  getRender({
    appId,
    appInstallationId,
  }: {
    appId: string
    appInstallationId: string
  }): RenderTree | undefined {
    const key = this._getKey(appId, appInstallationId)
    return this._renders.get(key)
  }

  /**
   * Report render error for an extension.
   */
  reportRenderError({
    appId,
    appInstallationId,
    error,
  }: {
    appId: string
    appInstallationId: string
    error: Error
  }): void {
    this.events.renderErrored.trigger({ appId, appInstallationId, error })
    console.error(`[AppStore] Render error in ${appId}:${appInstallationId}:`, error)
  }

  // === Surface Predicates ===

  /**
   * Add a predicate function for showing/hiding a surface.
   */
  addShowSurfacePredicate({
    appId,
    appInstallationId,
    surfaceType,
    surfaceId,
    predicate,
  }: {
    appId: string
    appInstallationId: string
    surfaceType: string
    surfaceId: string
    predicate: PredicateFunction
  }): () => void {
    const predicateId = `${appId}:${appInstallationId}:${surfaceType}:${surfaceId}`
    this._surfacePredicates.set(predicateId, predicate)

    // Return cleanup function
    return () => {
      this._surfacePredicates.delete(predicateId)
    }
  }

  /**
   * Evaluate whether a surface should be shown based on context.
   */
  shouldShowSurface({
    appId,
    appInstallationId,
    surfaceType,
    surfaceId,
    context,
  }: {
    appId: string
    appInstallationId: string
    surfaceType: string
    surfaceId: string
    context: any
  }): boolean {
    const predicateId = `${appId}:${appInstallationId}:${surfaceType}:${surfaceId}`
    const predicate = this._surfacePredicates.get(predicateId)

    // If no predicate, show by default
    if (!predicate) return true

    // Evaluate predicate
    try {
      return predicate(context)
    } catch (error) {
      console.error(`[AppStore] Predicate evaluation error for ${predicateId}:`, error)
      return false
    }
  }

  // === Dialog Management ===

  /**
   * Register/open a dialog
   */
  openDialog({
    appId,
    appInstallationId,
    dialogId,
    title,
    size,
    component
  }: {
    appId: string
    appInstallationId: string
    dialogId: string
    title: string
    size?: string
    component: any
  }): void {
    const key = this._getKey(appId, appInstallationId)

    console.log(`[AppStore] Opening dialog: ${dialogId} for ${key}`)

    this._dialogs.set(dialogId, {
      id: dialogId,
      appId,
      appInstallationId,
      title,
      size,
      component,
      isOpen: true
    })

    this.events.dialogOpened.trigger({ appId, appInstallationId, dialogId })
  }

  /**
   * Close a dialog
   */
  closeDialog(dialogId: string): void {
    const dialog = this._dialogs.get(dialogId)

    if (!dialog) {
      console.warn(`[AppStore] Dialog not found: ${dialogId}`)
      return
    }

    console.log(`[AppStore] Closing dialog: ${dialogId}`)

    dialog.isOpen = false
    this._dialogs.delete(dialogId)

    this.events.dialogClosed.trigger({
      appId: dialog.appId,
      appInstallationId: dialog.appInstallationId,
      dialogId
    })
  }

  /**
   * Update a dialog's component (for React state updates)
   */
  updateDialog({
    dialogId,
    component
  }: {
    dialogId: string
    component: any
  }): void {
    const dialog = this._dialogs.get(dialogId)

    if (!dialog || !dialog.isOpen) {
      console.warn(`[AppStore] Cannot update dialog: ${dialogId} (not open)`)
      return
    }

    console.log(`[AppStore] Updating dialog: ${dialogId}`)

    dialog.component = component

    this.events.dialogUpdated.trigger({
      appId: dialog.appId,
      appInstallationId: dialog.appInstallationId,
      dialogId
    })
  }

  /**
   * Get current open dialog (if any)
   */
  getOpenDialog(): DialogData | null {
    for (const dialog of this._dialogs.values()) {
      if (dialog.isOpen) {
        return dialog
      }
    }
    return null
  }

  /**
   * Get all dialogs for an extension
   */
  getDialogs({
    appId,
    appInstallationId
  }: {
    appId: string
    appInstallationId: string
  }): DialogData[] {
    const result: DialogData[] = []

    for (const dialog of this._dialogs.values()) {
      if (dialog.appId === appId && dialog.appInstallationId === appInstallationId) {
        result.push(dialog)
      }
    }

    return result
  }

  // === Helpers ===

  /**
   * Generate unique key for extension (appId:appInstallationId).
   */
  private _getKey(appId: string, appInstallationId: string): string {
    return `${appId}:${appInstallationId}`
  }
}

// apps/web/src/lib/extensions/surface-instance-external-store.ts

import type { AppStore } from './app-store'
import { EventBroker } from './event-broker'
import type { MessageClient } from './message-client'

/**
 * Options for creating a surface instance.
 */
interface SurfaceInstanceOptions {
  appId: string
  appInstallationId: string
  surfaceType: string
  surfaceId: string
  surfaceProps: Record<string, any> // recordId, object, etc.
}

/**
 * Render instance from the serialized component tree.
 * components are serialized in the iframe and reconstructed in the main window.
 */
interface RenderInstance {
  tag: string
  attributes: Record<string, any>
  children?: RenderInstance[]
}

/**
 * Snapshot result for useSyncExternalStore.
 */
interface SnapshotResult {
  status: 'pending' | 'complete'
  value?: RenderInstance
}

/**
 * External store for a single widget instance.
 * Manages lifecycle (mount/unmount) using reference counting.
 *
 * - First subscriber mounts widget (sends render-widget message)
 * - Last unsubscribe unmounts widget (sends unrender-widget message)
 * - Uses useSyncExternalStore for reactive updates
 * - Singleton pattern per widget instance (by serialized key)
 */
export class SurfaceInstanceExternalStore {
  private static instances = new Map<string, SurfaceInstanceExternalStore>()

  private _changedEvent = new EventBroker<void>()
  private _removeRenderListener: (() => void) | null = null
  private _serializedKey: string
  private _messageClient: MessageClient | null = null

  private constructor(
    private _appStore: AppStore,
    private _options: SurfaceInstanceOptions
  ) {
    this._serializedKey = this._getSerializedKey()
  }

  /**
   * Get or create instance (singleton pattern per widget instance).
   */
  static getInstance(
    appStore: AppStore,
    options: SurfaceInstanceOptions
  ): SurfaceInstanceExternalStore {
    const key = SurfaceInstanceExternalStore._makeKey(options)
    let instance = SurfaceInstanceExternalStore.instances.get(key)

    if (!instance) {
      instance = new SurfaceInstanceExternalStore(appStore, options)
      SurfaceInstanceExternalStore.instances.set(key, instance)
    }

    return instance
  }

  /**
   * Add listener (subscribe).
   * First subscriber mounts the widget.
   */
  addListener = (callback: () => void): (() => void) => {
    const wasIdle = this._changedEvent.isIdle()
    const unsubscribe = this._changedEvent.addListener(callback)

    if (wasIdle) {
      // First subscriber - mount the widget
      console.log(`[SurfaceInstance] Mounting widget: ${this._serializedKey}`)
      this._mount()
    }

    // Return unsubscribe function
    return () => {
      unsubscribe()

      if (this._changedEvent.isIdle()) {
        // Last subscriber - unmount the widget
        console.log(`[SurfaceInstance] Unmounting widget: ${this._serializedKey}`)
        this._unmount()
      }
    }
  }

  /**
   * Get current snapshot (for useSyncExternalStore).
   */
  getSnapshot = (): SnapshotResult => {
    const render = this._appStore.getRender({
      appId: this._options.appId,
      appInstallationId: this._options.appInstallationId,
    })

    if (!render) {
      return { status: 'pending' }
    }

    // Find widget instance in render tree
    const instance = this._findInstance(render.children, (inst) => {
      return (
        inst.tag === 'auxxwidgetcontainer' && inst.attributes.hostInstanceId === this._serializedKey
      )
    })

    if (instance) {
      return { status: 'complete', value: instance }
    }

    return { status: 'pending' }
  }

  /**
   * Mount the widget.
   */
  private _mount(): void {
    // Get MessageClient
    this._messageClient =
      this._appStore.getMessageClient({
        appId: this._options.appId,
        appInstallationId: this._options.appInstallationId,
      }) || null

    if (!this._messageClient) {
      console.error(
        `[SurfaceInstance] MessageClient not found for ${this._options.appId}:${this._options.appInstallationId}`
      )
      return
    }

    // Listen for render updates
    this._removeRenderListener = this._appStore.events.rendered.addListener(
      ({ appId, appInstallationId }) => {
        if (
          appId === this._options.appId &&
          appInstallationId === this._options.appInstallationId
        ) {
          this._changedEvent.trigger()
        }
      }
    )

    // Send message to extension to render widget
    if (this._options.surfaceType === 'record-widget') {
      this._messageClient.sendMessage('render-widget', {
        surfaceId: this._options.surfaceId,
        ...this._options.surfaceProps,
        hostInstanceId: this._serializedKey,
      })
    }
  }

  /**
   * Unmount the widget.
   */
  private _unmount(): void {
    // Remove render listener
    this._removeRenderListener?.()
    this._removeRenderListener = null

    // Remove from instances map
    const key = SurfaceInstanceExternalStore._makeKey(this._options)
    SurfaceInstanceExternalStore.instances.delete(key)

    // Send message to extension to unmount widget
    if (this._messageClient && this._options.surfaceType === 'record-widget') {
      this._messageClient.sendMessage('unrender-widget', {
        hostInstanceId: this._serializedKey,
      })
    }

    this._messageClient = null
  }

  /**
   * Find instance in render tree using predicate.
   */
  private _findInstance(
    children: RenderInstance[],
    predicate: (instance: RenderInstance) => boolean
  ): RenderInstance | null {
    for (const child of children) {
      if (predicate(child)) {
        return child
      }

      if (child.children && child.children.length > 0) {
        const found = this._findInstance(child.children, predicate)
        if (found) return found
      }
    }

    return null
  }

  /**
   * Get serialized key for this widget instance.
   */
  private _getSerializedKey(): string {
    return SurfaceInstanceExternalStore._makeKey(this._options)
  }

  /**
   * Make unique key for widget instance.
   */
  private static _makeKey(options: SurfaceInstanceOptions): string {
    const propString = Object.entries(options.surfaceProps)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',')

    return `${options.appId}:${options.appInstallationId}:${options.surfaceType}:${options.surfaceId}:${propString}`
  }
}

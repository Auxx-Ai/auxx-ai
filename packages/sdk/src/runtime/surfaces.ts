// packages/sdk/src/runtime/surfaces.ts

import { SurfaceError } from '../shared/errors.js'
import { EventBroker } from './event-broker.js'

/**
 * Valid surface types in the Auxx platform.
 */
export type SurfaceType =
  | 'record-action'
  | 'bulk-record-action'
  | 'record-widget'
  | 'organization-settings'
  | 'workflow-block'
  | 'quick-action'

/**
 * Valid surface locations in the Auxx platform.
 */
export type SurfaceLocation =
  | 'record-detail-page'
  | 'record-list-page'
  | 'organization-settings-integrations'
  | string // Allow custom locations for extensibility

/**
 * Surface definition registered by extension.
 */
export interface Surface {
  id: string
  type: SurfaceType
  location: SurfaceLocation
  label?: string
  onTrigger?: (context: any) => void | Promise<void>
}

/**
 * Widget rendering context.
 */
export interface WidgetRenderContext {
  surfaceId: string
  instanceId: string
  recordId?: string
  workspaceId?: string
  [key: string]: any
}

/**
 * Component render context (for dialogs, etc.).
 */
export interface ComponentRenderContext {
  id: string
  element: any
}

/**
 * Component unrender context.
 */
export interface ComponentUnrenderContext {
  id: string
}

/**
 * SURFACES manager for the runtime.
 * Manages surface registration and widget rendering lifecycle.
 */
class SurfacesManager {
  private surfaces = new Map<string, Surface>()
  private isResetting = false
  private surfaceRegistered = new EventBroker<Surface>()
  private widgetRenderRequested = new EventBroker<WidgetRenderContext>()

  // Component rendering (for dialogs)
  private renderedComponents = new Map<string, any>()
  public renderedComponentIds: string[] = []
  public componentRenderRequested = new EventBroker<ComponentRenderContext>()
  public componentUnrenderRequested = new EventBroker<ComponentUnrenderContext>()

  /**
   * Start a reset cycle. New surfaces registered during reset won't trigger events immediately.
   */
  startReset(): void {
    this.isResetting = true
    console.log('[SURFACES] Starting reset cycle')
  }

  /**
   * End reset cycle and notify about all registered surfaces.
   */
  endReset(): void {
    console.log('[SURFACES] Ending reset cycle, registered surfaces:', this.surfaces.size)
    this.isResetting = false
  }

  /**
   * Register a surface (action or widget).
   */
  register(surface: Surface): void {
    // Validate required fields with helpful error messages
    const errors: string[] = []

    if (!surface.id) {
      errors.push('Surface is missing "id" field')
    }

    if (!surface.type) {
      errors.push('Surface is missing "type" field')
    }

    if (!surface.location) {
      errors.push('Surface is missing "location" field')
    }

    if (errors.length > 0) {
      const validTypes = [
        'record-action',
        'bulk-record-action',
        'record-widget',
        'organization-settings',
        'workflow-block',
        'quick-action',
      ]

      throw new SurfaceError(
        `Invalid surface registration:\n${errors.join('\n')}\n\n` +
          `Surface must have: id, type, and location.\n\n` +
          `Example:\n` +
          `{\n` +
          `  id: 'my-action',\n` +
          `  type: 'record-action',\n` +
          `  location: 'record-detail-page',\n` +
          `  label: 'My Action'\n` +
          `}\n\n` +
          `Valid types: ${validTypes.join(', ')}`
      )
    }

    this.surfaces.set(surface.id, surface)
    console.log(`[SURFACES] Registered ${surface.type}: ${surface.id} at ${surface.location}`)

    if (!this.isResetting) {
      this.surfaceRegistered.trigger(surface)
    }
  }

  /**
   * Register multiple surfaces.
   */
  registerMany(surfaces: Surface[]): void {
    surfaces.forEach((surface) => this.register(surface))
  }

  /**
   * Get a surface by ID.
   */
  get(id: string): Surface | undefined {
    return this.surfaces.get(id)
  }

  /**
   * Get all surfaces.
   */
  getAll(): Surface[] {
    return Array.from(this.surfaces.values())
  }

  /**
   * Get all surfaces WITHOUT functions (for sending via postMessage).
   * Strips onTrigger and any other non-serializable properties.
   */
  getAllSerializable(): Omit<Surface, 'onTrigger'>[] {
    return Array.from(this.surfaces.values()).map((surface) => {
      const { onTrigger, ...serializableSurface } = surface
      return serializableSurface
    })
  }

  /**
   * Get all surfaces grouped by type WITHOUT functions (for sending via postMessage).
   * Returns surfaces organized by surface type for platform consumption.
   *
   * Special handling for workflow blocks: strips non-serializable React components
   * and functions (node, panel, execute) while preserving metadata.
   */
  getAllSerializableByType(): Record<string, any[]> {
    const grouped: Record<string, any[]> = {}

    for (const surface of this.surfaces.values()) {
      let serializableSurface: any

      // Special handling for workflow blocks - strip React components and functions
      if (surface.type === 'workflow-block' && (surface as any).block) {
        const { onTrigger, block, ...rest } = surface as any

        // Extract only serializable metadata from block
        serializableSurface = {
          ...rest,
          // Include serializable block metadata (NO components or functions)
          blockMetadata: {
            id: block.id,
            label: block.label,
            description: block.description,
            category: block.category,
            icon: block.icon,
            color: block.color,
            schema: {
              inputs: block.schema?.inputs,
              outputs: block.schema?.outputs,
              handles: block.schema?.handles,
            },
            config: block.config,
          },
        }
      } else {
        // Normal surfaces - just strip onTrigger
        const { onTrigger, ...rest } = surface
        serializableSurface = rest
      }

      if (!grouped[surface.type]) {
        grouped[surface.type] = []
      }

      grouped[surface.type]!.push(serializableSurface)
    }

    return grouped
  }

  /**
   * Execute a surface trigger function.
   */
  async executeTrigger(surfaceId: string, context: any): Promise<void> {
    const surface = this.surfaces.get(surfaceId)

    if (!surface) {
      throw new SurfaceError(`Surface not found: ${surfaceId}`)
    }

    if (!surface.onTrigger) {
      throw new SurfaceError(`Surface ${surfaceId} has no onTrigger function`)
    }

    console.log(`[SURFACES] Executing trigger for ${surfaceId}`)
    await surface.onTrigger(context)
  }

  /**
   * Listen for surface registration events.
   */
  onSurfaceRegistered(callback: (surface: Surface) => void): () => void {
    return this.surfaceRegistered.addListener(callback)
  }

  /**
   * Request widget rendering. Called by platform when widget needs to render.
   */
  requestWidgetRender(context: WidgetRenderContext): void {
    console.log('[SURFACES] Widget render requested:', context.surfaceId, context.instanceId)
    this.widgetRenderRequested.trigger(context)
  }

  /**
   * Listen for widget render requests.
   */
  onWidgetRenderRequested(
    callback: (context: WidgetRenderContext) => void | Promise<void>
  ): () => void {
    return this.widgetRenderRequested.addListener(callback)
  }

  /**
   * Clear all surfaces and listeners.
   */
  clear(): void {
    this.surfaces.clear()
    this.surfaceRegistered.clear()
    this.widgetRenderRequested.clear()
    this.renderedComponents.clear()
    this.renderedComponentIds = []
    this.componentRenderRequested.clear()
    this.componentUnrenderRequested.clear()
  }

  /**
   * Render a component (dialog, etc.) - V2 pattern.
   * Just stores the component. Platform will request render via 'render-component' message.
   */
  renderComponent(id: string, element: any): void {
    console.log('[SURFACES] Storing component:', id)

    this.renderedComponents.set(id, element)
    this.renderedComponentIds.push(id)

    // V2: Don't trigger any events. Platform will request render when ready.
  }

  /**
   * Remove a rendered component.
   */
  unrenderComponent(id: string): void {
    console.log('[SURFACES] Unrendering component:', id)

    this.renderedComponents.delete(id)
    const index = this.renderedComponentIds.indexOf(id)
    if (index > -1) {
      this.renderedComponentIds.splice(index, 1)
    }

    this.componentUnrenderRequested.trigger({ id })

    // Notify runtime to clean up active renders
    // This is used by the runtime to stop sending updates for this component
    if (typeof (globalThis as any).cleanupComponentRender === 'function') {
      ;(globalThis as any).cleanupComponentRender(id)
    }
  }

  /**
   * Get all rendered components.
   */
  getAllRenderedComponents(): Map<string, any> {
    return new Map(this.renderedComponents)
  }

  /**
   * Get a rendered component by ID.
   * Used when platform requests render of a stored component.
   */
  getRenderedComponent(id: string): any | undefined {
    return this.renderedComponents.get(id)
  }
}

/**
 * Global SURFACES instance available in platform runtime.
 */
export const SURFACES = new SurfacesManager()

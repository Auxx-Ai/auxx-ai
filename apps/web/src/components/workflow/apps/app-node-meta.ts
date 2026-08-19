// apps/web/src/components/workflow/apps/app-node-meta.ts

/**
 * An app node's identity, resolved from node data alone.
 *
 * App nodes carry `type: "<appId>:<blockId>"`. `data.appId` / `data.blockId` are
 * only written back once `AppWorkflowNode` has mounted and persisted them, so
 * the type string is the authority for anything that runs before that — the
 * workflow checklist validates nodes that were never rendered, and the panel
 * resolves a node the canvas may not have drawn yet.
 *
 * `appSlug` has no such fallback: it is stamped into `defaultData` when the
 * block is added from an installed app, and carried by workflow templates. It is
 * what makes an *uninstalled* app node actionable, since the slug is the only
 * handle `apps.getBySlug` / `apps.install` accept.
 */
export interface AppNodeMeta {
  appId?: string
  blockId?: string
  appSlug?: string
}

/** True for a node type shaped `<appId>:<blockId>` — i.e. contributed by an app. */
export function isAppNodeType(nodeType: unknown): nodeType is string {
  return typeof nodeType === 'string' && nodeType.split(':').length === 2
}

/** Resolve `{ appId, blockId, appSlug }` from a node's data, type string included. */
export function resolveAppNodeMeta(data: any): AppNodeMeta {
  if (!data) return {}

  let appId = typeof data.appId === 'string' && data.appId ? data.appId : undefined
  let blockId = typeof data.blockId === 'string' && data.blockId ? data.blockId : undefined

  if ((!appId || !blockId) && isAppNodeType(data.type)) {
    const [typeAppId, typeBlockId] = (data.type as string).split(':')
    appId = appId || typeAppId
    blockId = blockId || typeBlockId
  }

  const appSlug = typeof data.appSlug === 'string' && data.appSlug ? data.appSlug : undefined

  return { appId, blockId, appSlug }
}

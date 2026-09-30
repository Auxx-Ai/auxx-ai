// packages/lib/src/data-connectors/sinks/writers.ts
// see plans/entity/domain-tables/02-sink-writer.md

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'

// Lazy: a static cache import drags billing and redis into every module that imports the sink.
const loadCache = () => import('../../cache')

/** What the sink hands a writer for one projected record, or one relationship-pass edge. */
export interface SinkWriterApplyInput {
  /** Null mints the instance and the row in one transaction. */
  instanceId: string | null
  connectorId: string
  /** Writer key → source value. */
  values: Record<string, unknown>
  /** Writer key of a belongs_to → target instance id, null clears it. */
  parents: Record<string, string | null>
  /** Value keys to write only where the row holds no value (`fill_blank`, resolved by the sink). */
  fillBlank?: string[]
}

/** Takes over the field-shaped parts of the sink for one definition backed by its own table. */
export interface SinkWriter {
  entityType: string
  /** Registry-shaped refs this writer owns, e.g. 'line_item:qty'. The catalog resolves these before fields. */
  keys: ReadonlySet<string>
  /**
   * Parent entityType → the writer key holding it, e.g. `{ order: 'line_item:order' }`. The fan-out
   * reads it when the parent's has_many field is gone, so a child still finds its parent key.
   */
  parentKeys: Readonly<Record<string, string>>
  /**
   * Mint the instance and the row, or update the row; marks the value keys it writes with
   * `connectorId`. `changed` lists the keys it wrote: a `fillBlank` key over a value is not.
   */
  apply(
    db: Database,
    orgId: string,
    input: SinkWriterApplyInput
  ): Promise<Result<{ instanceId: string; changed: string[] }, Error>>
  readChildren(db: Database, orgId: string, parentIds: string[]): Promise<Map<string, string[]>>
  /** Instance id → `connectorMarks` (key → connector id). */
  readMarks(
    db: Database,
    orgId: string,
    instanceIds: string[]
  ): Promise<Map<string, Record<string, string>>>
  /** Drop `keys` from the marks of `instanceIds`, only where `connectorId` holds them. */
  clearMarks(
    db: Database,
    orgId: string,
    instanceIds: string[],
    keys: string[],
    connectorId: string
  ): Promise<void>
  /** Drop every mark `connectorId` holds, the analogue of the `FieldValue` FK `set null`. */
  sweepConnector(db: Database, orgId: string, connectorId: string): Promise<void>
}

const writers = new Map<string, SinkWriter>()

export function registerSinkWriter(w: SinkWriter): void {
  writers.set(w.entityType, w)
}

/** Test-only: undo a registration. */
export function unregisterSinkWriter(entityType: string): void {
  writers.delete(entityType)
}

export function sinkWriterFor(entityType: string): SinkWriter | undefined {
  return writers.get(entityType)
}

export function registeredSinkWriters(): SinkWriter[] {
  return [...writers.values()]
}

/** The writer behind a definition id; reads no cache while nothing is registered. */
export async function sinkWriterForDef(
  orgId: string,
  entityDefinitionId: string
): Promise<SinkWriter | undefined> {
  if (writers.size === 0) return undefined
  const { getCachedEntityDefId } = await loadCache()
  for (const w of writers.values()) {
    if ((await getCachedEntityDefId(orgId, w.entityType)) === entityDefinitionId) return w
  }
  return undefined
}

/** The writer key holding a parent of definition `parentDefId`, from `parentKeys`. */
export async function writerParentKey(
  orgId: string,
  writer: SinkWriter,
  parentDefId: string
): Promise<string | undefined> {
  const { getCachedEntityDefId } = await loadCache()
  for (const [entityType, key] of Object.entries(writer.parentKeys)) {
    if ((await getCachedEntityDefId(orgId, entityType)) === parentDefId) return key
  }
  return undefined
}

/**
 * The writer key a mapped ref (`<defId>:qty`), a relationship `fieldKey` or a writer key
 * itself names, or undefined when the writer does not own it.
 */
export function writerKeyOf(writer: SinkWriter, ref: string): string | undefined {
  if (writer.keys.has(ref)) return ref
  const key = `${writer.entityType}:${ref.slice(ref.indexOf(':') + 1)}`
  return writer.keys.has(key) ? key : undefined
}

/** The part of a writer key after the entity type, what a mapping ref carries after the def id. */
export function writerKeyField(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The writer key a catalog `target` names: the key itself, its field part (`qty`), or the
 * registry systemAttribute convention `<entityType>_<field>` (`line_item_qty`).
 */
export function writerKeyForTarget(writer: SinkWriter, target: string): string | undefined {
  const direct = writerKeyOf(writer, target)
  if (direct) return direct
  const wanted = normalize(target)
  for (const key of writer.keys) {
    if (normalize(`${writer.entityType}_${writerKeyField(key)}`) === wanted) return key
  }
  return undefined
}

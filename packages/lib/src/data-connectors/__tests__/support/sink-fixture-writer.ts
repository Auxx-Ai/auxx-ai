// packages/lib/src/data-connectors/__tests__/support/sink-fixture-writer.ts
// The test-only `__sink_fixture` definition's writer (plans/entity/domain-tables/02 §4), over
// an in-memory row store in place of a `SinkFixture` table.

import { err, ok } from 'neverthrow'
import { registerSinkWriter, type SinkWriter, unregisterSinkWriter } from '../../sinks/writers'

export const FIXTURE_TYPE = '__sink_fixture'
export const FIXTURE_KEYS = {
  alpha: `${FIXTURE_TYPE}:alpha`,
  beta: `${FIXTURE_TYPE}:beta`,
  parent: `${FIXTURE_TYPE}:parent`,
} as const

/** One row: `id = EntityInstance.id`, two scalars, one parent FK, `connectorMarks`. */
export interface FixtureRow {
  id: string
  alpha: unknown
  beta: unknown
  parent: string | null
  connectorMarks: Record<string, string>
}

/** The parent the fixture's `parent` key points at, for `parentKeys`. */
export const FIXTURE_PARENT_TYPE = '__sink_fixture_parent'

const isBlank = (v: unknown) => v === null || v === undefined || v === ''

const column = (key: string) => key.slice(key.indexOf(':') + 1) as 'alpha' | 'beta' | 'parent'

export interface SinkFixture {
  writer: SinkWriter
  rows: Map<string, FixtureRow>
  /** A hand write: sets the value and clears that key's mark, as the line module will. */
  handEdit(id: string, key: string, value: unknown): void
  /** Make the next `apply` fail. */
  failNext(message: string): void
}

export function createSinkFixture(): SinkFixture {
  const rows = new Map<string, FixtureRow>()
  let minted = 0
  let failure: string | null = null

  const writer: SinkWriter = {
    entityType: FIXTURE_TYPE,
    keys: new Set(Object.values(FIXTURE_KEYS)),
    parentKeys: { [FIXTURE_PARENT_TYPE]: FIXTURE_KEYS.parent },

    async apply(_db, _orgId, input) {
      if (failure) {
        const message = failure
        failure = null
        return err(new Error(message))
      }
      let row = input.instanceId ? rows.get(input.instanceId) : undefined
      if (!row) {
        row = {
          id: input.instanceId ?? `fx-${++minted}`,
          alpha: null,
          beta: null,
          parent: null,
          connectorMarks: {},
        }
        rows.set(row.id, row)
      }
      const changed: string[] = []
      for (const [key, value] of Object.entries(input.values)) {
        const col = column(key)
        if (input.fillBlank?.includes(key) && !isBlank(row[col])) continue
        changed.push(key)
        ;(row as unknown as Record<string, unknown>)[col] = value
        if (isBlank(value)) delete row.connectorMarks[key]
        else row.connectorMarks[key] = input.connectorId
      }
      for (const [key, target] of Object.entries(input.parents)) {
        changed.push(key)
        row.parent = target
      }
      return ok({ instanceId: row.id, changed })
    },

    async readChildren(_db, _orgId, parentIds) {
      const out = new Map<string, string[]>()
      for (const row of rows.values()) {
        if (!row.parent || !parentIds.includes(row.parent)) continue
        out.set(row.parent, [...(out.get(row.parent) ?? []), row.id])
      }
      return out
    },

    async readMarks(_db, _orgId, instanceIds) {
      const out = new Map<string, Record<string, string>>()
      for (const id of instanceIds) {
        const row = rows.get(id)
        if (row) out.set(id, { ...row.connectorMarks })
      }
      return out
    },

    async clearMarks(_db, _orgId, instanceIds, keys, connectorId) {
      for (const id of instanceIds) {
        const marks = rows.get(id)?.connectorMarks
        if (!marks) continue
        for (const key of keys) if (marks[key] === connectorId) delete marks[key]
      }
    },

    async sweepConnector(_db, _orgId, connectorId) {
      for (const row of rows.values()) {
        for (const [key, owner] of Object.entries(row.connectorMarks)) {
          if (owner === connectorId) delete row.connectorMarks[key]
        }
      }
    },
  }

  return {
    writer,
    rows,
    handEdit(id, key, value) {
      const row = rows.get(id)!
      ;(row as unknown as Record<string, unknown>)[column(key)] = value
      delete row.connectorMarks[key]
    },
    failNext(message) {
      failure = message
    },
  }
}

/** Register a fresh fixture writer; only ever under the test runner. */
export function registerSinkFixture(): SinkFixture {
  if (process.env.NODE_ENV !== 'test') throw new Error('__sink_fixture is test-only')
  const fixture = createSinkFixture()
  registerSinkWriter(fixture.writer)
  return fixture
}

export function unregisterSinkFixture(): void {
  unregisterSinkWriter(FIXTURE_TYPE)
}

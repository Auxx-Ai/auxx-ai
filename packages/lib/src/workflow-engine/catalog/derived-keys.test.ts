// packages/lib/src/workflow-engine/catalog/derived-keys.test.ts

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isDerivedKey, stripDerivedKeys } from './derived-keys'
import { listManifests } from './registry'

/**
 * THE catalog invariant behind `derived-keys.ts`.
 *
 * A manifest's `configSchema` describes PERSISTED config, and derived
 * (`_`-prefixed) keys are stripped from every save — by `cleanGraphForSave`
 * on the agent path and `use-workflow-save`'s cleaner on the canvas path. A
 * schema that declares one therefore lies to three different consumers:
 *
 *  - `describe_node_type` publishes `configSchema` as the agent-facing JSON
 *    Schema, so the model is told a canvas-only key is a writable field —
 *    and, when the key is required, a MANDATORY one.
 *  - `validateNodeConfigs` safe-parses stored data against it, so a required
 *    derived key emits a permanent warning on every read of every node of
 *    that type.
 *  - `patch-config` refuses `_`-rooted paths, so the only edit that would
 *    clear that warning is rejected.
 *
 * `http` sat in exactly that trap: `_targetBranches` was required, absent
 * from every stored node, reported on every read, and unpatchable.
 */
describe('catalog derived-key invariant', () => {
  it('no manifest configSchema declares a derived key', () => {
    const offenders = listManifests()
      .map((manifest) => {
        let json: Record<string, unknown>
        try {
          json = z.toJSONSchema(manifest.configSchema as z.ZodType, {
            unrepresentable: 'any',
          }) as Record<string, unknown>
        } catch {
          return null
        }
        const properties = (json.properties ?? {}) as Record<string, unknown>
        const declared = Object.keys(properties).filter(isDerivedKey)
        return declared.length > 0 ? { id: manifest.id, declared } : null
      })
      .filter((entry): entry is { id: string; declared: string[] } => entry !== null)

    expect(offenders).toEqual([])
  })

  it('every manifest default parses against its own schema in its STORED shape', () => {
    // What persists is `defaultData()` minus derived keys. Parsing the
    // as-authored shape (which the pre-existing coverage test does) cannot see
    // a schema that requires something the save path removes.
    const failures = listManifests()
      .map((manifest) => ({
        id: manifest.id,
        result: manifest.configSchema.safeParse({
          id: 'test-node',
          type: manifest.id,
          title: manifest.displayName,
          ...stripDerivedKeys(manifest.defaultData() as Record<string, unknown>),
        }),
      }))
      .filter(({ result }) => !result.success)
      .map(({ id, result }) => ({
        id,
        issues: (result.success ? [] : result.error.issues).map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        ),
      }))

    expect(failures).toEqual([])
  })

  it('parses canvas data that still carries derived keys (zod strips them)', () => {
    // Legacy rows written before the save-path strip landed still hold
    // `_targetBranches` (26 if-else and 4 text-classifier nodes in dev at the
    // time of writing). Dropping the key from the schema must not turn those
    // into validation errors.
    const manifest = listManifests().find((m) => m.id === 'if-else')
    expect(manifest).toBeDefined()
    const parsed = manifest?.configSchema.safeParse({
      id: 'test-node',
      type: 'if-else',
      title: 'IF/ELSE',
      ...(manifest.defaultData() as Record<string, unknown>),
      _targetBranches: [{ id: 'true', name: 'IF', type: 'default' }],
      _connectedSourceHandleIds: ['source'],
    })
    expect(parsed?.success).toBe(true)
  })
})

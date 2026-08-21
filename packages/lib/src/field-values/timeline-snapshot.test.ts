// packages/lib/src/field-values/timeline-snapshot.test.ts

import type { Database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { TIMELINE_SNAPSHOT_ARRAY_LIMIT } from '../timeline/field-change-snapshot'
import { resolveFieldChangeSnapshotPair, type SnapshotContext } from './timeline-snapshot'
import type { CachedField } from './types'

/**
 * A7 verification (multi-value email plan): `buildSnapshotValue` already
 * branches on `Array.isArray` — adds/removes on a multi field must produce
 * timeline entries carrying ARRAY old/new snapshots, sliced to
 * `TIMELINE_SNAPSHOT_ARRAY_LIMIT`. EMAIL values carry no relationship/actor
 * refs, so the resolver never touches the db or org cache here.
 */

const ctx: SnapshotContext = {
  db: {} as Database,
  organizationId: 'org-1',
}

const emailField = {
  id: 'field-email',
  type: 'EMAIL',
  options: { multi: true },
} as CachedField

const email = (id: string, value: string): TypedFieldValue =>
  ({ id, type: 'text', value }) as TypedFieldValue

describe('resolveFieldChangeSnapshotPair — multi-value EMAIL field', () => {
  it('an add produces array old/new snapshots (new includes the added value)', async () => {
    const oldValue = [email('v1', 'a@example.com')]
    const newValue = [email('v1', 'a@example.com'), email('v2', 'b@example.com')]

    const { oldDisplay, newDisplay } = await resolveFieldChangeSnapshotPair(
      ctx,
      emailField,
      oldValue,
      newValue
    )

    expect(oldDisplay).toEqual([{ fieldType: 'EMAIL', text: 'a@example.com' }])
    expect(newDisplay).toEqual([
      { fieldType: 'EMAIL', text: 'a@example.com' },
      { fieldType: 'EMAIL', text: 'b@example.com' },
    ])
  })

  it('a remove produces array old/new snapshots (old keeps the removed value)', async () => {
    const oldValue = [email('v1', 'a@example.com'), email('v2', 'b@example.com')]
    const newValue = [email('v1', 'a@example.com')]

    const { oldDisplay, newDisplay } = await resolveFieldChangeSnapshotPair(
      ctx,
      emailField,
      oldValue,
      newValue
    )

    expect(oldDisplay).toEqual([
      { fieldType: 'EMAIL', text: 'a@example.com' },
      { fieldType: 'EMAIL', text: 'b@example.com' },
    ])
    expect(newDisplay).toEqual([{ fieldType: 'EMAIL', text: 'a@example.com' }])
  })

  it('clearing the field snapshots array → null (and vice versa on first write)', async () => {
    const values = [email('v1', 'a@example.com')]

    const cleared = await resolveFieldChangeSnapshotPair(ctx, emailField, values, [])
    expect(cleared.oldDisplay).toEqual([{ fieldType: 'EMAIL', text: 'a@example.com' }])
    expect(cleared.newDisplay).toBeNull()

    const firstWrite = await resolveFieldChangeSnapshotPair(ctx, emailField, null, values)
    expect(firstWrite.oldDisplay).toBeNull()
    expect(firstWrite.newDisplay).toEqual([{ fieldType: 'EMAIL', text: 'a@example.com' }])
  })

  it('slices oversized arrays to TIMELINE_SNAPSHOT_ARRAY_LIMIT', async () => {
    const values = Array.from({ length: TIMELINE_SNAPSHOT_ARRAY_LIMIT + 5 }, (_, i) =>
      email(`v${i}`, `user${i}@example.com`)
    )

    const { newDisplay } = await resolveFieldChangeSnapshotPair(ctx, emailField, null, values)

    expect(Array.isArray(newDisplay)).toBe(true)
    expect(newDisplay).toHaveLength(TIMELINE_SNAPSHOT_ARRAY_LIMIT)
    expect((newDisplay as Array<{ text: string }>)[0]?.text).toBe('user0@example.com')
  })
})

/**
 * Option fields (SINGLE_SELECT / MULTI_SELECT / TAGS) resolve through the shared
 * `resolveOptionId`, which matches BOTH keyspaces (`id` and `value`). D5: because
 * a snapshot is a write-time freeze with no chip to mute, an unresolvable id must
 * keep falling back to the denormalized `value.label`, then the raw id.
 */

const tagsField = {
  id: 'field-tags',
  type: 'TAGS',
  options: {
    options: [
      { value: 'V1StGXR8_Z5jdHi6Bmy', label: 'Enterprise', color: 'blue' },
      { id: 'opt-app-1', value: 'legacy-value', label: 'Provisioned', color: 'red' },
      { value: 'no-color', label: 'Plain' },
    ],
  },
} as unknown as CachedField

const option = (id: string, optionId: string, rest: Record<string, unknown> = {}) =>
  ({ id, type: 'option', optionId, ...rest }) as TypedFieldValue

describe('resolveFieldChangeSnapshotPair — option fields', () => {
  it('resolves an option keyed by `value` and freezes its label + color', async () => {
    const { newDisplay } = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'V1StGXR8_Z5jdHi6Bmy'),
    ])

    expect(newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'V1StGXR8_Z5jdHi6Bmy', label: 'Enterprise', color: 'blue' },
    ])
  })

  it('resolves an option keyed by its explicit `id` (app/connector-provisioned)', async () => {
    const { newDisplay } = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'opt-app-1'),
    ])

    expect(newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'opt-app-1', label: 'Provisioned', color: 'red' },
    ])
  })

  it('a stored `value` on an id-keyed option still resolves (tolerant read)', async () => {
    const { newDisplay } = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'legacy-value'),
    ])

    expect(newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'legacy-value', label: 'Provisioned', color: 'red' },
    ])
  })

  it('an unknown id falls back to the denormalized label, then to the raw id (D5)', async () => {
    const withLabel = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'gone-forever', { label: 'Deleted Tag', color: 'green' }),
    ])
    expect(withLabel.newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'gone-forever', label: 'Deleted Tag', color: 'green' },
    ])

    const bare = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'gone-forever'),
    ])
    expect(bare.newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'gone-forever', label: 'gone-forever' },
    ])
  })

  it('a matched option without a color falls back to the denormalized color', async () => {
    const { newDisplay } = await resolveFieldChangeSnapshotPair(ctx, tagsField, null, [
      option('v1', 'no-color', { color: 'purple' }),
    ])

    expect(newDisplay).toEqual([
      { fieldType: 'TAGS', optionId: 'no-color', label: 'Plain', color: 'purple' },
    ])
  })
})

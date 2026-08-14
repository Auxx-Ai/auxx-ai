// packages/lib/src/workflows/graph-edit/patch-config.ts

import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../../errors'

/** One unambiguous segment in an agent-visible node config path. */
export type ConfigPathSegment = string | number

/** Atomic deep edits accepted by `updateNode`. */
export type ConfigPatch =
  | { op: 'set'; path: ConfigPathSegment[]; value: unknown }
  | { op: 'unset'; path: ConfigPathSegment[] }

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const FORBIDDEN_ROOT_KEYS = new Set(['id', 'type'])

function own(record: object, key: PropertyKey): boolean {
  return Object.hasOwn(record, key)
}

function validatePath(path: ConfigPathSegment[]): Result<void, BadRequestError> {
  if (path.length === 0) return err(new BadRequestError('Patch path cannot be empty.'))

  for (const segment of path) {
    if (typeof segment !== 'string' && typeof segment !== 'number') {
      return err(new BadRequestError('Patch path segments must be field names or array indexes.'))
    }
    if (typeof segment === 'number') {
      if (!Number.isInteger(segment) || segment < 0) {
        return err(new BadRequestError(`Array index must be a non-negative integer: ${segment}`))
      }
      continue
    }
    if (!segment) return err(new BadRequestError('Patch path segments cannot be empty.'))
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return err(new BadRequestError(`Patch path segment "${segment}" is not allowed.`))
    }
  }

  const root = path[0]
  if (typeof root !== 'string') {
    return err(new BadRequestError('Patch paths must start with a config field name.'))
  }
  if (FORBIDDEN_ROOT_KEYS.has(root) || root.startsWith('_')) {
    return err(new BadRequestError(`Config field "${root}" cannot be patched.`))
  }
  return ok(undefined)
}

function descend(
  current: unknown,
  segment: ConfigPathSegment,
  path: ConfigPathSegment[]
): Result<unknown, BadRequestError> {
  const label = JSON.stringify(path)
  if (Array.isArray(current)) {
    if (typeof segment !== 'number') {
      return err(new BadRequestError(`Expected an array index at ${label}.`))
    }
    if (segment >= current.length) {
      return err(new BadRequestError(`Array index ${segment} is out of bounds at ${label}.`))
    }
    return ok(current[segment])
  }
  if (!current || typeof current !== 'object') {
    return err(new BadRequestError(`Patch parent does not exist at ${label}.`))
  }
  if (typeof segment !== 'string') {
    return err(new BadRequestError(`Expected an object field at ${label}.`))
  }
  if (!own(current, segment)) {
    return err(new BadRequestError(`Patch parent does not exist at ${label}.`))
  }
  return ok((current as Record<string, unknown>)[segment])
}

/**
 * Apply config patches to a clone. Parents must exist; `set` may create its
 * final object key, while arrays are replacement-only and never sparse.
 */
export function applyConfigPatches(
  config: Record<string, unknown>,
  patches: ConfigPatch[]
): Result<Record<string, unknown>, BadRequestError> {
  if (patches.length === 0) {
    return err(new BadRequestError('At least one config patch is required.'))
  }

  const next = structuredClone(config)
  for (const patch of patches) {
    if (
      !patch ||
      typeof patch !== 'object' ||
      (patch.op !== 'set' && patch.op !== 'unset') ||
      !Array.isArray(patch.path) ||
      (patch.op === 'set' && (!Object.hasOwn(patch, 'value') || patch.value === undefined))
    ) {
      return err(new BadRequestError('Each config patch must be a valid set or unset operation.'))
    }
    const valid = validatePath(patch.path)
    if (valid.isErr()) return err(valid.error)

    let parent: unknown = next
    for (let index = 0; index < patch.path.length - 1; index += 1) {
      const resolved = descend(parent, patch.path[index]!, patch.path.slice(0, index + 1))
      if (resolved.isErr()) return err(resolved.error)
      parent = resolved.value
    }

    const leaf = patch.path.at(-1)!
    const label = JSON.stringify(patch.path)
    if (Array.isArray(parent)) {
      if (typeof leaf !== 'number') {
        return err(new BadRequestError(`Expected an array index at ${label}.`))
      }
      if (leaf >= parent.length) {
        return err(new BadRequestError(`Array index ${leaf} is out of bounds at ${label}.`))
      }
      if (patch.op === 'unset') {
        return err(
          new BadRequestError(
            `Array entries cannot be unset at ${label}; replace the containing array instead.`
          )
        )
      }
      parent[leaf] = structuredClone(patch.value)
      continue
    }

    if (!parent || typeof parent !== 'object') {
      return err(new BadRequestError(`Patch parent does not exist at ${label}.`))
    }
    if (typeof leaf !== 'string') {
      return err(new BadRequestError(`Expected an object field at ${label}.`))
    }
    const record = parent as Record<string, unknown>
    if (patch.op === 'unset') {
      if (!own(record, leaf)) {
        return err(new BadRequestError(`Cannot unset missing config field at ${label}.`))
      }
      delete record[leaf]
    } else {
      record[leaf] = structuredClone(patch.value)
    }
  }
  return ok(next)
}

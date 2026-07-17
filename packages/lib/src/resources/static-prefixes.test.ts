// packages/lib/src/resources/static-prefixes.test.ts

import { describe, expect, it } from 'vitest'
import {
  isDynamicAliasPrefix,
  isStaticCanonicalDefinitionId,
  LEGACY_SYSTEM_TYPES,
  resolveStaticPrefix,
} from './static-prefixes'

describe('static prefix tier', () => {
  it('resolves legacy system names to themselves with no org data', () => {
    expect(resolveStaticPrefix('thread')).toBe('thread')
    expect(resolveStaticPrefix('message')).toBe('message')
    expect(resolveStaticPrefix('user')).toBe('user')
  })

  it('resolves legacy-type apiSlugs to their system name statically', () => {
    expect(resolveStaticPrefix('threads')).toBe('thread')
    expect(resolveStaticPrefix('messages')).toBe('message')
    expect(resolveStaticPrefix('users')).toBe('user')
  })

  it('does NOT resolve def-backed entityTypes — those are org-dynamic', () => {
    expect(resolveStaticPrefix('contact')).toBeUndefined()
    expect(resolveStaticPrefix('ticket')).toBeUndefined()
    expect(resolveStaticPrefix('work_order')).toBeUndefined()
  })

  it('classifies def-backed entityTypes and their apiSlugs as dynamic aliases', () => {
    expect(isDynamicAliasPrefix('contact')).toBe(true)
    expect(isDynamicAliasPrefix('contacts')).toBe(true)
    expect(isDynamicAliasPrefix('work_order')).toBe(true)
    // ModelTypeMeta apiSlugs are hyphenated; org DB slugs resolve dynamically
    expect(isDynamicAliasPrefix('work-orders')).toBe(true)
    // Legacy types are NOT dynamic aliases
    expect(isDynamicAliasPrefix('thread')).toBe(false)
    // Unknown strings are neither
    expect(isDynamicAliasPrefix('some_custom_slug')).toBe(false)
  })

  it('treats legacy names and long-form definition ids as statically canonical', () => {
    expect(isStaticCanonicalDefinitionId('thread')).toBe(true)
    expect(isStaticCanonicalDefinitionId('cm1234abc567def890ghij')).toBe(true)
    // Aliases are not canonical, whatever their length
    expect(isStaticCanonicalDefinitionId('contact')).toBe(false)
    expect(isStaticCanonicalDefinitionId('threads')).toBe(false)
    // Short unknown prefixes are not canonical
    expect(isStaticCanonicalDefinitionId('foo')).toBe(false)
  })

  it('legacy set excludes every def-backed type and the entity marker', () => {
    expect(LEGACY_SYSTEM_TYPES).not.toContain('entity')
    expect(LEGACY_SYSTEM_TYPES).not.toContain('contact')
    expect(LEGACY_SYSTEM_TYPES).not.toContain('work_order')
    expect(LEGACY_SYSTEM_TYPES).toContain('thread')
    expect(LEGACY_SYSTEM_TYPES).toContain('message')
  })
})

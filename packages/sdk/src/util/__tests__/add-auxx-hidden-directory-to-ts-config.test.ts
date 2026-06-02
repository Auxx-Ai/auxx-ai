// packages/sdk/src/util/__tests__/add-auxx-hidden-directory-to-ts-config.test.ts

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isComplete } from '../../errors.js'
import { addAuxxHiddenDirectoryToTsConfig } from '../add-auxx-hidden-directory-to-ts-config.js'

/**
 * The generated `.auxx/*.d.ts` type augmentations only reach the compiler when
 * `.auxx/**\/*` is on `include` — a bare `.auxx` entry silently loads nothing
 * (TypeScript skips dot-directories during include expansion). These tests lock
 * in that the helper writes the working glob and upgrades the legacy bare entry.
 */
describe('addAuxxHiddenDirectoryToTsConfig', () => {
  let dir: string
  let originalCwd: string
  let tsconfigPath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auxx-tsconfig-'))
    tsconfigPath = path.join(dir, 'tsconfig.json')
    originalCwd = process.cwd()
    process.chdir(dir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function readInclude(): Promise<string[]> {
    return JSON.parse(await fs.readFile(tsconfigPath, 'utf8')).include
  }

  it('adds the .auxx/**/* glob when absent', async () => {
    await fs.writeFile(tsconfigPath, JSON.stringify({ include: ['src'] }))
    const result = await addAuxxHiddenDirectoryToTsConfig()
    expect(isComplete(result) && result.value).toBe(true)
    expect(await readInclude()).toEqual(['src', '.auxx/**/*'])
  })

  it('upgrades a legacy bare ".auxx" entry to the working glob', async () => {
    await fs.writeFile(tsconfigPath, JSON.stringify({ include: ['src', '.auxx'] }))
    const result = await addAuxxHiddenDirectoryToTsConfig()
    expect(isComplete(result) && result.value).toBe(true)
    const include = await readInclude()
    expect(include).toContain('.auxx/**/*')
    expect(include).not.toContain('.auxx')
  })

  it('is idempotent once the glob is present', async () => {
    await fs.writeFile(tsconfigPath, JSON.stringify({ include: ['src', '.auxx/**/*'] }))
    const result = await addAuxxHiddenDirectoryToTsConfig()
    expect(isComplete(result) && result.value).toBe(false)
    expect(await readInclude()).toEqual(['src', '.auxx/**/*'])
  })
})

#!/usr/bin/env node
// apps/extension/scripts/package.mjs
//
// Bundle the production build into a Chrome Web Store-ready zip.
//
//   - manifest.json lands at the zip root (zips dist/ contents, not dist/ itself)
//   - source maps excluded (the store warns on shipped maps; ~3x size reduction)
//   - macOS / git noise excluded
//   - Dev-only manifest entries are stripped from the zipped manifest while
//     left intact in the source manifest so `pnpm dev` keeps working:
//       - "key" field (the store rejects uploads that include it)
//       - http://localhost entries in host_permissions, externally_connectable,
//         and content_security_policy.frame-src (the store only accepts
//         https URLs in production manifests)
//     dist/manifest.json is restored after zipping so the unpacked dist
//     stays loadable for local dev.
//
// Run `pnpm package` (which builds first), then upload the produced
// auxx-extension-v<version>.zip in the dev console.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const manifestPath = join(distDir, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('No dist/manifest.json — run `pnpm build` first.')
  process.exit(1)
}

const originalManifest = readFileSync(manifestPath, 'utf8')
const parsed = JSON.parse(originalManifest)
const { version } = parsed
const outName = `auxx-extension-v${version}.zip`
const outPath = join(root, outName)

if (existsSync(outPath)) unlinkSync(outPath)

const stripped = stripDevOnly(parsed)
writeFileSync(manifestPath, `${JSON.stringify(stripped, null, 2)}\n`)

try {
  execSync(`zip -rq "${outPath}" . -x "*.map" "**/.DS_Store" "**/.git/*"`, {
    cwd: distDir,
    stdio: 'inherit',
  })
} finally {
  writeFileSync(manifestPath, originalManifest)
}

const sizeMb = (statSync(outPath).size / 1024 / 1024).toFixed(2)
console.log(`${outName}  ${sizeMb} MB`)

/**
 * Remove fields and URL entries that are valid in dev but rejected by the
 * Chrome Web Store: the manifest "key" field and any http://localhost(...)
 * URL appearing in host_permissions, externally_connectable.matches, or the
 * extension_pages CSP. Returns a new object; the caller serializes it.
 */
function stripDevOnly(manifest) {
  const m = { ...manifest }
  delete m.key

  if (Array.isArray(m.host_permissions)) {
    m.host_permissions = m.host_permissions.filter((p) => !p.startsWith('http://'))
  }

  if (m.externally_connectable && Array.isArray(m.externally_connectable.matches)) {
    m.externally_connectable = {
      ...m.externally_connectable,
      matches: m.externally_connectable.matches.filter((p) => !p.startsWith('http://')),
    }
  }

  if (m.content_security_policy && typeof m.content_security_policy.extension_pages === 'string') {
    const stripped = m.content_security_policy.extension_pages
      // Drop any localhost URL token (with optional leading space).
      .replace(/\s?https?:\/\/localhost(:\d+)?(\/[^\s;]*)?/g, '')
      // Collapse repeated whitespace and tidy up "  ;".
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+;/g, ';')
      .trim()
    m.content_security_policy = {
      ...m.content_security_policy,
      extension_pages: stripped,
    }
  }

  return m
}

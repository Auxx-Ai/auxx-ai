// apps/chat-widget/scripts/copy-to-web-public.mjs

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '..', 'dist', 'chat-widget.js')
const target = resolve(here, '..', '..', 'web', 'public', 'scripts', 'chat-widget.js')

if (!existsSync(source)) {
  console.error(`[chat-widget] build artifact missing: ${source}`)
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`[chat-widget] copied → ${target}`)

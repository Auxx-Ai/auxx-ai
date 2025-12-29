#!/usr/bin/env node

/**
 * Strips JavaScript implementations from client and server SDK modules.
 *
 * This script runs after TypeScript compilation and replaces all .js files
 * in lib/client and lib/server with empty exports, while keeping the .d.ts
 * files intact. This ensures the published package contains only type
 * definitions, with implementations provided by the platform at runtime.
 *
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(__dirname, '..', 'lib')

// Directories to strip implementations from
const DIRS_TO_STRIP = ['client', 'server']

// Template for empty JS files
const EMPTY_JS_TEMPLATE = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Implementation stripped - provided by runtime
`

/**
 * Recursively processes a directory and strips all .js files
 */
async function stripDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      await stripDirectory(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      // Don't touch source map files
      if (entry.name.endsWith('.js.map')) continue

      await fs.writeFile(fullPath, EMPTY_JS_TEMPLATE)
      console.log(`  ✓ Stripped: ${path.relative(libDir, fullPath)}`)
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 Stripping SDK implementations...\n')

  for (const dir of DIRS_TO_STRIP) {
    const dirPath = path.join(libDir, dir)

    try {
      await fs.access(dirPath)
      console.log(`📁 Processing ${dir}/`)
      await stripDirectory(dirPath)
      console.log()
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`⚠️  Directory not found: ${dir}/ (skipping)`)
      } else {
        throw error
      }
    }
  }

  console.log('✅ Implementation stripping complete!')
  console.log('   Published package will contain types only.')
}

main().catch((error) => {
  console.error('❌ Error stripping implementations:', error)
  process.exit(1)
})

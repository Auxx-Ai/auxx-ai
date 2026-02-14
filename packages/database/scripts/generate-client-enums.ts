// packages/database/scripts/generate-client-enums.ts
// Reads src/db/schema/_shared.ts and generates client-safe enums in:
// - src/enums.ts: const <EnumName>Values = [...] as const
// - src/types.ts: export type <EnumName> = (typeof <EnumName>Values)[number]

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PKG_ROOT = path.resolve(__dirname, '..')
const SHARED_PATH = path.resolve(PKG_ROOT, 'src', 'db', 'schema', '_shared.ts')
const OUT_ENUMS = path.resolve(PKG_ROOT, 'src', 'enums.ts')
const OUT_TYPES = path.resolve(PKG_ROOT, 'src', 'types.ts')

type EnumDef = { varName: string; enumName: string; values: string[] }

function parseEnums(source: string): EnumDef[] {
  const defs: EnumDef[] = []
  // export const <var> = pgEnum("<EnumName>", [ 'A', 'B', ... ])
  const re =
    /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*pgEnum\(\s*["']([A-Za-z0-9_]+)["']\s*,\s*\[((?:.|\n|\r)*?)\]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const varName = m[1]
    const enumName = m[2]
    const arrayBody = m[3]
    const values: string[] = []
    const itemRe = /'([^']*)'/g
    let im: RegExpExecArray | null
    while ((im = itemRe.exec(arrayBody)) !== null) values.push(im[1])
    defs.push({ varName, enumName, values })
  }
  return defs
}

function makeEnumsTs(defs: EnumDef[]): string {
  const header =
    `// packages/database/src/enums.ts\n` +
    `// Client-safe enum values generated from Drizzle enums\n\n`
  const lines: string[] = [header]

  // Generate Values arrays (existing functionality)
  for (const d of defs) {
    const arrLiteral = `[${d.values.map((v) => `'${v}'`).join(', ')}] as const`
    lines.push(`export const ${d.enumName}Values = ${arrLiteral}\n`)
  }

  // Add enum objects section
  lines.push(`
// ============================================================================
// ENUM OBJECTS - Can be used both as types and values on client-side
// ============================================================================

`)

  // Generate static enum objects
  for (const d of defs) {
    const enumEntries = d.values.map((value) => `  ${value}: '${value}'`).join(',\n')
    lines.push(`export const ${d.enumName} = {\n${enumEntries}\n} as const\n`)
  }

  return lines.join('\n')
}

function makeTypesTs(defs: EnumDef[]): string {
  const header =
    `// packages/database/src/types.ts\n` +
    `// Client-safe enum types generated from Drizzle enums\n\n` +
    `import * as Enums from './enums'\n\n`
  const lines: string[] = [header]
  for (const d of defs) {
    lines.push(`export type ${d.enumName} = (typeof Enums.${d.enumName}Values)[number]\n`)
  }
  return lines.join('\n')
}

function run() {
  const src = fs.readFileSync(SHARED_PATH, 'utf-8')
  const defs = parseEnums(src)
  if (!defs.length) {
    console.error('No enums found in _shared.ts')
    process.exit(1)
  }
  fs.writeFileSync(OUT_ENUMS, makeEnumsTs(defs))
  fs.writeFileSync(OUT_TYPES, makeTypesTs(defs))
  console.log(`✅ Generated ${defs.length} enums to src/enums.ts and src/types.ts`)
}

run()

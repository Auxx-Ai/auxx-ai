// packages/database/scripts/split-schema.ts
// Script to split drizzle-generated schema.ts into per-table files under src/db/schema
// - Creates _shared.ts with base drizzle exports and all pgEnum declarations
// - Creates one file per table with kebab-case filename
// - Removes foreignKey() constraints from table definitions to avoid cross-file cycles
// - Generates a barrel index.ts re-exporting tables and shared enums

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DRIZZLE_SCHEMA = path.resolve(ROOT, 'drizzle', 'schema.ts')
const TARGET_DIR = path.resolve(ROOT, 'src', 'db', 'schema')

const PRESERVED_OPERATOR_CLASSES = new Set([
  'vector_l2_ops',
  'vector_ip_ops',
  'vector_cosine_ops',
  'vector_l1_ops',
  'bit_hamming_ops',
  'bit_jaccard_ops',
  'halfvec_l2_ops',
  'sparsevec_l2_ops',
])

/** Strip explicit operator-class decorators like .op('text_ops') while preserving required ones */
function sanitizeOperatorClasses(content: string): string {
  return content.replace(/\.op\(\s*['"]([^'"\n]+)['"]\s*\)/g, (match, op) => {
    return PRESERVED_OPERATOR_CLASSES.has(op) ? match : ''
  })
}

/** Convert a camelCase or PascalCase identifier to kebab-case */
function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

/** Ensure a directory exists */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** Extract enums and tables from schema.ts */
function splitSchema(source: string) {
  const lines = source.split(/\r?\n/)

  // Capture top-level imports to replicate shared exports
  const importLine = lines.find((l) => l.includes('from "drizzle-orm/pg-core"')) || ''
  const importSqlLine = lines.find((l) => l.includes('from "drizzle-orm"')) || ''

  // Gather all pgEnum declarations
  const enumBlocks: string[] = []
  const enumNames: string[] = []
  const enumRegex = /export const\s+([a-zA-Z0-9_]+)\s*=\s*pgEnum\([\s\S]*?\)\n/g
  let enumMatch: RegExpExecArray | null
  while ((enumMatch = enumRegex.exec(source)) !== null) {
    enumBlocks.push(enumMatch[0].trim())
    enumNames.push(enumMatch[1])
  }

  // Build a map of original varName -> table name string in pgTable('...')
  const nameMap = new Map<string, string>()
  const nmRe = /export const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\(\s*["']([^"']+)["']/g
  let nm: RegExpExecArray | null
  while ((nm = nmRe.exec(source)) !== null) {
    nameMap.set(nm[1], nm[2])
  }

  // Extract table blocks by tracking parentheses after pgTable(
  const tableBlocks: { name: string; code: string }[] = []
  const tableStartRegex = /export const\s+([a-zA-Z0-9_]+)\s*=\s*pgTable\(/g
  let match: RegExpExecArray | null
  while ((match = tableStartRegex.exec(source)) !== null) {
    const name = match[1]
    const start = match.index
    // Move idx to after 'pgTable('
    const idx = source.indexOf('pgTable(', start) + 'pgTable('.length
    let depth = 1 // already inside one '('
    let i = idx
    // Find the matching closing ')', then expect a semicolon
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    // Include trailing ';' and any newline
    while (i < source.length && source[i] !== '\n') i++
    const code = source.slice(start, i).trim()
    tableBlocks.push({ name, code })
  }

  return { importLine, importSqlLine, enumBlocks, enumNames, tableBlocks, nameMap }
}

/** Remove foreignKey(...) constraint entries from the table definition array */
// Convert foreignKey blocks to column-level lazy references where possible
function transformToColumnRefs(
  code: string,
  selfName: string
): { code: string; referenced: string[] } {
  const referenced = new Set<string>()

  // Locate columns object: pgTable("Name", { ...columns... }, (table) => [ ... ])
  const tableArgsStart = code.indexOf('pgTable(')
  if (tableArgsStart === -1) return { code, referenced: [] }

  // Find first '{' after pgTable( — start of columns object
  const colsObjStart = code.indexOf('{', tableArgsStart)
  if (colsObjStart === -1) return { code, referenced: [] }
  // Walk to find the matching '}' of the columns object
  let i = colsObjStart + 1
  let depth = 1
  while (i < code.length && depth > 0) {
    const ch = code[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  const colsObjEnd = i - 1
  const colsObj = code.slice(colsObjStart, colsObjEnd + 1)

  // Find constraints array start ", (table) => ["
  const constrStart = code.indexOf(', (table) => [', colsObjEnd + 1)
  if (constrStart === -1) return { code, referenced: [] }
  let j = constrStart + ', (table) => ['.length
  let arrDepth = 1
  const arrStart = j
  while (j < code.length && arrDepth > 0) {
    const ch = code[j]
    if (ch === '[') arrDepth++
    else if (ch === ']') arrDepth--
    j++
  }
  const arrEnd = j - 1
  const arrContent = code.slice(arrStart, arrEnd)

  // Parse foreignKey entries
  type FK = {
    column: string
    targetTable: string
    onUpdate?: string
    onDelete?: string
    raw: string
  }
  const fks: FK[] = []
  const fkRegex =
    /foreignKey\(\{[\s\S]*?columns:\s*\[\s*table\.([A-Za-z_][A-Za-z0-9_]*)\s*\][\s\S]*?foreignColumns:\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\][\s\S]*?\}\)(?:\.onUpdate\("([a-zA-Z_]+)"\))?(?:\.onDelete\("([a-zA-Z_]+)"\))?/g
  let m: RegExpExecArray | null
  while ((m = fkRegex.exec(arrContent)) !== null) {
    const [raw, col, targetTable, targetCol, onUpdate, onDelete] = m
    // Only convert simple single-column FKs to the id column
    if (targetCol === 'id') {
      const target = targetTable === 'table' ? selfName : targetTable
      fks.push({ column: col, targetTable: target, onUpdate, onDelete, raw })
      if (target !== selfName) referenced.add(target)
    }
  }

  if (fks.length === 0) return { code, referenced: [] }

  // Update columns object definitions by appending .references(() => target.id, { ... })
  function injectRefIntoProp(
    obj: string,
    column: string,
    targetTable: string,
    onUpdate?: string,
    onDelete?: string
  ) {
    const key = new RegExp(`\\b${column}\\s*:`)
    const m = obj.match(key)
    if (!m) return obj
    const start = (m.index || 0) + m[0].length
    // scan to find end comma for this property
    let idx = start
    let p = 0,
      b = 0,
      s = 0
    while (idx < obj.length) {
      const ch = obj[idx]
      if (ch === '(') p++
      else if (ch === ')') p = Math.max(0, p - 1)
      else if (ch === '{') b++
      else if (ch === '}') b = Math.max(0, b - 1)
      else if (ch === '[') s++
      else if (ch === ']') s = Math.max(0, s - 1)
      if (ch === ',' && p === 0 && b === 0 && s === 0) break
      idx++
    }
    const before = obj.slice(0, start)
    const value = obj.slice(start, idx)
    const after = obj.slice(idx)
    if (value.includes('references(')) return obj
    const opts: string[] = []
    if (onUpdate) opts.push(`onUpdate: '${onUpdate}'`)
    if (onDelete) opts.push(`onDelete: '${onDelete}'`)
    const optStr = opts.length ? `, { ${opts.join(', ')} }` : ''
    const injectedVal = `${value}.references((): AnyPgColumn => ${targetTable}.id${optStr})`
    return before + injectedVal + after
  }

  let newColsObj = colsObj
  for (const fk of fks) {
    newColsObj = injectRefIntoProp(newColsObj, fk.column, fk.targetTable, fk.onUpdate, fk.onDelete)
  }

  // Clean array content: remove converted foreignKey(...) blocks
  let newArrContent = arrContent
  for (const fk of fks) {
    // remove the exact raw snippet plus optional trailing comma and newline
    const escaped = fk.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const removeRegex = new RegExp(`\\s*${escaped}s*,?`)
    newArrContent = newArrContent.replace(removeRegex, '')
  }
  // Remove any remaining single-column FK entries just in case
  newArrContent = newArrContent.replace(
    /\s*foreignKey\(\{[\s\S]*?columns:\s*\[\s*table\.[A-Za-z_][A-Za-z0-9_]*\s*\][\s\S]*?foreignColumns:\s*\[\s*[A-Za-z_][A-Za-z0-9_]*\.id\s*\][\s\S]*?\}\)(?:\.[a-zA-Z]+\("[^"]*"\))*\s*,?/g,
    ''
  )
  // Remove any stray .onUpdate/.onDelete left behind
  newArrContent = newArrContent.replace(/\s*\.(?:onUpdate|onDelete)\("[^"]*"\)\s*,?/g, '')
  // Squash extra commas and blank lines
  newArrContent = newArrContent.replace(/,\s*,/g, ',').replace(/\n\s*\n/g, '\n')

  // Build new code
  const beforeCols = code.slice(0, colsObjStart)
  const afterCols = code.slice(colsObjEnd + 1, arrStart)
  const afterArr = code.slice(arrEnd)
  const newCode = beforeCols + newColsObj + afterCols + newArrContent + afterArr

  return { code: newCode, referenced: Array.from(referenced) }
}

function run() {
  ensureDir(TARGET_DIR)

  const source = fs.readFileSync(DRIZZLE_SCHEMA, 'utf-8')
  const sanitizedSource = sanitizeOperatorClasses(source)
  if (sanitizedSource !== source) {
    fs.writeFileSync(DRIZZLE_SCHEMA, sanitizedSource)
  }
  const { importLine, importSqlLine, enumBlocks, enumNames, tableBlocks, nameMap } =
    splitSchema(sanitizedSource)

  // Build _shared.ts with base exports and enums
  const sharedPath = path.join(TARGET_DIR, '_shared.ts')
  const sharedHeader =
    `// packages/database/src/db/schema/_shared.ts\n` +
    `// Shared Drizzle exports and enums (generated by scripts/split-schema.ts)\n\n`

  // Normalize import list to only the identifiers (between { ... })
  const importMatch = importLine.match(/\{([\s\S]*?)\}/)
  const imports = importMatch
    ? importMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const uniqueImports = Array.from(new Set(imports))
  // Ensure uncommon builders used by introspection are available
  if (!uniqueImports.includes('pgEnum')) uniqueImports.push('pgEnum')
  if (!uniqueImports.includes('unknown')) uniqueImports.push('unknown')
  if (!uniqueImports.includes('AnyPgColumn')) uniqueImports.push('AnyPgColumn')

  // Ensure pgEnum is available locally to declare enums
  // Keep pgEnum/unknown imports for enum declarations and custom types
  const sharedExports = [
    sharedHeader,
    `import { ${uniqueImports.join(', ')} } from 'drizzle-orm/pg-core'\n`,
    `import { sql } from 'drizzle-orm'\n`,
    '\n',
    '// ---- Enums ----\n',
    ...enumBlocks.map((b) => b + '\n'),
    '\n',
    '// Re-export builders and sql for consumers\n',
    `export { ${uniqueImports.join(', ')} } from 'drizzle-orm/pg-core'\n`,
    `export { sql } from 'drizzle-orm'\n`,
  ].join('')
  fs.writeFileSync(sharedPath, sharedExports)

  // Generate per-table files
  const indexExports: string[] = []
  // Helper: detect which identifiers are used in a table block
  const builderIdents = new Set<string>([
    'pgTable',
    'uniqueIndex',
    'index',
    'text',
    'bigint',
    'boolean',
    'timestamp',
    'integer',
    'jsonb',
    'varchar',
    'vector',
    'doublePrecision',
    'bigserial',
    'date',
    'primaryKey',
    'unknown',
    'AnyPgColumn',
  ])
  function detectUsedIdents(code: string) {
    const used = new Set<string>()
    // Always need pgTable
    used.add('pgTable')
    // Simple heuristic: if the identifier appears as a function call or property, include it
    for (const ident of builderIdents) {
      if (code.includes(ident + '(') || code.includes('.' + ident)) used.add(ident)
    }
    if (code.includes('sql`') || code.includes(' sql`')) used.add('sql')
    if (code.includes('foreignKey(')) used.add('foreignKey')
    // References need AnyPgColumn type
    if (code.includes('.references(')) used.add('AnyPgColumn')
    // Index helpers
    if (code.includes('uniqueIndex(')) used.add('uniqueIndex')
    if (code.includes('index(')) used.add('index')
    return Array.from(used)
  }

  // Helper: detect referenced table names in foreign key declarations
  function detectReferencedTables(code: string, selfName: string): string[] {
    const names = new Set<string>()
    const fkRegex = /foreignColumns:\s*\[\s*([\s\S]*?)\s*\]/g
    let m: RegExpExecArray | null
    while ((m = fkRegex.exec(code)) !== null) {
      const inner = m[1]
      const parts = inner.split(',')
      for (const p of parts) {
        const mm = p.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.id\b/)
        if (mm) {
          const t = mm[1]
          if (t !== 'table' && t !== selfName) names.add(t)
        }
      }
    }
    return Array.from(names)
  }

  for (const { name, code } of tableBlocks) {
    const outName = nameMap.get(name) || name
    const kebab = toKebab(outName)
    const filePath = path.join(TARGET_DIR, `${kebab}.ts`)
    const header =
      `// packages/database/src/db/schema/${kebab}.ts\n` +
      `// Drizzle table: ${name} (generated by scripts/split-schema.ts)\n\n`

    // Convert FK blocks to column-level lazy references
    let { code: codeWithRefs, referenced: refs } = transformToColumnRefs(code, name)

    // Remove explicit operator classes to let Postgres pick defaults
    codeWithRefs = sanitizeOperatorClasses(codeWithRefs)

    // Replace default(sql`CURRENT_TIMESTAMP`) with defaultNow()
    codeWithRefs = codeWithRefs.replace(
      /\.default\s*\(\s*sql`CURRENT_TIMESTAMP`\s*\)/g,
      '.defaultNow()'
    )
    // Remove mode: 'string' from timestamp field definitions
    codeWithRefs = codeWithRefs.replace(
      /timestamp\(\s*\{([^}]*)\}\s*\)/g,
      (match, optionsContent) => {
        // Remove mode: 'string' from the options object content
        const cleanOptionsContent = optionsContent
          .replace(/,\s*mode:\s*['"]string['"]/, '') // Remove ", mode: 'string'"
          .replace(/mode:\s*['"]string['"]\s*,/, '') // Remove "mode: 'string',"
          .replace(/mode:\s*['"]string['"]/, '') // Remove "mode: 'string'" when it's the only property
          .trim()

        // If options content becomes empty, remove options entirely
        if (cleanOptionsContent === '') {
          return 'timestamp()'
        }
        return `timestamp({ ${cleanOptionsContent} })`
      }
    )
    // Handle named timestamp fields like timestamp("field_name", { ... })
    codeWithRefs = codeWithRefs.replace(
      /timestamp\(\s*['"]([^'"]+)['"]\s*,\s*\{([^}]*)\}\s*\)/g,
      (match, fieldName, optionsContent) => {
        // Remove mode: 'string' from the options object content
        const cleanOptionsContent = optionsContent
          .replace(/,\s*mode:\s*['"]string['"]/, '') // Remove ", mode: 'string'"
          .replace(/mode:\s*['"]string['"]\s*,/, '') // Remove "mode: 'string',"
          .replace(/mode:\s*['"]string['"]/, '') // Remove "mode: 'string'" when it's the only property
          .trim()

        // If options content becomes empty, remove options entirely
        if (cleanOptionsContent === '') {
          return `timestamp('${fieldName}')`
        }
        return `timestamp('${fieldName}', { ${cleanOptionsContent} })`
      }
    )
    // Replace unknown('<name>') with text('<name>') to avoid runtime missing builder
    codeWithRefs = codeWithRefs.replace(/\bunknown\(\s*(["'])[^"']+\1\s*\)/g, (m) => {
      const name = m.match(/unknown\(\s*(["'])([^"']+)\1\s*\)/)
      return name ? `text('${name[2]}')` : m
    })
    // Inject runtime cuid default for text primary keys named "id"
    let needsCreateId = false
    if (
      /\bid:\s*text\(\)/.test(codeWithRefs) &&
      /\bid:\s*text\(\)[^\n]*?\.primaryKey\(\)/.test(codeWithRefs)
    ) {
      if (!/\bid:\s*text\(\)[^\n]*?\$defaultFn\(/.test(codeWithRefs)) {
        codeWithRefs = codeWithRefs.replace(
          /\bid:\s*text\(\)/,
          'id: text().$defaultFn(() => createId())'
        )
        needsCreateId = true
      }
    }
    // Rename referenced identifiers to exported names (PascalCase)
    for (const r of refs) {
      const exported = nameMap.get(r) || r
      if (exported !== r) {
        const re = new RegExp(`\\b${r}\\b`, 'g')
        codeWithRefs = codeWithRefs.replace(re, exported)
      }
    }
    // Rename referenced identifiers (including self) to exported PascalCase names
    const allToRename = Array.from(new Set([name, ...refs]))
    for (const id of allToRename) {
      const exported = nameMap.get(id) || id
      if (exported !== id) {
        const re = new RegExp(`\\b${id}\\b`, 'g')
        codeWithRefs = codeWithRefs.replace(re, exported)
      }
    }

    const usedBuilders = detectUsedIdents(codeWithRefs)
    const usedEnums = enumNames.filter((en) => codeWithRefs.includes(en + '()'))
    const importIdents = Array.from(new Set([...usedBuilders, ...usedEnums]))
    const importFromShared = `import { ${importIdents.join(', ')} } from './_shared'\n`
    const extraImport = needsCreateId ? `import { createId } from '@paralleldrive/cuid2'\n` : ''
    const refImports = Array.from(new Set(refs.map((r) => nameMap.get(r) || r)))
      .map((exported) => `import { ${exported} } from './${toKebab(exported)}'`)
      .join('\n')
    const importsBlock =
      importFromShared + extraImport + (refImports ? `\n${refImports}\n\n` : '\n')
    const doc = `/** Drizzle table for ${name} */\n`
    const renamed = codeWithRefs.replace(
      new RegExp(`export\\s+const\\s+${name}\\s*=`),
      `export const ${outName} =`
    )
    const body = renamed + '\n'

    fs.writeFileSync(filePath, header + importsBlock + doc + body)
    indexExports.push(`export * from './${kebab}'`)
  }

  // Create index.ts barrel
  const indexPath = path.join(TARGET_DIR, 'index.ts')
  const indexHeader =
    `// packages/database/src/db/schema/index.ts\n` +
    `// Barrel exports for schema tables and shared enums\n\n`
  const indexContent = [
    indexHeader,
    `export * from './_shared'\n`,
    ...indexExports.map((l) => l + '\n'),
  ].join('')
  fs.writeFileSync(indexPath, indexContent)

  console.log(`✅ Split ${tableBlocks.length} tables into ${TARGET_DIR}`)
}

run()

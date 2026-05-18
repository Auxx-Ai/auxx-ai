// packages/lib/src/prompt-templates/compile-md-template.ts

import type { DocJSON } from '../kb/markdown'
import { mdToBlocks } from '../kb/markdown'
import type { PromptTemplateDefinition } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Compiles a system-template `.md` source file into a `PromptTemplateDefinition`.
 *
 * Format:
 * - YAML-ish frontmatter for metadata (flat scalar keys; `categories` is a
 *   comma-separated list; `iconId` + `iconColor` collapse into `icon`).
 * - Markdown body is parsed by `mdToBlocks` (`@auxx/lib/kb/markdown`),
 *   yielding the KB block schema the persona editor reads/writes.
 *
 * Validation throws at module-eval so a malformed file fails the build of
 * any app that imports `@auxx/lib/prompt-templates`.
 */
export function compileMdTemplate(raw: string): PromptTemplateDefinition {
  const { body, fields } = parseTemplateFrontmatter(raw)
  const definition: PromptTemplateDefinition = {
    id: fields.id,
    name: fields.name,
    description: fields.description,
    categories: fields.categories,
    icon: fields.icon,
    prompt: { type: 'doc', content: mdToBlocks(body) } as DocJSON,
  }
  assertValidTemplate(definition)
  return definition
}

interface TemplateFields {
  id: string
  name: string
  description: string
  categories: string[]
  icon: { iconId: string; color: string }
}

function parseTemplateFrontmatter(raw: string): { body: string; fields: TemplateFields } {
  const m = (raw ?? '').match(FRONTMATTER_RE)
  if (!m) {
    throw new Error('Prompt template is missing frontmatter (---) block')
  }
  const body = raw.slice(m[0].length)
  const map = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    map.set(kv[1]!.toLowerCase(), trimYamlValue(kv[2]!))
  }
  const id = map.get('id') ?? ''
  const name = map.get('name') ?? ''
  const description = map.get('description') ?? ''
  const categoriesRaw = map.get('categories') ?? ''
  const categories = categoriesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const iconId = map.get('iconid') ?? ''
  const iconColor = map.get('iconcolor') ?? 'gray'
  return {
    body,
    fields: {
      id,
      name,
      description,
      categories,
      icon: { iconId, color: iconColor },
    },
  }
}

function trimYamlValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function assertValidTemplate(t: PromptTemplateDefinition): void {
  if (!t.id) throw new Error('Prompt template missing `id`')
  if (!t.name) throw new Error(`Prompt template "${t.id}" missing \`name\``)
  if (!t.description) throw new Error(`Prompt template "${t.id}" missing \`description\``)
  if (!Array.isArray(t.categories) || t.categories.length === 0) {
    throw new Error(`Prompt template "${t.id}" missing \`categories\``)
  }
  if (!t.icon.iconId) throw new Error(`Prompt template "${t.id}" missing \`iconId\``)
  if (!t.prompt || !Array.isArray(t.prompt.content) || t.prompt.content.length === 0) {
    throw new Error(`Prompt template "${t.id}" has empty prompt body`)
  }
}

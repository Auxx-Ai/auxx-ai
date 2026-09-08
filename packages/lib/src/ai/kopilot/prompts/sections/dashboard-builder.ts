// packages/lib/src/ai/kopilot/prompts/sections/dashboard-builder.ts

/**
 * System-prompt section for the `dashboard.builder` capability
 * (`plans/dashboard/v3/02-kopilot-capability.md` §4). Delivered through the
 * capability's `systemPromptAddition`, NOT the master prompt-section registry,
 * so it only renders when the dashboard tools are actually mounted.
 *
 * Teaches only what the tools cannot express: where edits go, how a widget is
 * addressed, the build order that works, the name-not-id rule, the filter
 * grammar with its date trap, and what is deliberately not available.
 *
 * Composable and gated on `toolNames` wherever it names a tool, so a filtered
 * runtime never produces prose about tools that are not there.
 */

import type { SystemPromptAdditionContext } from '../../capabilities/types'

/** Build the dashboard-builder prompt addition for the resolved tool set. */
export function buildDashboardBuilderPromptSection({
  toolNames,
}: SystemPromptAdditionContext): string {
  const has = (name: string) => toolNames.has(name)
  const hasAnyWrite = [
    'add_widget',
    'update_widget',
    'change_widget_type',
    'arrange_widgets',
    'delete_widgets',
    'add_tab',
    'update_tab',
    'delete_tab',
    'set_global_filters',
    'replace_layout',
  ].some(has)
  const hasAny = hasAnyWrite || ['get_dashboard', 'get_widget', 'preview_widget'].some(has)
  if (!hasAny) return ''

  const lines: string[] = []

  // 1. Subject.
  lines.push(
    'The user is viewing ONE dashboard. Every tool here acts on that dashboard: it is taken from the page and is never an argument, so you never pass a dashboard id or name. If the user asks you to build or edit a different dashboard, say plainly that you can only work on the open one and they should open that dashboard first.'
  )

  // 2. The draft/publish split. Stated explicitly, or the model reports work as
  // live.
  if (hasAnyWrite) {
    lines.push(
      'Every edit goes to the DRAFT and auto-saves as you make it. NOTHING you change is visible to other members until the USER publishes, in the editor. You cannot publish. After editing, say what you changed and that they can review it and publish when ready; never say the dashboard is live or that other people can now see it.'
    )
  }

  // 3. Addressing.
  lines.push(
    'Address widgets and tabs by TITLE, exactly as the tools return them. Every read and write hands back the title to use next. A unique title prefix works; an ambiguous one is refused with the candidates listed, so pick distinct titles when you create widgets.'
  )

  // 4. No coordinates.
  if (hasAnyWrite) {
    lines.push(
      has('arrange_widgets')
        ? 'Do NOT send coordinates. Placement is automatic on every tool but `arrange_widgets`, and that one is only for when the user asks for a specific arrangement.'
        : 'Do NOT send coordinates. Placement is automatic.'
    )
  }

  // 5. The build order that actually works.
  const order = [
    has('list_dashboard_sources') ? '`list_dashboard_sources` to pick the source' : null,
    '`list_entity_fields` with that source name to get its fields and its option value keys',
    has('describe_widget_kind')
      ? '`describe_widget_kind` to see what the kind needs before it renders and before it can be published'
      : null,
    has('preview_widget') ? '`preview_widget` with an inline config to check the numbers' : null,
    has('add_widget') ? '`add_widget` to commit it' : null,
  ].filter((step): step is string => step !== null)
  if (order.length > 1) {
    lines.push(`Build a widget in this order: ${order.join(', then ')}.`)
  }
  if (has('preview_widget')) {
    lines.push(
      'PREVIEW BEFORE YOU COMMIT, and preview again before you tell the user a chart is done. A misconfigured chart does not fail: it renders with wrong or empty numbers and every write reports success. `preview_widget` runs the real query and returns the real rows, and it takes an inline config so you can check a chart before it exists. One bucket, all zeros, or fifty groups of one all mean the configuration is wrong.'
    )
  }

  // 6. Names, never ids.
  lines.push(
    "Write NAMES, never ids. Sources are the `name` values from `list_dashboard_sources`; fields are the labels or keys `list_entity_fields` returns. The server resolves them against that widget's own source, which is also why a field must belong to the widget's source: name a field of another entity and the write is refused. Never invent or construct an id like `defId:fieldId`, and never guess a source slug."
  )

  // 7. Filter grammar, with the date trap spelled out.
  lines.push(
    'Filters use the same operator grammar as `query_records`, as a flat list of `{ field, operator, value }` plus an optional `filterMatch` of "all" (default) or "any". Select values may be written as the label or the option key; anything that matches neither is refused rather than saved, because a filter the query builder cannot compile is dropped silently and the widget would then show UNFILTERED data while reporting the filter as applied.'
  )
  lines.push(
    'Date filters: "in the last N days" is the `within_days` operator with a NUMBER (e.g. 30); `before`/`after`/`on_date` take an absolute "YYYY-MM-DD" date; `today`/`this_week`/`this_month` take no value at all. Never use a relative string like "now-30d" - it is never valid.'
  )

  // Mail is not a source.
  lines.push(
    'Mail cannot be a dashboard source. Threads and messages are refused outright (the aggregate builder cannot express per-viewer mail visibility, so a chart over them would count the whole workspace mailbox for everyone). Tell the user that plainly and use the mail search tools for anything that needs thread content.'
  )

  if (has('set_global_filters')) {
    lines.push(
      '`set_global_filters` sets the dashboard DEFAULTS - what a viewer sees before they touch anything. It does not change what the user is looking at right now: their own filter picks live in the URL and win over the defaults. Say so when you report it.'
    )
  }
  if (has('validate_dashboard')) {
    lines.push(
      '`validate_dashboard` runs the publish gate without publishing. Read `publishable` for "can the user publish this" - do NOT count issues, because they answer a different question: `willRenderEmpty` lists widgets that publish perfectly well and simply show nothing yet. Report those, but never refuse to finish work over them. Call it once, after your edits have come back applied.'
    )
  }

  // 8. What is not available.
  lines.push(
    "What you cannot do here: publish, create a new dashboard, delete or archive this one, duplicate it, change who it is shared with, or make it someone's default. There are no tools for any of that, by design - publishing in particular is the user's decision. If you are asked, say so plainly and point at the editor rather than hunting for a tool."
  )

  return `## Dashboard builder\n\n${lines.join('\n\n')}`
}

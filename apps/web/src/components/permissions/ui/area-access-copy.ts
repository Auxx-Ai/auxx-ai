// apps/web/src/components/permissions/ui/area-access-copy.ts

import { Area, Level } from '@auxx/lib/permissions/client'
import { RUNG_LABELS_LONG } from './level-labels'

/**
 * Copy for the **synthetic access child row** every instance-access area renders
 * ahead of its instance rows (plan 43 §2.1, decision 0.7).
 *
 * The area row itself no longer carries a control; this row does, and it answers
 * a different question from the instance rows below it — *what the workspace
 * default hands out*, not *who may reach this one item*. That distinction is the
 * whole reason plan 43 exists, so it is stated in the copy rather than implied by
 * the nesting.
 *
 * **The lane vocabulary (§2.0) is fixed and must not be re-worded.** Two phrases
 * carry §0.2a's rule between every surface that touches it:
 *
 * - **"the workspace default"** — `role:org_member` rows and the area
 *   fall-through. This is the lane the area level gates.
 * - **"shared directly"** — `user` / `group` / `profile` grants. Never gated;
 *   #1346 holds.
 *
 * **Nothing here may say an area rung closes a feature.** An earlier draft read
 * *"None closes signatures entirely"* — false under §0.2a: `None` closes the
 * workspace default only, and a signature shared with someone directly still
 * reaches them. `area-access-copy.test.ts` pins that as a lint over these tables.
 */

/** The eight instance-access areas, split by the posture their copy is written from. */
const PRIVATE_AREAS = [Area.signatures, Area.snippets, Area.dashboards] as const

type PrivateArea = (typeof PRIVATE_AREAS)[number]

function isPrivateArea(area: Area): area is PrivateArea {
  return (PRIVATE_AREAS as readonly Area[]).includes(area)
}

/**
 * Label + a **static** description for an area's access child row (§2.1).
 *
 * The description does not change as the dropdown cycles — per-rung meaning lives
 * in {@link areaRungHelper}, on the options. A message that rewrites itself under
 * the cursor reads as instability, and §2.0's load-bearing sentence has to stay on
 * screen at every rung, including `No access`.
 *
 * **Three of these sentences look like padding and are not:**
 *
 * - `workflows` / `agents` — the headless-still-fires rule
 *   (`instance-access.ts`) is the most surprising property of those areas and has
 *   never been stated anywhere a user can read it.
 * - `inboxes` — one row governs **both** `inbox` and `personal_inbox`, and nothing
 *   else on screen tells a reader the rung does not reach colleagues' mail.
 * - the private three — the "shared directly" clause is §2.0's load-bearing
 *   sentence. Without it an admin sets `Dashboards: None`, sees a member still
 *   holding one dashboard, and files a bug.
 *
 * Keyed only by the eight areas that expand into instance rows. `Area.records` is
 * deliberately absent (§5.2): its children are per-*definition* and its rung
 * genuinely IS their default, so it keeps its ladder and needs no access row.
 */
export const AREA_ACCESS_ROW_COPY: Partial<Record<Area, { label: string; description: string }>> = {
  [Area.signatures]: {
    label: 'Signature access',
    description:
      'What the workspace default gives members. Signatures they create, or that are shared with them directly, always reach them.',
  },
  [Area.snippets]: {
    label: 'Snippet access',
    description:
      'What the workspace default gives members. Snippets shared with them directly always reach them.',
  },
  [Area.dashboards]: {
    label: 'Dashboard access',
    description:
      'What the workspace default gives members. Dashboards shared with them directly always reach them.',
  },
  [Area.datasets]: {
    label: 'Dataset access',
    description:
      "What members get on every dataset that isn't restricted. A direct share overrides this, including above it.",
  },
  [Area.knowledgeBase]: {
    label: 'Knowledge base access',
    description:
      "What members get on every knowledge base that isn't restricted. A direct share overrides this.",
  },
  [Area.workflows]: {
    label: 'Workflow access',
    description:
      "What members get on every workflow that isn't restricted. Scheduled and triggered runs are unaffected.",
  },
  [Area.agents]: {
    label: 'Agent access',
    description:
      "What members get on every agent that isn't restricted. Autonomous runs are unaffected.",
  },
  [Area.inboxes]: {
    label: 'Inbox access',
    description:
      "What members get on every shared inbox that isn't restricted. Personal mailboxes are never covered — they stay private to their owner.",
  },
}

/**
 * The ONE narrow rung-label override (plan 43 §2.1a, decision 0.11).
 *
 * {@link RUNG_LABELS_LONG} stays the vocabulary — plan 26 §2.1 deleted four
 * competing rung-label maps to make `level-labels.ts` the single one, and a
 * general per-area rung map would re-fork it. This is a two-cell exception for the
 * three private areas, not a parallel table:
 *
 * | rung | shared five | private three | why |
 * |---|---|---|---|
 * | `Read` | Read only | **Use** | `view` on a signature means *stamp it on a reply*, and `setDefault` asserts `view` deliberately so a colleague can share the team signature without granting a write rung. "Read only" describes looking at it. |
 * | `Full` | Full access | **Create** | On a dashboards row "Full access" asserts *access to all dashboards* — precisely the misconception plan 43 exists to kill. The rung grants creation and nothing else. |
 *
 * `Level.None` stays "No access" everywhere. `Level.Edit` does not arise — the
 * private three drop that rung in §3.1.
 *
 * Not invented vocabulary: `INSTANCE_SHARE_COPY.signature.levels.read` has read
 * **"Use in replies"** since plan 36 (§5.5.6). The dialog was already telling the
 * truth; this brings the area row into line with it.
 */
const PRIVATE_RUNG_LABELS: Partial<Record<Level, string>> = {
  [Level.Read]: 'Use',
  [Level.Full]: 'Create',
}

/**
 * The rung label for an area access row.
 *
 * {@link RUNG_LABELS_LONG} by default; the private three override `Read` and
 * `Full` per {@link PRIVATE_RUNG_LABELS}. An area with no access row (e.g.
 * `records`) falls through to the shared vocabulary unchanged.
 */
export function areaRungLabel(area: Area, level: Level): string {
  if (isPrivateArea(area)) return PRIVATE_RUNG_LABELS[level] ?? RUNG_LABELS_LONG[level]
  return RUNG_LABELS_LONG[level]
}

/**
 * Per-area, per-rung option helpers (§2.1a).
 *
 * These replace `ACCESS_LEVEL_HELPERS`, which is records-worded ("Can view
 * records") and reads plainly wrong under a dataset or KB row — the item 2b nit
 * inherited from plan 26, folded in here rather than left for its own pass.
 *
 * **The two `No access` phrasings differ on purpose.** The private three say *the
 * workspace default gives them nothing* (something can still reach them directly);
 * the shared five say *unless one is shared directly*. Same rule, stated from each
 * class's default. Neither says the feature is closed, because under §0.2a neither
 * would be true.
 *
 * Sparse by rung: only the rungs an area actually has
 * (`PERMISSION_AREAS[area].rungs`) carry a helper. The private three and `inboxes`
 * have no `Edit` rung, so none is written for them.
 */
const AREA_RUNG_HELPERS: Partial<Record<Area, Partial<Record<Level, string>>>> = {
  [Area.signatures]: {
    [Level.None]: 'The workspace default gives them nothing',
    [Level.Read]: 'Use signatures the workspace shares',
    [Level.Full]: 'Also create their own signatures',
  },
  [Area.snippets]: {
    [Level.None]: 'The workspace default gives them nothing',
    [Level.Read]: 'Use snippets the workspace shares',
    [Level.Full]: 'Also create snippets and manage folders',
  },
  [Area.dashboards]: {
    [Level.None]: 'The workspace default gives them nothing',
    [Level.Read]: 'Open dashboards the workspace shares',
    [Level.Full]: 'Also create and duplicate dashboards',
  },
  [Area.datasets]: {
    [Level.None]: 'No access unless one is shared directly',
    [Level.Read]: 'Search and use every unrestricted dataset',
    [Level.Edit]: 'Also contribute files to them',
    [Level.Full]: 'Also change settings and create datasets',
  },
  [Area.knowledgeBase]: {
    [Level.None]: 'No access unless one is shared directly',
    [Level.Read]: 'Read every unrestricted knowledge base',
    [Level.Edit]: 'Also write and edit articles',
    [Level.Full]: 'Also change KB settings and create them',
  },
  [Area.workflows]: {
    [Level.None]: 'No access unless one is shared directly',
    [Level.Read]: 'Run every unrestricted workflow',
    [Level.Edit]: 'Also edit them',
    [Level.Full]: 'Also create and delete workflows',
  },
  [Area.agents]: {
    [Level.None]: 'No access unless one is shared directly',
    [Level.Read]: 'Use every unrestricted agent — chat, DM, mention, assign',
    [Level.Edit]: 'Also edit prompts, tools and knowledge',
    [Level.Full]: 'Also publish, set triggers and delete',
  },
  [Area.inboxes]: {
    [Level.None]: 'No mail access unless an inbox is shared directly',
    [Level.Read]: 'Work every unrestricted shared inbox',
    [Level.Full]: 'Also administer who works which mail',
  },
}

/**
 * The helper line shown under an area access row's option (§2.1a).
 *
 * Returns `''` for a rung the area does not have and for areas with no access row
 * at all. That is not a gap: the option list is derived from
 * `PERMISSION_AREAS[area].rungs` (§5.2), so the UI never asks for a rung that is
 * missing here. Callers should still render the helper conditionally rather than
 * emitting an empty line.
 */
export function areaRungHelper(area: Area, level: Level): string {
  return AREA_RUNG_HELPERS[area]?.[level] ?? ''
}

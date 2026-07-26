// apps/web/src/components/agents/ui/detail/agent-guide-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  GuideCode,
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideDialog,
  GuidePage,
  GuideSection,
  GuideStep,
  GuideSteps,
} from '@auxx/ui/components/guide'
import {
  Ban,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Clock,
  Code2,
  CornerDownRight,
  FileText,
  Filter,
  Flag,
  FlaskConical,
  GitBranch,
  Hand,
  History,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Pin,
  Play,
  Plug,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  Tags,
  User,
  UserCog,
  Users,
  Variable,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'

export type AgentGuidePage =
  | 'overview'
  | 'capabilities'
  | 'procedures'
  | 'triggers'
  | 'simulations'
  | 'permissions'

const PAGE_LABELS: Record<AgentGuidePage, string> = {
  overview: 'Overview',
  capabilities: 'Capabilities',
  procedures: 'Procedures',
  triggers: 'Triggers',
  simulations: 'Simulations',
  permissions: 'Permissions',
}

/**
 * The agent help guide: a paged `GuideDialog` mirroring the detail page's own
 * sections, with the SAME glyphs the page uses. "Overview" frames the build flow
 * and the draft: publish model; "Capabilities" covers tools, bindings, and
 * knowledge; "Procedures" details selection and the special steps; "Triggers"
 * covers autonomous invocation; "Simulations" covers testing the agent;
 * "Permissions" covers the policy model the Permissions tab shows as values. An
 * active-crumb header switches between the pages and the body crossfades +
 * height-springs.
 *
 * `canProcedures` (procedures is plan-gated) drops the Procedures page entirely;
 * `isChat` (chat agents fire from their widget, not from triggers) reshapes the
 * Triggers copy so the guide never explains controls the reader can't see.
 * `initialPage` lets a section header deep-link its own page.
 */
export function AgentGuideDialog({
  open,
  onOpenChange,
  canProcedures = false,
  isChat = false,
  initialPage = 'overview',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Procedures is a beta entitlement: drop its page when the org lacks it. */
  canProcedures?: boolean
  /** Chat agents have no triggers: swap the Triggers copy for the widget note. */
  isChat?: boolean
  /** Page to open on — a section's `[?]` passes its own. */
  initialPage?: AgentGuidePage
}) {
  // Re-seed each time the dialog opens, regardless of where it was last closed.
  const [page, setPage] = useState<AgentGuidePage>(initialPage)
  useEffect(() => {
    if (open) setPage(initialPage)
  }, [open, initialPage])

  // The ordered set of visible pages drives both the crumb header and the
  // per-page "Continue to…" forward link.
  const order: AgentGuidePage[] = [
    'overview',
    'capabilities',
    ...(canProcedures ? (['procedures'] as const) : []),
    'triggers',
    'simulations',
    'permissions',
  ]
  const nextOf = (p: AgentGuidePage) => order[order.indexOf(p) + 1]

  /** Footer for a page: Esc hint plus a forward link to the next page (if any). */
  const footerFor = (p: AgentGuidePage) => {
    const next = nextOf(p)
    if (!next) return undefined // GuidePage default: "Press Esc to close"
    return (
      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-xs'>Press Esc to close</p>
        <Button variant='ghost' size='xs' onClick={() => setPage(next)}>
          Continue to {PAGE_LABELS[next].toLowerCase()}
          <ChevronRight />
        </Button>
      </div>
    )
  }

  return (
    <GuideDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Agent guide'
      page={page}
      crumbs={order.map((p) => ({
        label: PAGE_LABELS[p],
        active: page === p,
        onClick: () => setPage(p),
      }))}>
      <GuidePage value='overview' size='3xl' footer={footerFor('overview')}>
        <OverviewGuideBody canProcedures={canProcedures} isChat={isChat} />
      </GuidePage>

      <GuidePage value='capabilities' size='3xl' footer={footerFor('capabilities')}>
        <CapabilitiesGuideBody />
      </GuidePage>

      {canProcedures && (
        <GuidePage value='procedures' size='3xl' footer={footerFor('procedures')}>
          <ProceduresGuideBody />
        </GuidePage>
      )}

      <GuidePage value='triggers' size='3xl' footer={footerFor('triggers')}>
        <TriggersGuideBody isChat={isChat} />
      </GuidePage>

      <GuidePage value='simulations' size='3xl' footer={footerFor('simulations')}>
        <SimulationsGuideBody canProcedures={canProcedures} />
      </GuidePage>

      <GuidePage value='permissions' size='3xl' footer={footerFor('permissions')}>
        <PermissionsGuideBody />
      </GuidePage>
    </GuideDialog>
  )
}

// ── Page 1: overview ──────────────────────────────────────────────────────────

/**
 * The build flow as a numbered happy path mirroring the page's section order, plus
 * the identity basics and the draft: publish model that governs every change.
 */
function OverviewGuideBody({ canProcedures, isChat }: { canProcedures: boolean; isChat: boolean }) {
  // The automation step only exists if there's something to automate.
  const hasAutomation = canProcedures || !isChat
  return (
    <GuideColumns>
      {/* 1: the happy path, ordered like the page itself */}
      <GuideColumn title='How an agent is built'>
        <GuideSteps>
          <GuideStep n={1} title='Write the prompt'>
            Give the agent its persona and standing instructions: who it is and how it should behave
            every run.
          </GuideStep>
          <GuideStep n={2} title='Give it tools'>
            Enable the actions it can take, from app integrations to built-ins.
          </GuideStep>
          <GuideStep n={3} title='Add knowledge'>
            Attach reference docs it can search while it works.
          </GuideStep>
          {hasAutomation && (
            <GuideStep n={4} title='Automate'>
              Optional: add procedures it follows and triggers that fire it on their own.
            </GuideStep>
          )}
          <GuideStep n={hasAutomation ? 5 : 4} title='Test'>
            Run simulations to check the agent behaves before it goes live.
          </GuideStep>
          <GuideStep n={hasAutomation ? 6 : 5} title='Publish'>
            Snapshot the draft so production starts running it.
          </GuideStep>
        </GuideSteps>
      </GuideColumn>

      {/* 2: identity */}
      <GuideColumn title='The basics'>
        <GuideConcepts>
          <GuideConcept
            glyph={<FileText className='size-3.5 text-muted-foreground' />}
            term='Prompt'>
            The agent's persona and standing instructions. It frames how the agent behaves on every
            run.
          </GuideConcept>
          <GuideConcept
            glyph={<BookOpen className='size-3.5 text-muted-foreground' />}
            term='Knowledge'>
            Reference docs the agent can pull from while it works, so its answers stay grounded in
            your material.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      {/* 3: draft -> publish */}
      <GuideColumn title='Going live'>
        <GuideConcepts>
          <GuideConcept glyph={<Pencil className='size-3.5 text-muted-foreground' />} term='Draft'>
            Where your edits live. Unsaved changes only affect the builder Chat tab and draft
            simulations: production is untouched until you publish.
          </GuideConcept>
          <GuideConcept
            glyph={<History className='size-3.5 text-muted-foreground' />}
            term='Published version'
            example='Production always runs the published version, never your in-progress draft.'>
            Publishing snapshots the current draft. Version history lets you compare and roll back.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

// ── Page 2: capabilities ──────────────────────────────────────────────────────

/**
 * What the agent can do and how it's scoped: tools, the per-tool binding overrides
 * (with the same vocabulary the override editor uses), and knowledge.
 */
function CapabilitiesGuideBody() {
  return (
    <GuideColumns>
      {/* 1: tools */}
      <GuideColumn title='Tools'>
        <GuideConcepts>
          <GuideConcept glyph={<Wrench className='size-3.5 text-muted-foreground' />} term='Tools'>
            The actions the agent can take: app integrations and built-ins. Enable the ones the task
            needs; the model decides when to call them.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      {/* 2: bindings — the override layer */}
      <GuideColumn title='Bindings'>
        <GuideConcepts>
          <GuideConcept
            glyph={<ShieldCheck className='size-3.5 text-muted-foreground' />}
            term='Overrides'>
            Tools run on their built-in defaults. Add an override to take control of a single input.
            Most agents need none.
          </GuideConcept>
          <GuideConcept
            glyph={<Pin className='size-3.5 text-muted-foreground' />}
            term='Pin a value'>
            Lock an input to a constant so the model can't change it.
          </GuideConcept>
          <GuideConcept
            glyph={<Variable className='size-3.5 text-muted-foreground' />}
            term='Rebind'>
            Feed an input from another source instead of the default.
          </GuideConcept>
          <GuideConcept
            glyph={<Bot className='size-3.5 text-muted-foreground' />}
            term='Model decides'>
            Leave the input to the model: the standard behavior with no override.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      {/* 3: knowledge */}
      <GuideColumn title='Knowledge'>
        <GuideConcepts>
          <GuideConcept
            glyph={<BookOpen className='size-3.5 text-muted-foreground' />}
            term='Knowledge'
            example='Product docs or policies the agent cites instead of guessing.'>
            Docs the agent can search at runtime to ground its answers in your own material.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

// ── Page 3: procedures ────────────────────────────────────────────────────────

/**
 * The procedures deep-dive: how a procedure gets selected (when-to-run + use/avoid
 * examples + rules) and the special steps you drop in from the `/` menu, each shown
 * with the editor's own glyph.
 */
function ProceduresGuideBody() {
  return (
    <>
      <GuideColumns cols={2}>
        {/* 1: selection inputs, ordered like the trigger header */}
        <GuideColumn title='When it runs'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Clock className='size-3.5 text-muted-foreground' />}
              term='When to run'
              example="Customer asks to cancel or change an order that hasn't shipped yet.">
              A plain-language description of the situation this procedure handles. The agent reads
              it to decide whether to pick this procedure.
            </GuideConcept>
            <GuideConcept
              glyph={<Filter className='size-3.5 text-muted-foreground' />}
              term='Rules'>
              Optional structured conditions that must hold before the procedure can run, like order
              status is unfulfilled.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 2: the use/avoid examples that sharpen selection */}
        <GuideColumn title='Trigger examples'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Tags className='size-3.5 text-muted-foreground' />}
              term='Why they matter'>
              Short example phrases that sharpen which procedure the agent picks. Aim for 10 or
              more.
            </GuideConcept>
            <GuideConcept
              glyph={<Check className='size-3.5 text-emerald-500' />}
              term='Use when'
              example='“I want to cancel my order.”'>
              Situations that should pick this procedure.
            </GuideConcept>
            <GuideConcept
              glyph={<X className='size-3.5 text-muted-foreground' />}
              term='Avoid when'
              example='“Where is my order right now?”'>
              Look-alike situations that should NOT, so the agent doesn't over-trigger.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>

      {/* Special steps — the structured insertions from the editor's `/` menu. */}
      <GuideSection title='Special steps' cols={3}>
        <GuideConcept
          glyph={<Plus className='size-3.5 text-muted-foreground' />}
          term='Insert with /'>
          Most steps are plain instructions. Type <GuideCode>/</GuideCode> in the editor to drop in
          one of these structured steps.
        </GuideConcept>
        <GuideConcept
          glyph={<Square className='size-3.5 text-muted-foreground' />}
          term='End procedure'>
          Finish the run cleanly. The agent stops here and reports back.
        </GuideConcept>
        <GuideConcept glyph={<Hand className='size-3.5 text-amber-500' />} term='Hand off to human'>
          Escalate to a teammate and hand over the conversation.
        </GuideConcept>
        <GuideConcept
          glyph={<CornerDownRight className='size-3.5 text-muted-foreground' />}
          term='Switch to procedure'>
          Jump to a different procedure and continue the run there.
        </GuideConcept>
        <GuideConcept
          glyph={<Workflow className='size-3.5 text-muted-foreground' />}
          term='Sub-procedure'>
          Call a reusable procedure inline, then return to this one.
        </GuideConcept>
        <GuideConcept
          glyph={<GitBranch className='size-3.5 text-muted-foreground' />}
          term='Condition (IF / ELSE)'>
          Branch the following steps on a condition.
        </GuideConcept>
        <GuideConcept
          glyph={<Code2 className='size-3.5 text-muted-foreground' />}
          term='Code block'>
          Run a JavaScript snippet and feed its output into later steps.
        </GuideConcept>
      </GuideSection>
    </>
  )
}

// ── Page 4: triggers ──────────────────────────────────────────────────────────

/**
 * How the agent fires on its own: the three trigger kinds, or the chat-widget note
 * for chat agents (which have no scheduled / event / app triggers).
 */
function TriggersGuideBody({ isChat }: { isChat: boolean }) {
  return (
    <GuideColumns cols={2}>
      <GuideColumn title='Triggers'>
        <GuideConcepts>
          {isChat ? (
            <GuideConcept
              glyph={<MessageCircle className='size-3.5 text-muted-foreground' />}
              term='Chat widget'>
              Chat agents run when a visitor messages the widget they're bound to. They have no
              scheduled, event, or app triggers.
            </GuideConcept>
          ) : (
            <>
              <GuideConcept
                glyph={<Clock className='size-3.5 text-muted-foreground' />}
                term='Scheduled'>
                Fire the agent on a recurring schedule.
              </GuideConcept>
              <GuideConcept glyph={<Zap className='size-3.5 text-muted-foreground' />} term='Event'>
                Fire when a record changes, like a contact created or a ticket updated.
              </GuideConcept>
              <GuideConcept
                glyph={<Plug className='size-3.5 text-muted-foreground' />}
                term='App or webhook'>
                Fire on an external app event or an inbound webhook.
              </GuideConcept>
            </>
          )}
        </GuideConcepts>
      </GuideColumn>

      <GuideColumn title='Good to know'>
        <GuideConcepts>
          <GuideConcept
            glyph={<History className='size-3.5 text-muted-foreground' />}
            term='Runs the published version'>
            Triggers only fire the published version. Editing your draft never disrupts a live run.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

// ── Page 5: simulations ───────────────────────────────────────────────────────

/**
 * Testing the agent: how a simulation runs (a scripted customer talks to the agent
 * and assertions grade it), the case setup, the four assertion types with the
 * editor's own glyphs, and a "Going further" block on verdicts, the draft loop, and
 * AI-suggested cases.
 */
function SimulationsGuideBody({ canProcedures }: { canProcedures: boolean }) {
  return (
    <>
      <GuideColumns>
        {/* 1: the happy path, ordered like the case editor */}
        <GuideColumn title='How a simulation works'>
          <GuideSteps>
            <GuideStep n={1} title='Set the scene'>
              Write the customer's opening message and any context they know. Optionally simulate as
              a real contact.
            </GuideStep>
            <GuideStep n={2} title='Mock the tools'>
              Give tools canned responses so a run is deterministic and offline. Writes are always
              mocked.
            </GuideStep>
            <GuideStep n={3} title='Add assertions'>
              State what must be true for the run to pass.
            </GuideStep>
            <GuideStep n={4} title='Run'>
              A scripted customer holds the conversation with the agent.
            </GuideStep>
            <GuideStep n={5} title='Read the verdict'>
              See pass or fail, the full conversation trace, and each assertion's result.
            </GuideStep>
          </GuideSteps>
        </GuideColumn>

        {/* 2: the case setup */}
        <GuideColumn title='The setup'>
          <GuideConcepts>
            <GuideConcept
              glyph={<User className='size-3.5 text-muted-foreground' />}
              term='Customer'>
              The scripted persona: opening message, context, channel, and how many turns it may
              take. Point it at a contact to simulate a real customer.
            </GuideConcept>
            <GuideConcept
              glyph={<Wrench className='size-3.5 text-muted-foreground' />}
              term='Tool responses'>
              Mock what each tool returns. Read-only tools can optionally run live; writes never do.
            </GuideConcept>
            <GuideConcept
              glyph={<FlaskConical className='size-3.5 text-muted-foreground' />}
              term='Scope'>
              Test the whole agent, or{' '}
              {canProcedures ? 'one procedure pinned to a version' : 'a single procedure'}.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 3: the assertion types, with the editor's real glyphs */}
        <GuideColumn title='Assertions'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Flag className='size-3.5 text-muted-foreground' />}
              term='Terminal outcome'>
              How the conversation must end: finished, handed off to a human, or switched to another
              procedure.
            </GuideConcept>
            <GuideConcept
              glyph={<MessageSquareText className='size-3.5 text-muted-foreground' />}
              term='Response criteria'>
              Natural-language criteria the replies must satisfy, graded by an LLM.
            </GuideConcept>
            <GuideConcept
              glyph={<Wrench className='size-3.5 text-muted-foreground' />}
              term='Tool called'>
              The agent must call this tool at least once.
            </GuideConcept>
            <GuideConcept
              glyph={<Ban className='size-3.5 text-muted-foreground' />}
              term='Tool not called'>
              The agent must never call this tool.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>

      {/* Advanced: verdict nuance, the draft loop, and AI suggestions. */}
      <GuideSection title='Going further' cols={3}>
        <GuideConcept
          glyph={<Check className='size-3.5 text-emerald-500' />}
          term='Pass, fail, or error'>
          Pass means every assertion held. Fail means one didn't. Error is different: the run or its
          grading couldn't complete.
        </GuideConcept>
        <GuideConcept glyph={<Play className='size-3.5 text-muted-foreground' />} term='Run all'>
          Run a whole suite at once and watch its live progress. A failing run can be handed to
          Kopilot to fix.
        </GuideConcept>
        <GuideConcept
          glyph={<History className='size-3.5 text-muted-foreground' />}
          term='Draft loop'>
          Run on the draft until it passes, then publish. The guide nudges a confirmation run on the
          published version.
        </GuideConcept>
        <GuideConcept
          glyph={<Sparkles className='size-3.5 text-muted-foreground' />}
          term='Suggested simulations'>
          For a procedure, the system reads your draft and proposes ready-to-run cases. Add the ones
          you want.
        </GuideConcept>
      </GuideSection>
    </>
  )
}

// ── Page 6: permissions ───────────────────────────────────────────────────────

/**
 * The policy model behind the Permissions tab: the four rungs (and why `None` is a
 * deny), how profiles and run-as compose, and what publishing snapshots. The tab
 * itself shows only values — the concepts live here.
 */
function PermissionsGuideBody() {
  return (
    <>
      <GuideColumns>
        {/* 1: the rungs themselves */}
        <GuideColumn title='The four rungs'>
          <GuideConcepts>
            <GuideConcept glyph={<Ban className='size-3.5 text-muted-foreground' />} term='None'>
              A deny, not an unset value. Nothing raises it back — an agent never inherits access
              from a team, its author, or whoever invokes it. Composition only narrows.
            </GuideConcept>
            <GuideConcept
              glyph={<ShieldCheck className='size-3.5 text-muted-foreground' />}
              term='Read, Read + Write, Full'>
              Read lists and searches; Read + Write also creates, updates, and deletes. Full adds
              administration — including schema administration, which changes nothing today because
              no native schema-mutation tool exists yet.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 2: where the policy comes from */}
        <GuideColumn title='Where it comes from'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Users className='size-3.5 text-muted-foreground' />}
              term='Profiles are shared'>
              One profile supplies the agent's whole policy — a rung per area, record type, and
              resource. Editing that profile in Settings → Permissions re-shapes every draft bound
              to it and marks them unpublished; already-published versions are untouched.
            </GuideConcept>
            <GuideConcept
              glyph={<UserCog className='size-3.5 text-muted-foreground' />}
              term='Run as'
              example='A Read-only member as run-as makes a Full agent read-only.'>
              Point the agent at a member and every run resolves the narrower of the two. Delegation
              only narrows, never widens. Runs fail if that member is deactivated or removed.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 3: draft vs published */}
        <GuideColumn title='Going live'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Pencil className='size-3.5 text-muted-foreground' />}
              term='Draft'>
              Everything on the Permissions tab describes the draft: the builder Chat tab and draft
              eval runs.
            </GuideConcept>
            <GuideConcept
              glyph={<History className='size-3.5 text-muted-foreground' />}
              term='Published policy'>
              Publishing snapshots the policy onto the version production runs, clamped to the
              publisher's own access. Restoring an older version restores that version's policy.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>

      {/* Permissions and tools are two separate keys — the most common surprise. */}
      <GuideSection title='Permissions and tools are two separate keys' cols={2}>
        <GuideConcept
          glyph={<Wrench className='size-3.5 text-muted-foreground' />}
          term='Both, or nothing'>
          A call succeeds only when the tool is enabled on the Tools tab AND the policy authorizes
          its target.
        </GuideConcept>
        <GuideConcept
          glyph={<Ban className='size-3.5 text-muted-foreground' />}
          term='Either alone'>
          Permission without a tool does nothing. A tool without permission is denied server-side.
        </GuideConcept>
      </GuideSection>
    </>
  )
}

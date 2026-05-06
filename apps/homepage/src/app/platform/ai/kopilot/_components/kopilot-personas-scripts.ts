// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-personas-scripts.ts

import type { KopilotStoryScript } from '../../_mocks/use-kopilot-story'

export type PersonaId = 'support' | 'ops' | 'founders' | 'devs'

const SPEED = 0.85

/**
 * Two-turn marketing stories for the personas section, one per pill. Same
 * animation language as `KOPILOT_HERO_SCRIPT`, just shorter so a curious
 * visitor can sample multiple personas without losing patience.
 */
export const PERSONA_SCRIPTS: Record<PersonaId, KopilotStoryScript> = {
  support: {
    speed: SPEED,
    turns: [
      {
        user: 'draft refund reply for order #4521',
        thinking: {
          steps: [
            {
              icon: 'Mail',
              runningLabel: 'Reading TKT-4521',
              completedLabel: 'Read 4 messages',
            },
            {
              icon: 'BookOpen',
              runningLabel: 'Pulling refund policy',
              completedLabel: 'Found policy v3',
            },
            {
              icon: 'PenTool',
              runningLabel: 'Drafting reply',
              completedLabel: 'Draft ready',
            },
          ],
        },
        blocks: [
          {
            kind: 'draft-approval',
            recipient: 'Drew Houston',
            subject: 'Re: Order #4521 refund',
            body: "Hi Drew,\n\nApologies for the delay. I've issued a full refund of $89.00 — you should see it back on your card within 3–5 business days. Let me know if anything else comes up.\n\nThanks for your patience.",
          },
        ],
        assistant: 'Draft is ready. Tone matches your past replies — review and send.',
      },
      {
        user: "what's their CSAT history?",
        thinking: {
          steps: [
            {
              icon: 'Search',
              runningLabel: 'Searching contacts',
              completedLabel: '1 match',
            },
            {
              icon: 'Database',
              runningLabel: 'Loading record',
              completedLabel: 'Loaded',
            },
          ],
        },
        blocks: [
          {
            kind: 'entity-list',
            title: 'Contact',
            rows: [
              {
                code: 'DH',
                color: 'blue',
                title: 'Drew Houston',
                subtitle: 'Head of IT · Ridgeline',
                badge: 'VIP',
                meta: '12 prior tickets · CSAT 4.6',
              },
            ],
          },
        ],
        assistant:
          '**Drew Houston** is a long-term VIP. CSAT trend stable — tag this ticket as **At-risk** to flag manager review.',
      },
    ],
  },

  ops: {
    speed: SPEED,
    turns: [
      {
        user: "summarize this week's negative feedback",
        thinking: {
          steps: [
            {
              icon: 'Search',
              runningLabel: 'Searching tickets',
              completedLabel: '50 negative tickets',
            },
            {
              icon: 'Database',
              runningLabel: 'Clustering themes',
              completedLabel: '3 clusters',
            },
            {
              icon: 'Wrench',
              runningLabel: 'Summarizing',
              completedLabel: 'Summary ready',
            },
          ],
        },
        blocks: [
          {
            kind: 'thread-list',
            rows: [
              {
                subject: 'Late shipping — order #4521',
                status: 'open',
                sender: 'Drew Houston',
                age: '2d ago',
                unread: true,
                messageCount: 4,
              },
              {
                subject: 'Late shipping — order #4517',
                status: 'open',
                sender: 'Maya Lin',
                age: '3d ago',
                messageCount: 2,
              },
              {
                subject: 'Late shipping — order #4509',
                status: 'open',
                sender: 'Jordan Park',
                age: '4d ago',
                messageCount: 3,
              },
              {
                subject: 'Missing item in box',
                status: 'open',
                sender: 'Avery Chen',
                age: '5d ago',
                messageCount: 1,
              },
              {
                subject: 'Missing accessory',
                status: 'open',
                sender: 'Carolin Klooth',
                age: '6d ago',
                messageCount: 2,
              },
            ],
          },
        ],
        assistant:
          '**38 mentions of late shipping**, 12 of missing items. Top affected SKUs: 3 flagged for review.',
      },
      {
        user: 'escalate the top theme to fulfillment',
        thinking: {
          steps: [
            {
              icon: 'Pencil',
              runningLabel: 'Tagging tickets',
              completedLabel: 'Tagged 38',
            },
            {
              icon: 'Plus',
              runningLabel: 'Assigning to Fulfillment',
              completedLabel: 'Assigned',
            },
          ],
        },
        blocks: [
          {
            kind: 'plan-steps',
            steps: [
              { status: 'completed', label: 'Tagged 38 tickets as late-shipping' },
              { status: 'completed', label: 'Assigned to Fulfillment team' },
              { status: 'completed', label: 'Notified team owner' },
            ],
          },
        ],
        assistant: 'Done. **38 tickets** tagged and assigned to **Fulfillment**.',
      },
    ],
  },

  founders: {
    speed: SPEED,
    turns: [
      {
        user: 'how is support trending this month?',
        thinking: {
          steps: [
            {
              icon: 'Search',
              runningLabel: 'Searching tickets',
              completedLabel: '142 tickets',
            },
            {
              icon: 'Database',
              runningLabel: 'Aggregating',
              completedLabel: 'Done',
            },
          ],
        },
        blocks: [
          {
            kind: 'entity-list',
            title: 'This month',
            rows: [
              {
                code: 'TX',
                color: 'indigo',
                title: 'Tickets',
                subtitle: '142 (↑18% MoM)',
                meta: 'Volume up week-over-week',
              },
              {
                code: 'RT',
                color: 'green',
                title: 'Avg first response',
                subtitle: '4m 12s',
                meta: 'Stable vs last month',
              },
              {
                code: 'CS',
                color: 'amber',
                title: 'CSAT',
                subtitle: '4.4 / 5',
                meta: 'Down 0.1 from last month',
              },
              {
                code: 'CR',
                color: 'red',
                title: 'Churn risk',
                subtitle: '2 accounts flagged',
                badge: 'review',
                meta: 'Ridgeline · Northwind',
              },
            ],
          },
        ],
        assistant:
          'Volume up **18% MoM**, response time stable. Two churn-risk accounts surfaced — **Ridgeline** is the one worth your day.',
      },
      {
        user: 'draft a check-in to Ridgeline',
        thinking: {
          steps: [
            {
              icon: 'Mail',
              runningLabel: 'Reading recent thread',
              completedLabel: 'Read 6 messages',
            },
            {
              icon: 'PenTool',
              runningLabel: 'Drafting',
              completedLabel: 'Draft ready',
            },
          ],
        },
        blocks: [
          {
            kind: 'draft-approval',
            recipient: 'Drew Houston',
            subject: 'Quick check-in',
            body: "Hi Drew,\n\nWanted to personally check in on how things are going with your team this quarter. If there's anything we can be doing better, I'd love to hear it.\n\nHappy to find time this week if useful.",
          },
        ],
        assistant: 'Draft saved. Send when you’re ready.',
      },
    ],
  },

  devs: {
    speed: SPEED,
    turns: [
      {
        user: 'tag this ticket and assign to triage',
        thinking: {
          steps: [
            {
              icon: 'Pencil',
              runningLabel: 'Running tag.add',
              completedLabel: 'Tag added',
            },
            {
              icon: 'Plus',
              runningLabel: 'Running ticket.assign',
              completedLabel: 'Assigned',
            },
            {
              icon: 'FileText',
              runningLabel: 'Running task.create',
              completedLabel: 'Task created',
            },
          ],
        },
        blocks: [
          {
            kind: 'plan-steps',
            steps: [
              { status: 'completed', label: 'tag.add("bug")', detail: 'returned ok' },
              { status: 'completed', label: 'ticket.assign(triage)', detail: 'returned ok' },
              { status: 'completed', label: 'task.create(...)', detail: 'task_84f2 created' },
            ],
          },
        ],
        assistant: 'Three actions queued. Audit log updated.',
      },
      {
        user: 'list capabilities available on tickets',
        thinking: {
          steps: [
            {
              icon: 'Database',
              runningLabel: 'Searching capabilities',
              completedLabel: '4 available',
            },
          ],
        },
        blocks: [
          {
            kind: 'entity-list',
            title: 'Capabilities · ticket',
            rows: [
              {
                code: 'TA',
                color: 'purple',
                title: 'tag.add',
                subtitle: '(name: string) → Tag',
                meta: 'Idempotent',
              },
              {
                code: 'TS',
                color: 'indigo',
                title: 'ticket.assign',
                subtitle: '(actor: ActorId) → Ticket',
                meta: 'Audited',
              },
              {
                code: 'TK',
                color: 'teal',
                title: 'task.create',
                subtitle: '(input: TaskInput) → Task',
                meta: 'Returns id',
              },
              {
                code: 'KB',
                color: 'amber',
                title: 'kb.cite',
                subtitle: '(query: string) → Citation[]',
                meta: 'Grounded',
              },
            ],
          },
        ],
        assistant: 'Every capability is callable from chat **or** from your code via the SDK.',
      },
    ],
  },
}

// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-hero-script.ts

import type { KopilotStoryScript } from '../../_mocks/use-kopilot-story'

/**
 * 5-turn marketing story for the Kopilot hero. Each turn shows a different
 * real product capability: ticket list → contact lookup → draft reply →
 * grounded KB answer → action with confirmation.
 *
 * Authored to land at ~28s total at speed=1. Bold (`**…**`) renders as
 * `<strong>` via the inline tokenizer in `mock-assistant-message.tsx`.
 */
export const KOPILOT_HERO_SCRIPT: KopilotStoryScript = {
  speed: 1,
  loop: true,
  loopGapMs: 3000,
  turns: [
    {
      user: 'Summarize my open tickets',
      thinking: {
        steps: [
          {
            icon: 'Search',
            runningLabel: 'Searching tickets',
            completedLabel: 'Found 8 open tickets',
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
              subject: 'Order #4521 shipping delay',
              status: 'open',
              sender: 'Drew Houston',
              age: '2d ago',
              unread: true,
              messageCount: 4,
            },
            {
              subject: 'Refund request — defective unit',
              status: 'open',
              sender: 'Maya Lin',
              age: '3d ago',
              messageCount: 2,
            },
            {
              subject: 'Can I change my shipping address?',
              status: 'open',
              sender: 'Carolin Klooth',
              age: '5d ago',
              messageCount: 1,
            },
            {
              subject: 'Replace phone for warranty claim',
              status: 'open',
              sender: 'Jordan Park',
              age: '6d ago',
              messageCount: 3,
            },
            {
              subject: 'General inquiry about services',
              status: 'open',
              sender: 'Avery Chen',
              age: '7d ago',
              messageCount: 1,
            },
          ],
        },
      ],
      assistant:
        '**8 open tickets**, 3 awaiting reply more than 24h. Top theme: shipping delays on **#4521** and **#4517**.',
    },
    {
      user: "Show me Drew Houston's account",
      thinking: {
        steps: [
          {
            icon: 'Search',
            runningLabel: 'Searching contacts',
            completedLabel: '1 match',
          },
          {
            icon: 'Database',
            runningLabel: 'Loading contact',
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
              meta: '12 prior tickets · last active 2d ago',
            },
          ],
        },
      ],
      assistant:
        '**Drew Houston** — Head of IT at Ridgeline. VIP, 12 prior tickets, last active 2d ago.',
    },
    {
      user: 'Draft a refund reply for ticket #4521',
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
            runningLabel: 'Drafting',
            completedLabel: 'Draft ready',
          },
        ],
      },
      blocks: [
        {
          kind: 'draft-approval',
          recipient: 'Drew Houston',
          subject: 'Re: Order #4521 refund',
          body: "Hi Drew,\n\nApologies for the delay on order #4521. I've initiated a full refund — you should see it back on your card within 3–5 business days. Let me know if anything else comes up.\n\nThanks for your patience.",
        },
      ],
      assistant: 'Draft is ready. Tone matches your past replies — review and send.',
    },
    {
      user: "What's our refund policy?",
      thinking: {
        steps: [
          {
            icon: 'BookOpen',
            runningLabel: 'Searching KB',
            completedLabel: '1 article',
          },
        ],
      },
      assistant:
        'Refunds within **30 days** of delivery, items unused and in original packaging. Defective items refund anytime within warranty.',
    },
    {
      user: 'Tag #4521 as refund-request and assign to Drew',
      thinking: {
        steps: [
          {
            icon: 'Pencil',
            runningLabel: 'Tagging ticket',
            completedLabel: 'Added tag',
          },
          {
            icon: 'Plus',
            runningLabel: 'Assigning to Drew',
            completedLabel: 'Assigned',
          },
        ],
      },
      blocks: [
        {
          kind: 'plan-steps',
          steps: [
            { status: 'completed', label: 'Tagged #4521 as refund-request' },
            { status: 'completed', label: 'Assigned to Drew Houston' },
          ],
        },
      ],
      assistant: 'Done. Tagged **#4521** as **refund-request** and assigned to **Drew Houston**.',
    },
  ],
}

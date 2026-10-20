// apps/homepage/src/app/builder/_data/content.ts

import type { TapeApp } from '~/components/tape-mark'

/** Where every call to action on the page goes (shared with the header). */
export { BUILDER_APP_URL } from '../../_components/main/header-links'

/** A screenshot of one of the apps, in `public/images/builder/`. */
export interface Shot {
  src: string
  alt: string
  width: number
  height: number
}

const shot = (name: string, alt: string): Shot => ({
  src: `/images/builder/${name}.webp`,
  alt,
  width: 1600,
  height: 1000,
})

export const SHOTS = {
  builderIsometric: shot('builder-isometric', 'A garage with storage lifts in the 3D view'),
  builderPlan: shot('builder-plan', 'A garage floor plan with walls, doors and dimensions'),
  builderSection: shot('builder-section', 'A section through two levels and the roof'),
  builderLifts: shot('builder-lifts', 'Auxx-Lift storage lifts placed with their clearance checks'),
  builderSheet: shot('builder-sheet', 'A drawing sheet with a title block and views'),
  pdfMarkups: shot('pdf-markups', 'A PDF drawing with clouds, callouts and comments'),
  pdfMeasure: shot('pdf-measure', 'Lengths and areas measured to scale on a PDF plan'),
  pdfTakeoff: shot('pdf-takeoff', 'The takeoff panel with conditions and quantities'),
  estimatorBook: shot('estimator-book', 'A cost book with items, assemblies and prices'),
  estimatorBound: shot('estimator-bound', 'An estimate priced from the PDF takeoff'),
  estimatorProposal: shot('estimator-proposal', 'A proposal ready to send'),
} satisfies Record<string, Shot>

/** One app of the product, for its card and its section. */
export interface AppInfo {
  app: TapeApp
  name: string
  /** The section's anchor on this page. */
  anchor: string
  tagline: string
  intro: string
  points: string[]
  rows: { title: string; description: string; bullets: string[]; shot: Shot }[]
}

export const APPS: AppInfo[] = [
  {
    app: 'builder',
    name: 'Builder',
    anchor: 'builder',
    tagline: 'Design the building',
    intro:
      'Draw the garage, the shop or the whole house in plan and see it in 3D as you go. Place Auxx-Lift storage lifts where they fit and print the drawings.',
    points: ['Walls, floors, roofs and levels', '3D, sections and sheets', 'Auxx-Lift placement'],
    rows: [
      {
        title: 'Draw it in minutes',
        description:
          'Click out walls, drop in doors and windows, add floors and roofs. Dimensions update as you draw.',
        bullets: [
          'Start from a template or trace a scanned plan',
          'Levels, gridlines and dimensions',
          'Undo anything',
        ],
        shot: SHOTS.builderPlan,
      },
      {
        title: 'See it in 3D',
        description:
          'Every wall and floor is a real model. Orbit around it, cut sections and check heights before anything is built.',
        bullets: ['3D view with a section box', 'Sections through any level', 'Sloped roofs'],
        shot: SHOTS.builderIsometric,
      },
      {
        title: 'Fit your Auxx-Lift',
        description:
          'Place storage lifts on the ceiling and see right away whether the travel, the clearances and the cars underneath work.',
        bullets: [
          'Live height and clearance checks',
          'Lift types from the Auxx-Lift catalog',
          'Kit parts counted for you',
        ],
        shot: SHOTS.builderLifts,
      },
      {
        title: 'Print and share',
        description:
          'Put plans, sections and 3D views on sheets with a title block and export a PDF anyone can open.',
        bullets: ['Sheets and title blocks', 'Schedules and quantities', 'PDF export'],
        shot: SHOTS.builderSheet,
      },
    ],
  },
  {
    app: 'pdf',
    name: 'PDF',
    anchor: 'pdf',
    tagline: 'Read and measure the drawings',
    intro:
      'Open the drawings you were sent, mark them up and measure them to scale. Takeoff quantities go straight to the estimate.',
    points: ['Markups and comments', 'Measure to scale', 'Takeoff by condition'],
    rows: [
      {
        title: 'Mark up any drawing',
        description:
          'Clouds, callouts, text, stamps and comments with statuses. Bring markups in from Bluebeam and export standard PDF annotations.',
        bullets: ['Markups list with custom columns', 'Bluebeam markups in and out', 'Tool chest'],
        shot: SHOTS.pdfMarkups,
      },
      {
        title: 'Measure to scale',
        description:
          'Calibrate a page once and measure lengths, areas and counts that snap to the lines in the drawing.',
        bullets: ['Scales per page or region', 'Lengths, areas, counts', 'Snaps to the linework'],
        shot: SHOTS.pdfMeasure,
      },
      {
        title: 'Take off by condition',
        description:
          'Set up conditions for what you build, measure against them and read the quantities by zone and category.',
        bullets: ['Conditions and templates', 'Zones and categories', 'Summary by any column'],
        shot: SHOTS.pdfTakeoff,
      },
    ],
  },
  {
    app: 'estimator',
    name: 'Estimator',
    anchor: 'estimator',
    tagline: 'Price the job',
    intro:
      'Turn quantities into prices with your own cost book. When the drawings change, the estimate shows what changed and what it costs.',
    points: ['Cost books and assemblies', 'Priced from the takeoff', 'Proposals and quotes'],
    rows: [
      {
        title: 'Start from your costs',
        description:
          'Keep items, assemblies, crews and rate tables in a cost book, or import the cost data you already have.',
        bullets: ['Assemblies with formulas', 'Rate tables', 'Import from spreadsheets and WinEst'],
        shot: SHOTS.estimatorBook,
      },
      {
        title: 'Priced from the takeoff',
        description:
          'Bind estimate lines to the PDF takeoff or to the design itself. When a measurement changes, you review the change and its cost.',
        bullets: ['Bound to PDF takeoff', 'Bound to the design model', 'Revisions and compare'],
        shot: SHOTS.estimatorBound,
      },
      {
        title: 'Send the proposal',
        description:
          'Options, alternates and scenarios, then a proposal PDF. For Auxx-Lift dealers, a quote straight from the garage design.',
        bullets: ['Options and alternates', 'Proposal PDF', 'Quote from a design'],
        shot: SHOTS.estimatorProposal,
      },
    ],
  },
]

/** How the three apps hand work to each other. */
export const WORKFLOW: { app: TapeApp; title: string; description: string }[] = [
  {
    app: 'builder',
    title: 'Design',
    description: 'Draw the building in Builder, or start from drawings you already have.',
  },
  {
    app: 'pdf',
    title: 'Measure',
    description: 'Open the drawings in PDF, measure to scale and take off by condition.',
  },
  {
    app: 'estimator',
    title: 'Estimate',
    description: 'Quantities flow into the Estimator from the takeoff or straight from the model.',
  },
  {
    app: 'estimator',
    title: 'Quote and share',
    description: 'Send the proposal, the sheets and the marked-up drawings.',
  },
]

/** Capabilities across the product, for the numbered grid. */
export const FEATURES: { app: TapeApp; title: string; description: string }[] = [
  {
    app: 'builder',
    title: 'In the browser',
    description: 'Nothing to install. Or use the desktop app for Mac and Windows.',
  },
  {
    app: 'pdf',
    title: 'Sets keep it together',
    description: 'A project’s designs, drawings and estimates open together in one set.',
  },
  {
    app: 'builder',
    title: 'Schedules',
    description: 'Tables of lifts, openings, beams and joists with counts and lengths.',
  },
  {
    app: 'builder',
    title: 'Trace a scan',
    description: 'Put a scanned plan or a PDF under the design and draw over it.',
  },
  {
    app: 'pdf',
    title: 'Compare drawings',
    description: 'See what changed between two versions of a sheet, clouded for you.',
  },
  {
    app: 'estimator',
    title: 'Change orders',
    description: 'Save revisions, compare them and print the change order.',
  },
  {
    app: 'estimator',
    title: 'Your cost data',
    description: 'Import cost books from Excel, CSV and WinEst and keep them up to date.',
  },
  {
    app: 'pdf',
    title: 'Works with your AI',
    description:
      'Connect an AI assistant over MCP to read and edit designs, takeoff and estimates.',
  },
]

export const FAQS: { question: string; answer: string }[] = [
  {
    question: 'Is Auxx Builder really free?',
    answer:
      'Yes. Builder, PDF and Estimator are free to use today, with no credit card. Open builder.auxx.ai and start.',
  },
  {
    question: 'Do I need to install anything?',
    answer:
      'No. All three apps run in your browser. There is also a desktop app for Mac and Windows if you prefer working with files on your computer.',
  },
  {
    question: 'Do I have to use all three apps?',
    answer:
      'No. Use only the one you need: design a garage in Builder, measure drawings in PDF or price a job in the Estimator. They connect when you use them together.',
  },
  {
    question: 'Do I need to know CAD or Revit?',
    answer:
      'No. Drawing walls is click and click. If you do know Revit or AutoCAD, the shortcuts and the way views, levels and sheets work will feel familiar.',
  },
  {
    question: 'Can I open PDFs I got from an architect?',
    answer:
      'Yes. Open any PDF drawing, calibrate its scale and measure it. Markups made in Bluebeam come in as markups you can edit.',
  },
  {
    question: 'Can I bring my own cost data?',
    answer:
      'Yes. Import cost books from Excel or CSV files and from WinEst, and update them from new files later.',
  },
  {
    question: 'Do I have to use Auxx-Lift products?',
    answer:
      'No. Auxx Builder is a general building and estimating tool. Auxx-Lift storage lifts are built in for dealers and homeowners who want them, with height and clearance checks.',
  },
]

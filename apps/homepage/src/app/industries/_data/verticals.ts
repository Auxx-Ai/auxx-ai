// apps/homepage/src/app/industries/_data/verticals.ts

/** Icon keys mapped to lucide-react components in industry-features.tsx. */
export type IndustryFeatureIcon = 'repeat' | 'zap' | 'clipboard' | 'map' | 'file' | 'bell'

type BoardChipTone = 'sky' | 'emerald' | 'amber' | 'violet' | 'muted'

/** Mirrors the `rows` prop of `MockMiniBoard` (platform/dispatch/_mocks/board-mock.tsx). */
export interface IndustryBoardRow {
  worker: string
  tone: 'sky' | 'emerald' | 'amber' | 'violet'
  chips: { label: string; start: number; span: number; tone: BoardChipTone }[]
}

export interface IndustryVertical {
  slug: string
  name: string
  /** Trade name as it appears mid-sentence, with article — e.g. 'an HVAC', 'a plumbing' */
  proseNameWithArticle: string
  /** Trade name as it appears mid-sentence without article — e.g. 'HVAC', 'plumbing' */
  proseName: string
  /** `${metaTitle} | ${config.shortName}` */
  metaTitle: string
  metaDescription: string
  badge: string
  heroHeadline: string
  heroSubline: string
  painPoints: { title: string; description: string }[]
  workflowSteps: { title: string; description: string }[]
  featureEmphasis: { title: string; description: string; icon: IndustryFeatureIcon }[]
  sampleFields: { label: string; value: string }[]
  boardRows: IndustryBoardRow[]
  faqs: { question: string; answer: string }[]
}

const hvac: IndustryVertical = {
  slug: 'hvac',
  name: 'HVAC',
  proseNameWithArticle: 'an HVAC',
  proseName: 'HVAC',
  metaTitle: 'HVAC Dispatch & Scheduling Software',
  metaDescription:
    'HVAC dispatch software for scheduling techs, tracking equipment history, and quoting installs — work orders, quotes, and invoicing on one board.',
  badge: 'For HVAC shops',
  heroHeadline: 'HVAC dispatch software built around your equipment history.',
  heroSubline:
    'Schedule techs, track the model, serial, and refrigerant type on every unit, and quote the next install without digging through paper files.',
  painPoints: [
    {
      title: 'The seasonal crunch buries the board',
      description:
        'Summer and winter swings pack the schedule solid, then go quiet for months. A board that only works at steady volume falls apart the first week of a heat wave.',
    },
    {
      title: 'Equipment history lives in three different places',
      description:
        'The model and serial number are in a tech’s notebook, the warranty date is in an email, and the refrigerant type is a guess until someone climbs on the roof.',
    },
    {
      title: 'Quotes and installs don’t talk to each other',
      description:
        'A quote gets approved over the phone, but nothing tells the board to schedule it — so the install gets remembered instead of dispatched.',
    },
  ],
  workflowSteps: [
    {
      title: 'Request comes in',
      description:
        'A call about a furnace that won’t start or a request for an AC quote becomes a service request in one intake screen — phone, walk-in, or ticket.',
    },
    {
      title: 'Quote the job',
      description:
        'Price the repair or the full system replacement, send it for approval, and the approved quote becomes a work order automatically — no re-entry.',
    },
    {
      title: 'Dispatch the tech',
      description:
        'Drag the job onto the board next to the tech with the right availability. They get a dispatch notification the moment it’s scheduled.',
    },
    {
      title: 'Invoice on completion',
      description:
        'The tech marks the job done from their phone, notes and photos attach to the record, and the invoice goes out the same day.',
    },
  ],
  featureEmphasis: [
    {
      title: 'Equipment records that follow the unit',
      description:
        'Model, serial, refrigerant type, filter size, and install date live on the job record and carry forward into the next visit for that unit.',
      icon: 'clipboard',
    },
    {
      title: 'Quotes that turn into scheduled work',
      description:
        'Price a repair or a full system replacement, send it for approval, and the approved quote becomes a work order — no separate system for installs.',
      icon: 'file',
    },
    {
      title: 'A board built for seasonal swings',
      description:
        'Availability and time-off shading show who actually has room for another emergency call during a heat wave, not just who was free this morning.',
      icon: 'zap',
    },
  ],
  sampleFields: [
    { label: 'Equipment', value: 'Trane XR16 condenser' },
    { label: 'Model / Serial', value: 'XR16036 / A3J29812' },
    { label: 'Refrigerant', value: 'R-410A' },
    { label: 'Filter size', value: '20x25x1' },
    { label: 'Warranty until', value: 'Aug 2028' },
  ],
  boardRows: [
    {
      worker: 'Marcus T.',
      tone: 'sky',
      chips: [
        { label: 'AC compressor swap — Lakeside Dental', start: 1, span: 4, tone: 'sky' },
        { label: 'Furnace tune-up — Alder Grove HOA', start: 6, span: 3, tone: 'emerald' },
      ],
    },
    {
      worker: 'Dana K.',
      tone: 'emerald',
      chips: [
        { label: 'Heat pump inspection — Ridgeline Offices', start: 2, span: 3, tone: 'amber' },
        { label: 'Refrigerant recharge — Court St Diner', start: 8, span: 3, tone: 'sky' },
      ],
    },
    {
      worker: 'Luis R.',
      tone: 'amber',
      chips: [
        { label: 'Install quote walkthrough — Birchwood Homes', start: 3, span: 4, tone: 'violet' },
      ],
    },
  ],
  faqs: [
    {
      question: 'Can I track equipment details like model and serial number on every job?',
      answer:
        'Yes. Work orders are records with custom fields, so you can add equipment, model/serial, refrigerant type, filter size, and warranty date — and every field carries forward into future visits for that unit.',
    },
    {
      question: 'Does the software handle installs and repairs, or just repairs?',
      answer:
        'Both. Quote a repair or a full system replacement, send it for approval, and the approved quote turns into a scheduled job automatically — no separate system for installs.',
    },
    {
      question: 'How do I handle summer and winter volume swings?',
      answer:
        'The dispatch board shows availability and time-off shading in real time, so during a heat wave or cold snap you can see exactly who has room for another emergency call.',
    },
    {
      question: 'Can technicians see their schedule and update jobs from their phone?',
      answer:
        'Yes. Techs get a mobile schedule with a status button (En route → On site → Done), plus completion notes and photo attachments — no separate app to install.',
    },
    {
      question: 'Does it handle quoting and invoicing, or do I need another tool?',
      answer:
        'Quoting, approval, invoicing, deposits, and payments are all built in, along with PDF documents for both quotes and invoices.',
    },
  ],
}

const plumbing: IndustryVertical = {
  slug: 'plumbing',
  name: 'Plumbing',
  proseNameWithArticle: 'a plumbing',
  proseName: 'plumbing',
  metaTitle: 'Plumbing Dispatch & Scheduling Software',
  metaDescription:
    'Plumbing scheduling software for same-day dispatch, job photos as proof of work, and invoicing — from emergency call to paid invoice on one board.',
  badge: 'For plumbing companies',
  heroHeadline: 'Plumbing dispatch software built for the calls that can’t wait.',
  heroSubline:
    'Get an emergency call onto the board in seconds, route the closest available plumber, and close the job with photos and an invoice before you leave the driveway.',
  painPoints: [
    {
      title: 'Emergency calls blow up the day’s plan',
      description:
        'A burst pipe call means the whole board reshuffles. Sticky notes and group texts can’t keep up with that kind of change more than once a day.',
    },
    {
      title: 'Callbacks with no job history',
      description:
        'A customer calls back about a leak from six months ago and nobody remembers what pipe material was behind that wall or what part got replaced.',
    },
    {
      title: 'Paper invoices go missing',
      description:
        'A handwritten invoice left on a counter is a payment you may never collect. Chasing it down by phone eats the profit on the job.',
    },
  ],
  workflowSteps: [
    {
      title: 'Call comes in',
      description:
        'A call about a leak, a clogged drain, or a failed water heater becomes a service request in seconds — no separate system to open mid-call.',
    },
    {
      title: 'Quote or dispatch same day',
      description:
        'Quote the fix if it can wait, or skip straight to dispatch for anything that can’t — the record moves either way.',
    },
    {
      title: 'Route the closest plumber',
      description:
        'Drag the job onto the board next to whoever’s closest and free. They get a dispatch notification the second it’s assigned.',
    },
    {
      title: 'Invoice with photos attached',
      description:
        'Before-and-after photos and completion notes attach to the job on site, and the invoice goes out — no paper to lose.',
    },
  ],
  featureEmphasis: [
    {
      title: 'A board built for same-day dispatch',
      description:
        'Availability and time-off shading show who’s free right now, not who was free when the schedule was made this morning.',
      icon: 'zap',
    },
    {
      title: 'Photos and notes as proof of work',
      description:
        'Completion notes and before-and-after photos attach to the job the moment it’s marked done — proof of work if a customer calls back.',
      icon: 'clipboard',
    },
    {
      title: 'Route the closest plumber, not the next one on the list',
      description:
        'The route planner suggests the shortest run between jobs so an emergency call goes to whoever can actually get there first.',
      icon: 'map',
    },
  ],
  sampleFields: [
    { label: 'Fixture', value: 'Kitchen sink' },
    { label: 'Pipe material', value: 'PEX' },
    { label: 'Permit #', value: 'PL-22841' },
    { label: 'Shutoff location', value: 'Basement, north wall' },
    { label: 'Water heater age', value: '9 years' },
  ],
  boardRows: [
    {
      worker: 'Priya S.',
      tone: 'violet',
      chips: [
        { label: 'Burst pipe — Fairview Apartments Unit 4', start: 1, span: 3, tone: 'amber' },
        { label: 'Water heater install — Nguyen residence', start: 5, span: 4, tone: 'sky' },
      ],
    },
    {
      worker: 'Marcus T.',
      tone: 'sky',
      chips: [{ label: 'Drain clearing — Hilltop Cafe', start: 2, span: 3, tone: 'violet' }],
    },
    {
      worker: 'Luis R.',
      tone: 'amber',
      chips: [
        { label: 'Fixture replacement quote — Court St Diner', start: 4, span: 3, tone: 'sky' },
        { label: 'Shutoff valve repair — Birchwood Homes', start: 8, span: 3, tone: 'emerald' },
      ],
    },
  ],
  faqs: [
    {
      question: 'Can I dispatch an emergency job the same day it comes in?',
      answer:
        'Yes. A call becomes a service request in seconds, and you can convert it straight to a scheduled job and drag it onto the board next to whoever’s closest and free.',
    },
    {
      question: 'How do I keep a record of what was fixed if a customer calls back?',
      answer:
        'Every job is a record with completion notes and photo attachments, plus a visit history tied to the customer — so you can see exactly what pipe material or part was involved last time.',
    },
    {
      question: 'Can I track permit numbers and shutoff locations on a job?',
      answer:
        'Yes. Add custom fields like permit #, pipe material, and shutoff location to work orders, and they show up on every future visit for that address.',
    },
    {
      question: 'Does it help route techs between jobs?',
      answer:
        'The route planner suggests the shortest run between stops and lets you drag to reorder or reassign — useful for slotting an emergency call into an already-full day.',
    },
    {
      question: 'Can customers pay online?',
      answer:
        'Yes. Invoices, deposits, and payments are built in, with PDF documents for both quotes and invoices.',
    },
  ],
}

const pestControl: IndustryVertical = {
  slug: 'pest-control',
  name: 'Pest Control',
  proseNameWithArticle: 'a pest control',
  proseName: 'pest control',
  metaTitle: 'Pest Control Scheduling Software',
  metaDescription:
    'Pest control scheduling software for recurring treatment routes, chemical and target-pest records, and invoicing — quarterly visits that schedule themselves.',
  badge: 'For pest control operators',
  heroHeadline: 'Pest control software where recurring treatments schedule themselves.',
  heroSubline:
    'Set a quarterly or monthly route once and the visits keep generating — with the target pest, chemicals, and treatment areas logged on every job.',
  painPoints: [
    {
      title: 'Recurring routes live in a spreadsheet',
      description:
        'Quarterly and monthly accounts get tracked in a spreadsheet someone has to remember to check every week, or a visit quietly slips a month.',
    },
    {
      title: 'Chemical and treatment records are scattered',
      description:
        'What chemical was used, where, and how much matters for compliance and liability — and it shouldn’t live in a technician’s notebook.',
    },
    {
      title: 'Route density kills the day',
      description:
        'Ten stops that are ten minutes apart beat four stops that are forty minutes apart. Without route planning, density is luck.',
    },
  ],
  workflowSteps: [
    {
      title: 'Account signs up',
      description:
        'A new quarterly or monthly account becomes a service request, then a recurring job with the treatment schedule built in from the start.',
    },
    {
      title: 'Quote the treatment plan',
      description:
        'Price the initial treatment and the ongoing service plan, send it for approval, and the approved quote sets up the recurring job.',
    },
    {
      title: 'Visits generate and dispatch themselves',
      description:
        'Each visit rolls onto the board on schedule — nobody has to remember to book the next quarterly stop.',
    },
    {
      title: 'Invoice on a schedule, not a memory',
      description:
        'Each completed visit closes out with treatment notes and an invoice, so recurring revenue doesn’t depend on someone remembering to bill it.',
    },
  ],
  featureEmphasis: [
    {
      title: 'Recurring visits that generate themselves',
      description:
        'Set a quarterly or monthly schedule once and new visits roll onto the board automatically — nothing depends on someone remembering.',
      icon: 'repeat',
    },
    {
      title: 'Treatment records on every visit',
      description:
        'Target pest, chemicals used, and treatment areas log to the job record every time — the history a compliance question or a callback needs.',
      icon: 'clipboard',
    },
    {
      title: 'Route density that keeps techs moving',
      description:
        'The route planner groups stops so a tech’s day is ten close-together visits, not four spread across the county.',
      icon: 'map',
    },
  ],
  sampleFields: [
    { label: 'Target pest', value: 'German cockroach' },
    { label: 'Treatment type', value: 'Interior + exterior spray' },
    { label: 'Chemicals used', value: 'Suspend Polyzone' },
    { label: 'Treatment areas', value: 'Kitchen, basement, perimeter' },
    { label: 'Reservice due', value: 'Oct 12, 2026' },
  ],
  boardRows: [
    {
      worker: 'Dana K.',
      tone: 'emerald',
      chips: [
        { label: 'Quarterly treatment — Hawthorne Apartments', start: 1, span: 3, tone: 'emerald' },
        { label: 'Rodent exclusion — Birchfield Warehouse', start: 5, span: 3, tone: 'sky' },
      ],
    },
    {
      worker: 'Priya S.',
      tone: 'violet',
      chips: [
        { label: 'Termite inspection — Union Square Row Homes', start: 2, span: 3, tone: 'violet' },
        { label: 'Monthly service — Court St Diner', start: 6, span: 2, tone: 'emerald' },
      ],
    },
    {
      worker: 'Luis R.',
      tone: 'amber',
      chips: [{ label: 'Quarterly treatment — Alder Grove HOA', start: 3, span: 3, tone: 'amber' }],
    },
  ],
  faqs: [
    {
      question: 'Can I schedule quarterly or monthly pest control treatments automatically?',
      answer:
        'Yes — recurring jobs generate new visits on a rolling schedule, so a quarterly or monthly account doesn’t depend on anyone remembering to book the next stop.',
    },
    {
      question: 'Can I log the chemicals and treatment areas used on each visit?',
      answer:
        'Yes. Add custom fields like target pest, treatment type, chemicals used, and treatment areas to the work order, and they’re logged on every visit.',
    },
    {
      question: 'How do I keep a dense, efficient route for a day of treatments?',
      answer:
        'The route planner groups nearby stops and suggests an order, with drag-to-reorder if a same-day request comes in.',
    },
    {
      question: 'What happens if a technician can’t complete a treatment as scheduled?',
      answer:
        'You can reschedule the visit from the board without disrupting the recurring schedule for future visits.',
    },
    {
      question: 'Does it handle invoicing for recurring accounts?',
      answer:
        'Yes. Each completed visit can be invoiced individually, with payments and deposits built in.',
    },
  ],
}

export const VERTICALS: Record<string, IndustryVertical> = {
  hvac,
  plumbing,
  'pest-control': pestControl,
}

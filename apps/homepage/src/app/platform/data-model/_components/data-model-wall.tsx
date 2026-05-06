// apps/homepage/src/app/platform/data-model/_components/data-model-wall.tsx

import {
  Anchor,
  Boxes,
  Braces,
  Code,
  Code2,
  FileCode,
  FileText,
  FileUp,
  Globe,
  HardDrive,
  Heading,
  History,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  Library,
  Link as LinkIcon,
  List,
  ListOrdered,
  Lock,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Moon,
  Palette,
  PenLine,
  Quote,
  RefreshCw,
  ScanText,
  Search,
  Sparkles,
  Table2,
  Table as TableIcon,
  Upload,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '~/lib/utils'

const COL_START: Record<number, string> = {
  1: 'col-start-1',
  2: 'col-start-2',
  3: 'col-start-3',
  4: 'col-start-4',
  5: 'col-start-5',
  6: 'col-start-6',
  7: 'col-start-7',
  8: 'col-start-8',
  9: 'col-start-9',
  10: 'col-start-10',
}

const ROW_START: Record<number, string> = {
  1: 'row-start-1',
  2: 'row-start-2',
  3: 'row-start-3',
  4: 'row-start-4',
  5: 'row-start-5',
  6: 'row-start-6',
  7: 'row-start-7',
  8: 'row-start-8',
  9: 'row-start-9',
  10: 'row-start-10',
  11: 'row-start-11',
}

const COL_SPAN: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
}

const ROW_SPAN: Record<number, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
}

function pos(col: number, row: number, colSpan?: number, rowSpan?: number) {
  return cn(
    COL_START[col],
    ROW_START[row],
    colSpan ? COL_SPAN[colSpan] : null,
    rowSpan ? ROW_SPAN[rowSpan] : null
  )
}

interface TilePositionProps {
  col: number
  row: number
  colSpan?: number
  rowSpan?: number
  className?: string
}

function EmptyTile({ col, row, colSpan, rowSpan, className }: TilePositionProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'border-border-illustration border border-dashed',
        pos(col, row, colSpan, rowSpan),
        className
      )}
    />
  )
}

interface SmallTileProps extends TilePositionProps {
  icon: ReactNode
  label: string
  href?: string
}

function SmallTile({ icon, label, col, row, colSpan, rowSpan, href, className }: SmallTileProps) {
  const inner = (
    <div className='text-foreground/75 flex h-full w-full flex-col items-center justify-center gap-1.5 [&>span>svg]:size-5'>
      <span>{icon}</span>
      <span className='text-xs font-medium'>{label}</span>
    </div>
  )
  return (
    <div
      className={cn(
        'border-border-illustration relative border border-dashed transition-colors',
        href && 'hover:bg-muted/40',
        pos(col, row, colSpan, rowSpan),
        className
      )}>
      {href ? (
        <Link href={href} className='block h-full w-full'>
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  )
}

interface ParentTileProps extends TilePositionProps {
  icon: ReactNode
  title: string
  href: string
  illustration: ReactNode
}

function ParentTile({
  icon,
  title,
  href,
  illustration,
  col,
  row,
  colSpan = 2,
  rowSpan = 2,
  className,
}: ParentTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group bg-card ring-border-illustration relative flex flex-col overflow-hidden rounded-2xl shadow-xl shadow-black/[.065] ring-1 transition-transform duration-300 hover:scale-[1.015]',
        pos(col, row, colSpan, rowSpan),
        className
      )}>
      <div className='relative flex-1 overflow-hidden'>{illustration}</div>
      <div className='border-border-illustration flex items-center gap-2 border-t px-4 py-3'>
        <span className='text-foreground [&>svg]:size-5'>{icon}</span>
        <span className='text-foreground text-base font-semibold'>{title}</span>
      </div>
    </Link>
  )
}

function KbIllustration() {
  return (
    <div className='from-card to-muted/30 flex h-full w-full flex-col gap-1.5 bg-gradient-to-br p-3'>
      <div className='bg-foreground/15 h-1.5 w-2/3 rounded-full' />
      <div className='bg-foreground/10 h-1 w-full rounded-full' />
      <div className='bg-foreground/10 h-1 w-5/6 rounded-full' />
      <div className='bg-foreground/10 h-1 w-3/4 rounded-full' />
      <div className='bg-foreground/15 mt-1.5 h-1.5 w-1/2 rounded-full' />
      <div className='bg-foreground/10 h-1 w-full rounded-full' />
      <div className='bg-foreground/10 h-1 w-4/5 rounded-full' />
    </div>
  )
}

function DatasetsIllustration() {
  return (
    <div className='from-card to-muted/30 relative flex h-full w-full items-center justify-center bg-gradient-to-br p-3'>
      <div className='relative h-full w-full'>
        <FileChip label='PDF' className='absolute left-3 top-2 -rotate-6' />
        <FileChip
          label='DOCX'
          className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-2'
        />
        <FileChip label='HTML' className='absolute bottom-2 right-3 rotate-6' />
      </div>
    </div>
  )
}

function FileChip({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        'bg-card ring-border-illustration flex items-center gap-1.5 rounded-md px-2 py-1 shadow-md shadow-black/10 ring-1',
        className
      )}>
      <FileText className='text-foreground/60 size-3' />
      <span className='text-foreground text-[10px] font-semibold tracking-wide'>{label}</span>
    </div>
  )
}

const MASK =
  '[mask-image:radial-gradient(ellipse_95%_90%_at_center,black_72%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_95%_90%_at_center,black_72%,transparent_100%)]'

/**
 * Desktop wall — 10×8 grid.
 * Outer fade ring on all 4 sides (cols 1, 10 + rows 1, 8).
 * Content middle ring on all 4 sides (24 feature tiles).
 * Inner content area: cols 3-8, rows 3-6.
 */
function DesktopWall() {
  // Outer fade ring (faded by mask)
  const outerRing: Array<[number, number]> = []
  for (let c = 1; c <= 10; c++) {
    outerRing.push([c, 1], [c, 8])
  }
  for (let r = 2; r <= 7; r++) {
    outerRing.push([1, r], [10, r])
  }

  // Content middle ring — all four sides (24 tiles)
  const middleTiles: Array<{ col: number; row: number; icon: ReactNode; label: string }> = [
    // Row 2 (top): KB on left, Datasets on right
    { col: 2, row: 2, icon: <Palette />, label: 'Themes' },
    { col: 3, row: 2, icon: <Moon />, label: 'Dark mode' },
    { col: 4, row: 2, icon: <Globe />, label: 'Public' },
    { col: 5, row: 2, icon: <Lock />, label: 'Private' },
    { col: 6, row: 2, icon: <Upload />, label: 'Drag & drop' },
    { col: 7, row: 2, icon: <FileUp />, label: 'Bulk upload' },
    { col: 8, row: 2, icon: <Workflow />, label: 'Crawler' },
    { col: 9, row: 2, icon: <RefreshCw />, label: 'Sync' },
    // Col 2 (left): KB block types
    { col: 2, row: 3, icon: <Heading />, label: 'Headings' },
    { col: 2, row: 4, icon: <List />, label: 'Lists' },
    { col: 2, row: 5, icon: <Code2 />, label: 'Code' },
    { col: 2, row: 6, icon: <Quote />, label: 'Quotes' },
    // Col 9 (right): Dataset formats
    { col: 9, row: 3, icon: <Table2 />, label: 'CSV' },
    { col: 9, row: 4, icon: <Braces />, label: 'JSON' },
    { col: 9, row: 5, icon: <HardDrive />, label: 'Drive' },
    { col: 9, row: 6, icon: <FileText />, label: 'Plain text' },
    // Row 7 (bottom): KB on left, Datasets on right
    { col: 2, row: 7, icon: <FileCode />, label: 'Markdown' },
    { col: 3, row: 7, icon: <ImageIcon />, label: 'Images' },
    { col: 4, row: 7, icon: <LinkIcon />, label: 'Embeds' },
    { col: 5, row: 7, icon: <Megaphone />, label: 'Callouts' },
    { col: 6, row: 7, icon: <LayoutGrid />, label: 'Chunking' },
    { col: 7, row: 7, icon: <Boxes />, label: 'Vector search' },
    { col: 8, row: 7, icon: <ListOrdered />, label: 'Reranker' },
    { col: 9, row: 7, icon: <ScanText />, label: 'OCR' },
  ]

  return (
    <div className='mx-auto hidden w-full max-w-[70rem] md:block'>
      <div
        className={cn('grid grid-cols-10', MASK)}
        style={{ gridTemplateRows: 'repeat(8, 6.5rem)' }}>
        {outerRing.map(([c, r]) => (
          <EmptyTile key={`o-${c}-${r}`} col={c} row={r} />
        ))}
        {middleTiles.map((t) => (
          <SmallTile
            key={`m-${t.col}-${t.row}`}
            col={t.col}
            row={t.row}
            icon={t.icon}
            label={t.label}
          />
        ))}

        {/* Parent tiles */}
        <ParentTile
          col={3}
          row={3}
          href='/platform/data-model#knowledge-base'
          icon={<Library />}
          title='Knowledge base'
          illustration={<KbIllustration />}
        />
        <ParentTile
          col={7}
          row={5}
          href='/platform/data-model#datasets'
          icon={<Boxes />}
          title='Datasets'
          illustration={<DatasetsIllustration />}
        />

        {/* Row 3: cols 5,6,7,8 */}
        <SmallTile col={5} row={3} icon={<Search />} label='Search' />
        <SmallTile col={6} row={3} icon={<Quote />} label='Citations' />
        <SmallTile col={7} row={3} icon={<FileText />} label='PDF' />
        <SmallTile col={8} row={3} icon={<FileText />} label='DOCX' />

        {/* Row 4: cols 5,6 (seam), cols 7,8 (above Datasets) */}
        <SmallTile
          col={5}
          row={4}
          icon={<Sparkles />}
          label='Kopilot'
          href='/platform/ai/kopilot'
        />
        <SmallTile col={6} row={4} icon={<MessageSquare />} label='AI replies' />
        <SmallTile col={7} row={4} icon={<Code />} label='HTML' />
        <SmallTile col={8} row={4} icon={<LinkIcon />} label='Web pages' />

        {/* Row 5: cols 3,4,5,6 */}
        <SmallTile col={3} row={5} icon={<PenLine />} label='Editor' />
        <SmallTile col={4} row={5} icon={<TableIcon />} label='Tables' />
        <SmallTile col={5} row={5} icon={<Anchor />} label='Grounding' />
        <SmallTile col={6} row={5} icon={<Boxes />} label='Embeddings' />

        {/* Row 6: cols 3,4,5,6 (cols 7,8 occupied by Datasets) */}
        <SmallTile col={3} row={6} icon={<History />} label='Versioning' />
        <SmallTile col={4} row={6} icon={<LayoutTemplate />} label='Templates' />
        <SmallTile col={5} row={6} icon={<Globe />} label='Public portal' />
        <SmallTile col={6} row={6} icon={<MessageCircle />} label='Comments' />
      </div>
    </div>
  )
}

/**
 * Mobile wall — 6 cols × 11 rows.
 *
 * Conceptually a 4×9 layout (F edge + C C inner + F edge), but the grid
 * is widened to 6 cols × 11 rows so phantom outer cols (1, 6) and
 * phantom outer rows (1, 11) hold the half of each edge tile that gets
 * masked away. Edge tiles span into the phantom regions so they render
 * at full inner-tile size while only their inner half stays visible.
 *
 * Col tracks: '1fr 1fr 2fr 2fr 1fr 1fr' (= 8fr).
 * Row tracks: '0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 0.5fr 0.5fr' (= 9fr).
 *
 * Single radial-gradient mask fades the phantom regions (and corners
 * diagonally) — same approach as desktop, tuned for the 4:9 aspect.
 */
const MOBILE_MASK_STYLE: CSSProperties = {
  maskImage: 'radial-gradient(ellipse farthest-side at center, black 78%, transparent 100%)',
  WebkitMaskImage: 'radial-gradient(ellipse farthest-side at center, black 78%, transparent 100%)',
}

function MobileWall() {
  return (
    <div className='block w-full md:hidden'>
      <div
        className='grid w-full'
        style={{
          ...MOBILE_MASK_STYLE,
          aspectRatio: '4 / 9',
          gridTemplateColumns: '1fr 1fr 2fr 2fr 1fr 1fr',
          gridTemplateRows: '0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 0.5fr 0.5fr',
        }}>
        {/* Top edge row (rows 1–2): F F F F — 4 tiles, top half faded */}
        <SmallTile col={1} colSpan={2} row={1} rowSpan={2} icon={<Heading />} label='Headings' />
        <SmallTile col={3} row={1} rowSpan={2} icon={<List />} label='Lists' />
        <SmallTile col={4} row={1} rowSpan={2} icon={<Code2 />} label='Code' />
        <SmallTile col={5} colSpan={2} row={1} rowSpan={2} icon={<Quote />} label='Quotes' />

        {/* Top content row (row 3): F C C F */}
        <SmallTile col={1} colSpan={2} row={3} icon={<Palette />} label='Themes' />
        <SmallTile col={3} row={3} icon={<Moon />} label='Dark mode' />
        <SmallTile col={4} row={3} icon={<Globe />} label='Public' />
        <SmallTile col={5} colSpan={2} row={3} icon={<Lock />} label='Private' />

        {/* KB rows (rows 4-5): F [KB] F + F [KB] F */}
        <SmallTile col={1} colSpan={2} row={4} icon={<Upload />} label='Drag & drop' />
        <SmallTile col={5} colSpan={2} row={4} icon={<FileUp />} label='Bulk upload' />
        <ParentTile
          col={3}
          row={4}
          href='/platform/data-model#knowledge-base'
          icon={<Library />}
          title='Knowledge base'
          illustration={<KbIllustration />}
        />
        <SmallTile col={1} colSpan={2} row={5} icon={<Workflow />} label='Crawler' />
        <SmallTile col={5} colSpan={2} row={5} icon={<RefreshCw />} label='Sync' />

        {/* Middle content row (row 6): F C C F */}
        <SmallTile col={1} colSpan={2} row={6} icon={<Search />} label='Search' />
        <SmallTile
          col={3}
          row={6}
          icon={<Sparkles />}
          label='Kopilot'
          href='/platform/ai/kopilot'
        />
        <SmallTile col={4} row={6} icon={<MessageSquare />} label='AI replies' />
        <SmallTile col={5} colSpan={2} row={6} icon={<Quote />} label='Citations' />

        {/* DS rows (rows 7-8): F [DS] F + F [DS] F */}
        <SmallTile col={1} colSpan={2} row={7} icon={<FileText />} label='PDF' />
        <SmallTile col={5} colSpan={2} row={7} icon={<FileText />} label='DOCX' />
        <ParentTile
          col={3}
          row={7}
          href='/platform/data-model#datasets'
          icon={<Boxes />}
          title='Datasets'
          illustration={<DatasetsIllustration />}
        />
        <SmallTile col={1} colSpan={2} row={8} icon={<Code />} label='HTML' />
        <SmallTile col={5} colSpan={2} row={8} icon={<LinkIcon />} label='Web pages' />

        {/* Bottom content row (row 9): F C C F */}
        <SmallTile col={1} colSpan={2} row={9} icon={<Table2 />} label='CSV' />
        <SmallTile col={3} row={9} icon={<Braces />} label='JSON' />
        <SmallTile col={4} row={9} icon={<HardDrive />} label='Drive' />
        <SmallTile col={5} colSpan={2} row={9} icon={<FileText />} label='Plain text' />

        {/* Bottom edge row (rows 10-11): F F F F — 4 tiles, bottom half faded */}
        <SmallTile col={1} colSpan={2} row={10} rowSpan={2} icon={<FileCode />} label='Markdown' />
        <SmallTile col={3} row={10} rowSpan={2} icon={<Boxes />} label='Vector search' />
        <SmallTile col={4} row={10} rowSpan={2} icon={<ListOrdered />} label='Reranker' />
        <SmallTile col={5} colSpan={2} row={10} rowSpan={2} icon={<ScanText />} label='OCR' />
      </div>
    </div>
  )
}

export function DataModelWall() {
  return (
    <>
      <DesktopWall />
      <MobileWall />
    </>
  )
}

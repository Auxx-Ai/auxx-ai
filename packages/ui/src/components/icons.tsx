// packages/ui/src/components/icons.tsx
'use client'

import React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  // General UI
  Home,
  Settings,
  Search,
  Menu,
  X,
  Plus,
  Minus,
  Equal,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  // Communication
  Mail,
  MessageSquare,
  MessageCircle,
  Phone,
  Bell,
  BellRing,
  Send,
  Inbox,
  // User/Profile
  User,
  Users,
  UserPlus,
  UserMinus,
  UserCheck,
  UserX,
  CircleUser,
  // Files/Documents
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileType,
  FileSpreadsheet,
  FileCode,
  Archive,
  Folder,
  FolderOpen,
  Upload,
  Download,
  Paperclip,
  Link,
  FileJson,
  Tags,
  // Actions
  Edit,
  Trash,
  Copy,
  Clipboard,
  Save,
  Share,
  ExternalLink,
  MoreHorizontal,
  MoreVertical,
  // Media
  Image,
  Video,
  Music,
  Camera,
  Play,
  Pause,
  Volume2,
  VolumeX,
  // Business
  Briefcase,
  Building,
  Calendar,
  Clock,
  CreditCard,
  DollarSign,
  ShoppingCart,
  Package,
  // Data/Charts
  BarChart,
  LineChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
  // Status
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  CheckCircle,
  XCircle,
  Ban,
  // Tools
  Wrench,
  Hammer,
  Key,
  Lock,
  Unlock,
  Shield,
  Zap,
  Lightbulb,
  // Navigation
  Compass,
  Map,
  MapPin,
  Globe,
  Navigation,
  // Misc
  Star,
  Heart,
  Bookmark,
  Tag,
  Flag,
  Award,
  Gift,
  Sparkles,
  // Additional useful icons
  Eye,
  EyeOff,
  Filter,
  RefreshCw,
  RotateCcw,
  Layers,
  Grid,
  List,
  Layout,
  Code,
  Terminal,
  Database,
  Server,
  Cloud,
  Wifi,
  Battery,
  Power,
  Sun,
  Moon,
  Circle,
  Square,
  Triangle,
  Hexagon,
  Target,
  Crosshair,
  Fingerprint,
  QrCode,
  Printer,
  Scan,
  // Workflow-specific icons
  GitBranch,
  StickyNote,
  Variable,
  Brain,
  Octagon,
  Repeat,
  ArrowUpDown,
  Webhook,
  Ticket,
  Box,
  Boxes,
  Type,
  Hash,
  ToggleLeft,
  Braces,
  Scissors,
  CaseSensitive,
  TextCursorInput,
  ListFilter,
  CalendarClock,
  ListChecks,
  Link2,
} from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@auxx/ui/lib/utils'

/** Color configuration for icons */
export interface IconColor {
  id: string
  label: string
  /** Preview swatch color (for color selector buttons) */
  swatch: string
  /** Icon text color - for rendering outside picker */
  iconColor: string
  /** Background classes - for rendering outside picker */
  bgClasses: string
  /** Inverse color scheme - solid bg with light icon, no hover */
  inverseColor: string
  /** CSS custom properties - for picker grid (performance) */
  groupClasses: string
}

/** Available icon colors */
export const ICON_COLORS: IconColor[] = [
  {
    id: 'gray',
    label: 'Gray',
    swatch: 'bg-zinc-500',
    iconColor: 'text-zinc-700 dark:text-zinc-300',
    bgClasses: 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700',
    inverseColor: 'bg-zinc-600 text-zinc-100 dark:bg-zinc-500',
    groupClasses:
      '[--icon-bg:var(--color-zinc-100)] [--icon-bg-hover:var(--color-zinc-200)] [--icon-color:var(--color-zinc-700)] dark:[--icon-bg:var(--color-zinc-800)] dark:[--icon-bg-hover:var(--color-zinc-700)] dark:[--icon-color:var(--color-zinc-300)]',
  },
  {
    id: 'red',
    label: 'Red',
    swatch: 'bg-red-500',
    iconColor: 'text-red-600 dark:text-red-400',
    bgClasses: 'bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900',
    inverseColor: 'bg-red-600 text-red-100 dark:bg-red-500',
    groupClasses:
      '[--icon-bg:var(--color-red-50)] [--icon-bg-hover:var(--color-red-100)] [--icon-color:var(--color-red-600)] dark:[--icon-bg:var(--color-red-950)] dark:[--icon-bg-hover:var(--color-red-900)] dark:[--icon-color:var(--color-red-400)]',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'bg-orange-500',
    iconColor: 'text-orange-600 dark:text-orange-400',
    bgClasses: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-950 dark:hover:bg-orange-900',
    inverseColor: 'bg-orange-600 text-orange-100 dark:bg-orange-500',
    groupClasses:
      '[--icon-bg:var(--color-orange-50)] [--icon-bg-hover:var(--color-orange-100)] [--icon-color:var(--color-orange-600)] dark:[--icon-bg:var(--color-orange-950)] dark:[--icon-bg-hover:var(--color-orange-900)] dark:[--icon-color:var(--color-orange-400)]',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgClasses: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-900',
    inverseColor: 'bg-amber-600 text-amber-100 dark:bg-amber-500',
    groupClasses:
      '[--icon-bg:var(--color-amber-50)] [--icon-bg-hover:var(--color-amber-100)] [--icon-color:var(--color-amber-600)] dark:[--icon-bg:var(--color-amber-950)] dark:[--icon-bg-hover:var(--color-amber-900)] dark:[--icon-color:var(--color-amber-400)]',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: 'bg-green-500',
    iconColor: 'text-green-600 dark:text-green-400',
    bgClasses: 'bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900',
    inverseColor: 'bg-green-500 text-green-100 dark:bg-green-500',
    groupClasses:
      '[--icon-bg:var(--color-green-50)] [--icon-bg-hover:var(--color-green-100)] [--icon-color:var(--color-green-600)] dark:[--icon-bg:var(--color-green-950)] dark:[--icon-bg-hover:var(--color-green-900)] dark:[--icon-color:var(--color-green-400)]',
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    iconColor: 'text-teal-600 dark:text-teal-400',
    bgClasses: 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900',
    inverseColor: 'bg-teal-500 text-teal-100 dark:bg-teal-500',
    groupClasses:
      '[--icon-bg:var(--color-teal-50)] [--icon-bg-hover:var(--color-teal-100)] [--icon-color:var(--color-teal-600)] dark:[--icon-bg:var(--color-teal-950)] dark:[--icon-bg-hover:var(--color-teal-900)] dark:[--icon-color:var(--color-teal-400)]',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    iconColor: 'text-blue-600 dark:text-blue-400',
    bgClasses: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900',
    inverseColor: 'bg-blue-500 text-blue-100 dark:bg-blue-500',
    groupClasses:
      '[--icon-bg:var(--color-blue-50)] [--icon-bg-hover:var(--color-blue-100)] [--icon-color:var(--color-blue-600)] dark:[--icon-bg:var(--color-blue-950)] dark:[--icon-bg-hover:var(--color-blue-900)] dark:[--icon-color:var(--color-blue-400)]',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    bgClasses: 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900',
    inverseColor: 'bg-indigo-500 text-indigo-100 dark:bg-indigo-500',
    groupClasses:
      '[--icon-bg:var(--color-indigo-50)] [--icon-bg-hover:var(--color-indigo-100)] [--icon-color:var(--color-indigo-600)] dark:[--icon-bg:var(--color-indigo-950)] dark:[--icon-bg-hover:var(--color-indigo-900)] dark:[--icon-color:var(--color-indigo-400)]',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: 'bg-purple-500',
    iconColor: 'text-purple-600 dark:text-purple-400',
    bgClasses: 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950 dark:hover:bg-purple-900',
    inverseColor: 'bg-purple-500 text-purple-100 dark:bg-purple-500',
    groupClasses:
      '[--icon-bg:var(--color-purple-50)] [--icon-bg-hover:var(--color-purple-100)] [--icon-color:var(--color-purple-600)] dark:[--icon-bg:var(--color-purple-950)] dark:[--icon-bg-hover:var(--color-purple-900)] dark:[--icon-color:var(--color-purple-400)]',
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: 'bg-pink-500',
    iconColor: 'text-pink-600 dark:text-pink-400',
    bgClasses: 'bg-pink-50 hover:bg-pink-100 dark:bg-pink-950 dark:hover:bg-pink-900',
    inverseColor: 'bg-pink-500 text-pink-50 dark:bg-pink-500',
    groupClasses:
      '[--icon-bg:var(--color-pink-50)] [--icon-bg-hover:var(--color-pink-100)] [--icon-color:var(--color-pink-600)] dark:[--icon-bg:var(--color-pink-950)] dark:[--icon-bg-hover:var(--color-pink-900)] dark:[--icon-color:var(--color-pink-400)]',
  },
]

/** Default color ID */
export const DEFAULT_COLOR = 'gray'

/** Get color configuration by ID */
export const getIconColor = (colorId: string): IconColor =>
  ICON_COLORS.find((c) => c.id === colorId) ?? ICON_COLORS[0]!

/** Icon item definition */
export interface IconItem {
  /** Unique identifier (icon name in kebab-case) */
  id: string
  /** Display name */
  label: string
  /** Lucide icon component */
  icon: LucideIcon
}

/** Curated list of commonly used icons */
export const ICON_DATA: IconItem[] = [
  // General UI
  { id: 'home', label: 'Home', icon: Home },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'menu', label: 'Menu', icon: Menu },
  { id: 'x', label: 'Close', icon: X },
  { id: 'plus', label: 'Plus', icon: Plus },
  { id: 'minus', label: 'Minus', icon: Minus },
  { id: 'equal', label: 'Equal', icon: Equal },
  { id: 'check', label: 'Check', icon: Check },
  { id: 'chevron-down', label: 'Chevron Down', icon: ChevronDown },
  { id: 'chevron-up', label: 'Chevron Up', icon: ChevronUp },
  { id: 'chevron-left', label: 'Chevron Left', icon: ChevronLeft },
  { id: 'chevron-right', label: 'Chevron Right', icon: ChevronRight },
  { id: 'arrow-left', label: 'Arrow Left', icon: ArrowLeft },
  { id: 'arrow-right', label: 'Arrow Right', icon: ArrowRight },
  { id: 'arrow-up', label: 'Arrow Up', icon: ArrowUp },
  { id: 'arrow-down', label: 'Arrow Down', icon: ArrowDown },
  // Communication
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'message-square', label: 'Message Square', icon: MessageSquare },
  { id: 'message-circle', label: 'Message Circle', icon: MessageCircle },
  { id: 'phone', label: 'Phone', icon: Phone },
  { id: 'bell', label: 'Bell', icon: Bell },
  { id: 'bell-ring', label: 'Bell Ring', icon: BellRing },
  { id: 'send', label: 'Send', icon: Send },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  // User/Profile
  { id: 'user', label: 'User', icon: User },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'user-plus', label: 'User Plus', icon: UserPlus },
  { id: 'user-minus', label: 'User Minus', icon: UserMinus },
  { id: 'user-check', label: 'User Check', icon: UserCheck },
  { id: 'user-x', label: 'User X', icon: UserX },
  { id: 'circle-user', label: 'Circle User', icon: CircleUser },
  // Files/Documents
  { id: 'file', label: 'File', icon: File },
  { id: 'file-text', label: 'File Text', icon: FileText },
  { id: 'file-image', label: 'File Image', icon: FileImage },
  { id: 'file-video', label: 'File Video', icon: FileVideo },
  { id: 'file-audio', label: 'File Audio', icon: FileAudio },
  { id: 'file-type', label: 'File Type', icon: FileType },
  { id: 'file-spreadsheet', label: 'File Spreadsheet', icon: FileSpreadsheet },
  { id: 'file-code', label: 'File Code', icon: FileCode },
  { id: 'file-json', label: 'File JSON', icon: FileJson },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'folder-open', label: 'Folder Open', icon: FolderOpen },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'download', label: 'Download', icon: Download },
  { id: 'paperclip', label: 'Paperclip', icon: Paperclip },
  { id: 'link', label: 'Link', icon: Link },
  // Actions
  { id: 'edit', label: 'Edit', icon: Edit },
  { id: 'trash', label: 'Trash', icon: Trash },
  { id: 'copy', label: 'Copy', icon: Copy },
  { id: 'clipboard', label: 'Clipboard', icon: Clipboard },
  { id: 'save', label: 'Save', icon: Save },
  { id: 'share', label: 'Share', icon: Share },
  { id: 'external-link', label: 'External Link', icon: ExternalLink },
  { id: 'more-horizontal', label: 'More Horizontal', icon: MoreHorizontal },
  { id: 'more-vertical', label: 'More Vertical', icon: MoreVertical },
  // Media
  { id: 'image', label: 'Image', icon: Image },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'play', label: 'Play', icon: Play },
  { id: 'pause', label: 'Pause', icon: Pause },
  { id: 'volume', label: 'Volume', icon: Volume2 },
  { id: 'volume-x', label: 'Volume Off', icon: VolumeX },
  // Business
  { id: 'briefcase', label: 'Briefcase', icon: Briefcase },
  { id: 'building', label: 'Building', icon: Building },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'clock', label: 'Clock', icon: Clock },
  { id: 'credit-card', label: 'Credit Card', icon: CreditCard },
  { id: 'dollar-sign', label: 'Dollar Sign', icon: DollarSign },
  { id: 'shopping-cart', label: 'Shopping Cart', icon: ShoppingCart },
  { id: 'package', label: 'Package', icon: Package },
  // Data/Charts
  { id: 'bar-chart', label: 'Bar Chart', icon: BarChart },
  { id: 'line-chart', label: 'Line Chart', icon: LineChart },
  { id: 'pie-chart', label: 'Pie Chart', icon: PieChart },
  { id: 'trending-up', label: 'Trending Up', icon: TrendingUp },
  { id: 'trending-down', label: 'Trending Down', icon: TrendingDown },
  { id: 'activity', label: 'Activity', icon: Activity },
  // Status
  { id: 'alert-circle', label: 'Alert Circle', icon: AlertCircle },
  { id: 'alert-triangle', label: 'Alert Triangle', icon: AlertTriangle },
  { id: 'info', label: 'Info', icon: Info },
  { id: 'help-circle', label: 'Help Circle', icon: HelpCircle },
  { id: 'check-circle', label: 'Check Circle', icon: CheckCircle },
  { id: 'x-circle', label: 'X Circle', icon: XCircle },
  { id: 'ban', label: 'Ban', icon: Ban },
  // Tools
  { id: 'wrench', label: 'Wrench', icon: Wrench },
  { id: 'hammer', label: 'Hammer', icon: Hammer },
  { id: 'key', label: 'Key', icon: Key },
  { id: 'lock', label: 'Lock', icon: Lock },
  { id: 'unlock', label: 'Unlock', icon: Unlock },
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'zap', label: 'Zap', icon: Zap },
  { id: 'lightbulb', label: 'Lightbulb', icon: Lightbulb },
  // Navigation
  { id: 'compass', label: 'Compass', icon: Compass },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'map-pin', label: 'Map Pin', icon: MapPin },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'navigation', label: 'Navigation', icon: Navigation },
  // Misc
  { id: 'star', label: 'Star', icon: Star },
  { id: 'heart', label: 'Heart', icon: Heart },
  { id: 'bookmark', label: 'Bookmark', icon: Bookmark },
  { id: 'tag', label: 'Tag', icon: Tag },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'flag', label: 'Flag', icon: Flag },
  { id: 'award', label: 'Award', icon: Award },
  { id: 'gift', label: 'Gift', icon: Gift },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  // Additional useful icons
  { id: 'eye', label: 'Eye', icon: Eye },
  { id: 'eye-off', label: 'Eye Off', icon: EyeOff },
  { id: 'filter', label: 'Filter', icon: Filter },
  { id: 'refresh', label: 'Refresh', icon: RefreshCw },
  { id: 'rotate', label: 'Rotate', icon: RotateCcw },
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'grid', label: 'Grid', icon: Grid },
  { id: 'list', label: 'List', icon: List },
  { id: 'layout', label: 'Layout', icon: Layout },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'server', label: 'Server', icon: Server },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'wifi', label: 'Wifi', icon: Wifi },
  { id: 'battery', label: 'Battery', icon: Battery },
  { id: 'power', label: 'Power', icon: Power },
  { id: 'sun', label: 'Sun', icon: Sun },
  { id: 'moon', label: 'Moon', icon: Moon },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'square', label: 'Square', icon: Square },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'hexagon', label: 'Hexagon', icon: Hexagon },
  { id: 'target', label: 'Target', icon: Target },
  { id: 'crosshair', label: 'Crosshair', icon: Crosshair },
  { id: 'fingerprint', label: 'Fingerprint', icon: Fingerprint },
  { id: 'qr-code', label: 'QR Code', icon: QrCode },
  { id: 'printer', label: 'Printer', icon: Printer },
  { id: 'scan', label: 'Scan', icon: Scan },
  // Workflow-specific icons
  { id: 'git-branch', label: 'Git Branch', icon: GitBranch },
  { id: 'sticky-note', label: 'Sticky Note', icon: StickyNote },
  { id: 'variable', label: 'Variable', icon: Variable },
  { id: 'brain', label: 'Brain', icon: Brain },
  { id: 'octagon', label: 'Octagon', icon: Octagon },
  { id: 'repeat', label: 'Repeat', icon: Repeat },
  { id: 'arrows-up-down', label: 'Arrows Up Down', icon: ArrowUpDown },
  { id: 'webhook', label: 'Webhook', icon: Webhook },
  { id: 'ticket', label: 'Ticket', icon: Ticket },
  { id: 'box', label: 'Box', icon: Box },
  { id: 'boxes', label: 'Boxes', icon: Boxes },
  { id: 'type', label: 'Type', icon: Type },
  { id: 'hash', label: 'Hash', icon: Hash },
  { id: 'toggle-left', label: 'Toggle Left', icon: ToggleLeft },
  { id: 'braces', label: 'Braces', icon: Braces },
  { id: 'scissors', label: 'Scissors', icon: Scissors },
  { id: 'text', label: 'Text', icon: CaseSensitive },
  { id: 'text-cursor-input', label: 'Text Cursor Input', icon: TextCursorInput },
  { id: 'list-filter', label: 'List Filter', icon: ListFilter },
  { id: 'calendar-clock', label: 'Calendar Clock', icon: CalendarClock },
  { id: 'list-checks', label: 'List Checks', icon: ListChecks },
  { id: 'link-2', label: 'Link 2', icon: Link2 },
]

/** Get icon item by ID */
export const getIcon = (iconId: string): IconItem | undefined =>
  ICON_DATA.find((item) => item.id === iconId)

/** EntityIcon variants using CVA */
const entityIconVariants = cva('flex items-center justify-center shrink-0', {
  variants: {
    variant: {
      default: 'rounded-md',
      full: 'rounded-full border',
      muted:
        'rounded-lg border bg-muted group-hover:bg-secondary transition-colors overflow-hidden',
    },
    size: {
      xs: 'size-4 [&_svg]:size-2.5!',
      sm: 'size-5 [&_svg]:size-3.5!',
      default: 'size-6 [&_svg]:size-4!',
      lg: 'size-8 [&_svg]:size-4',
      xl: 'size-10 [&_svg]:size-5',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

/** Props for EntityIcon component */
export interface EntityIconProps extends VariantProps<typeof entityIconVariants> {
  /** Icon ID from ICON_DATA (e.g., 'home', 'settings') */
  iconId: string
  /** Color ID from ICON_COLORS (e.g., 'blue', 'red') - optional */
  color?: string
  /** Use inverse color scheme (solid bg with white icon) */
  inverse?: boolean
  /** Optional inline style for dynamic colors (e.g., workflow nodes with hex colors) */
  style?: React.CSSProperties
  /** Additional classes for the wrapper div */
  className?: string
}

/** Standalone component for rendering an icon with color outside the picker */
export function EntityIcon({
  iconId,
  color,
  inverse = false,
  variant = 'default',
  size = 'default',
  style,
  className,
  ...props
}: EntityIconProps) {
  const iconData = getIcon(iconId)
  const colorData = color ? getIconColor(color) : null

  if (!iconData) return null

  const Icon = iconData.icon

  // When style is provided (e.g., hex colors), skip color classes
  const useColorClasses = !style && colorData

  return (
    <div
      className={cn(
        entityIconVariants({ variant, size }),
        useColorClasses && (inverse ? colorData?.inverseColor : colorData?.bgClasses),
        useColorClasses && !inverse && colorData?.iconColor,
        className
      )}
      style={style}
      {...props}>
      <Icon />
    </div>
  )
}

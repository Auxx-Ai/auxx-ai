// apps/homepage/src/app/_components/sections/workflow-animation/workflow-data.ts

export type NodeCategory = 'TRIGGER' | 'CONDITION' | 'TRANSFORM' | 'ACTION'

export interface WorkflowNode {
  id: string
  typeId: string
  label: string
  subtitle: string
  icon: string
  category: NodeCategory
  x: number
  y: number
  delay: number
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  delay: number
  label?: string
  isHappyPath?: boolean
}

export const categoryColors: Record<NodeCategory, { border: string; bg: string; iconBg: string }> =
  {
    TRIGGER: { border: '#10b981', bg: 'bg-emerald-50', iconBg: 'bg-emerald-100' },
    CONDITION: { border: '#f59e0b', bg: 'bg-amber-50', iconBg: 'bg-amber-100' },
    TRANSFORM: { border: '#8B5CF6', bg: 'bg-violet-50', iconBg: 'bg-violet-100' },
    ACTION: { border: '#10b981', bg: 'bg-emerald-50', iconBg: 'bg-emerald-100' },
  }

// Desktop layout
export const nodes: WorkflowNode[] = [
  {
    id: 'message-received',
    typeId: 'message-received',
    label: 'Message Received',
    subtitle: 'New message triggers workflow',
    icon: 'mail',
    category: 'TRIGGER',
    x: 0,
    y: 100,
    delay: 0,
  },
  {
    id: 'text-classifier',
    typeId: 'text-classifier',
    label: 'Text Classifier',
    subtitle: 'Order Issue, Returns, General',
    icon: 'tags',
    category: 'CONDITION',
    x: 280,
    y: 100,
    delay: 0.5,
  },
  {
    id: 'if-else',
    typeId: 'if-else',
    label: 'IF / ELSE',
    subtitle: 'If category = Order Issue',
    icon: 'git-branch',
    category: 'CONDITION',
    x: 560,
    y: 100,
    delay: 1.0,
  },
  {
    id: 'ai',
    typeId: 'ai',
    label: 'AI',
    subtitle: 'Draft reply using order context',
    icon: 'brain',
    category: 'TRANSFORM',
    x: 840,
    y: 10,
    delay: 1.5,
  },
  {
    id: 'answer',
    typeId: 'answer',
    label: 'Send Answer',
    subtitle: 'Reply to customer',
    icon: 'send',
    category: 'ACTION',
    x: 1120,
    y: 10,
    delay: 2.0,
  },
  {
    id: 'end',
    typeId: 'end',
    label: 'Output',
    subtitle: 'Escalate to agent',
    icon: 'message-circle',
    category: 'ACTION',
    x: 840,
    y: 200,
    delay: 1.5,
  },
]

export const edges: WorkflowEdge[] = [
  {
    id: 'e1',
    source: 'message-received',
    target: 'text-classifier',
    delay: 0.2,
    isHappyPath: true,
  },
  {
    id: 'e2',
    source: 'text-classifier',
    target: 'if-else',
    delay: 0.7,
    isHappyPath: true,
  },
  {
    id: 'e3',
    source: 'if-else',
    target: 'ai',
    delay: 1.2,
    label: 'Yes',
    isHappyPath: true,
  },
  {
    id: 'e4',
    source: 'if-else',
    target: 'end',
    delay: 1.2,
    label: 'No',
  },
  {
    id: 'e5',
    source: 'ai',
    target: 'answer',
    delay: 1.7,
    isHappyPath: true,
  },
]

// Mobile layout: simplified linear vertical flow
export const mobileNodes: WorkflowNode[] = [
  {
    id: 'message-received',
    typeId: 'message-received',
    label: 'Message Received',
    subtitle: 'New message triggers workflow',
    icon: 'mail',
    category: 'TRIGGER',
    x: 0,
    y: 0,
    delay: 0,
  },
  {
    id: 'text-classifier',
    typeId: 'text-classifier',
    label: 'Text Classifier',
    subtitle: 'Order Issue, Returns, General',
    icon: 'tags',
    category: 'CONDITION',
    x: 0,
    y: 120,
    delay: 0.5,
  },
  {
    id: 'ai',
    typeId: 'ai',
    label: 'AI',
    subtitle: 'Draft reply using order context',
    icon: 'brain',
    category: 'TRANSFORM',
    x: 0,
    y: 240,
    delay: 1.0,
  },
  {
    id: 'answer',
    typeId: 'answer',
    label: 'Send Answer',
    subtitle: 'Reply to customer',
    icon: 'send',
    category: 'ACTION',
    x: 0,
    y: 360,
    delay: 1.5,
  },
]

export const mobileEdges: WorkflowEdge[] = [
  {
    id: 'me1',
    source: 'message-received',
    target: 'text-classifier',
    delay: 0.2,
    isHappyPath: true,
  },
  {
    id: 'me2',
    source: 'text-classifier',
    target: 'ai',
    delay: 0.7,
    isHappyPath: true,
  },
  {
    id: 'me3',
    source: 'ai',
    target: 'answer',
    delay: 1.2,
    isHappyPath: true,
  },
]

export const NODE_WIDTH = 224
export const NODE_HEIGHT = 72
export const CANVAS_WIDTH = 1120
export const CANVAS_HEIGHT = 200
export const MOBILE_CANVAS_WIDTH = 224
export const MOBILE_CANVAS_HEIGHT = 432

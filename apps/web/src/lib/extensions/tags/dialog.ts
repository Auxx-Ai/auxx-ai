// apps/web/src/lib/extensions/tags/dialog.ts

/**
 * Dialog tag for extension dialogs
 */
export interface DialogTagAttributes {
  title: string
  size?: 'small' | 'medium' | 'large' | 'fullscreen'
}

/**
 * Dialog instance structure
 */
export interface DialogInstance {
  instance_type: 'instance'
  tag: 'auxxdialog'
  component: 'Dialog'
  instance_id: string
  attributes: DialogTagAttributes
  props: any
  children?: any[]
  hidden: boolean
}

/**
 * Generate a unique instance ID
 */
function generateInstanceId(): string {
  return `dialog_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create a dialog tag instance
 */
export function createDialogTag(props: any): DialogInstance {
  return {
    instance_type: 'instance',
    tag: 'auxxdialog',
    component: props.component || 'Dialog',
    instance_id: generateInstanceId(),
    attributes: {
      title: props.title,
      size: props.size || 'medium',
    },
    props,
    children: [],
    hidden: false,
  }
}

// packages/sdk/template/src/hello-world-action.tsx

import type { RecordAction, DialogComponent } from '@auxx/sdk/client'
import { showDialog } from '@auxx/sdk/client'

import { HelloWorldDialog } from './hello-world-dialog'

/**
 * Example record action that opens a dialog.
 *
 * Record actions appear as buttons in the record detail view.
 * When clicked, they can perform any action you want - in this case,
 * it opens a dialog that displays information about the record.
 */
export const recordAction: RecordAction = {
  /** Unique identifier for this action */
  id: 'slug-to-be-replaced-hello-world',

  /** User-facing label shown on the button */
  label: 'title-to-be-replaced',

  /** Optional icon to display next to the label */
  icon: 'zap',

  /**
   * Function called when the user clicks the action button.
   *
   * @param context - Contains recordId, recordType, and optional metadata
   */
  onTrigger: async ({ recordId }) => {
    await showDialog({
      title: 'title-to-be-replaced',
      size: 'medium',
      Dialog: (({ hideDialog }) => {
        // This is a strongly-typed Dialog component.
        // It can only use approved SDK components (TextBlock, Button, etc.)
        // Raw HTML elements (div, p, etc.) will cause TypeScript errors.
        return <HelloWorldDialog recordId={recordId} hideDialog={hideDialog} />
      }) as DialogComponent,
    })
  },
}

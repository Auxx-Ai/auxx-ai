// packages/sdk/src/runtime/reconciler/tags/index.ts

import { AvatarTag } from './avatar-tag.js'
import { BadgeTag } from './badge-tag.js'
import { BannerTag } from './banner-tag.js'
import type { BaseTag } from './base-tag.js'
import { ButtonTag } from './button-tag.js'
import { DialogTag } from './dialog-tag.js'
import { FormFieldTag } from './form-field-tag.js'
import { FormSubmitTag } from './form-submit-tag.js'
import { FormTag } from './form-tag.js'
import { SeparatorTag } from './separator-tag.js'
import { TextBlockTag } from './text-block-tag.js'
import { TypographyBodyTag, TypographyCaptionTag, TypographyTag } from './typography-tag.js'
import { WorkflowAlertTag } from './workflow-alert-tag.js'
import { WorkflowArrayInputTag } from './workflow-array-input-tag.js'
import { WorkflowBadgeTag } from './workflow-badge-tag.js'
import { WorkflowBooleanInputTag } from './workflow-boolean-input-tag.js'
import { WorkflowConditionalRenderTag } from './workflow-conditional-render-tag.js'
import { WorkflowFieldDividerTag } from './workflow-field-divider-tag.js'
import { WorkflowFieldRowTag } from './workflow-field-row-tag.js'
import { WorkflowInputEditorTag } from './workflow-input-editor-tag.js'
import { WorkflowInputGroupTag } from './workflow-input-group-tag.js'
import { WorkflowNodeHandleTag } from './workflow-node-handle-tag.js'
import { WorkflowNodeRowTag } from './workflow-node-row-tag.js'
import { WorkflowNodeTag } from './workflow-node-tag.js'
import { WorkflowNodeTextTag } from './workflow-node-text-tag.js'
import { WorkflowNumberInputTag } from './workflow-number-input-tag.js'
import { WorkflowPanelTag } from './workflow-panel-tag.js'
import { WorkflowSectionTag } from './workflow-section-tag.js'
import { WorkflowSelectInputTag } from './workflow-select-input-tag.js'
import { WorkflowSeparatorTag } from './workflow-separator-tag.js'
import { WorkflowStringInputTag } from './workflow-string-input-tag.js'
import { WorkflowVarFieldGroupTag } from './workflow-var-field-group-tag.js'
import { WorkflowVarFieldTag } from './workflow-var-field-tag.js'
import { WorkflowVarInputTag } from './workflow-var-input-tag.js'
import { WorkflowVariableInputTag } from './workflow-variable-input-tag.js'

/**
 * Map of custom element tag names to their Tag classes.
 */
export const TAG_REGISTRY: Record<string, new (props: Record<string, any>) => BaseTag> = {
  auxxtextblock: TextBlockTag,
  auxxbutton: ButtonTag,
  auxxbadge: BadgeTag,
  auxxbanner: BannerTag,
  auxxavatar: AvatarTag,
  auxxdialog: DialogTag,
  auxxseparator: SeparatorTag,
  auxxtypography: TypographyTag,
  auxxtypographybody: TypographyBodyTag,
  auxxtypographycaption: TypographyCaptionTag,
  auxxform: FormTag,
  auxxformfield: FormFieldTag,
  auxxformsubmit: FormSubmitTag,
  auxxworkflownode: WorkflowNodeTag,
  auxxworkflownoderow: WorkflowNodeRowTag,
  auxxworkflownodetext: WorkflowNodeTextTag,
  auxxworkflownodehandle: WorkflowNodeHandleTag,
  auxxworkflowpanel: WorkflowPanelTag,
  auxxworkflowstringinput: WorkflowStringInputTag,
  auxxworkflownumberinput: WorkflowNumberInputTag,
  auxxworkflowbooleaninput: WorkflowBooleanInputTag,
  auxxworkflowselectinput: WorkflowSelectInputTag,
  auxxworkflowsection: WorkflowSectionTag,
  auxxworkflowinputgroup: WorkflowInputGroupTag,
  auxxworkflowseparator: WorkflowSeparatorTag,
  auxxworkflowalert: WorkflowAlertTag,
  auxxworkflowarrayinput: WorkflowArrayInputTag,
  auxxworkflowbadge: WorkflowBadgeTag,
  auxxworkflowconditionalrender: WorkflowConditionalRenderTag,
  auxxworkflowvariableinput: WorkflowVariableInputTag,
  auxxworkflowinputeditor: WorkflowInputEditorTag,
  // v2: VarEditor-backed components (no event handlers)
  auxxworkflowvarinput: WorkflowVarInputTag,
  auxxworkflowvarfield: WorkflowVarFieldTag,
  auxxworkflowvarfieldgroup: WorkflowVarFieldGroupTag,
  auxxworkflowfieldrow: WorkflowFieldRowTag,
  auxxworkflowfielddivider: WorkflowFieldDividerTag,
}

/**
 * Check if a tag name is a registered custom element.
 */
export function isCustomElement(tagName: string): boolean {
  return tagName in TAG_REGISTRY
}

/**
 * Create a Tag instance for a custom element.
 */
export function createTag(tagName: string, props: Record<string, any>): BaseTag {
  const TagClass = TAG_REGISTRY[tagName]
  if (!TagClass) {
    throw new Error(`Unknown custom element: ${tagName}`)
  }
  return new TagClass(props)
}

export { AvatarTag } from './avatar-tag.js'
export { BadgeTag } from './badge-tag.js'
export { BannerTag } from './banner-tag.js'
// Export all tag classes
export { BaseTag } from './base-tag.js'
export { ButtonTag } from './button-tag.js'
export { DialogTag } from './dialog-tag.js'
export { FormFieldTag } from './form-field-tag.js'
export { FormSubmitTag } from './form-submit-tag.js'
export { FormTag } from './form-tag.js'
export { SeparatorTag } from './separator-tag.js'
export { TextBlockTag } from './text-block-tag.js'
export { TypographyBodyTag, TypographyCaptionTag, TypographyTag } from './typography-tag.js'
export { WorkflowAlertTag } from './workflow-alert-tag.js'
export { WorkflowArrayInputTag } from './workflow-array-input-tag.js'
export { WorkflowBadgeTag } from './workflow-badge-tag.js'
export { WorkflowBooleanInputTag } from './workflow-boolean-input-tag.js'
export { WorkflowConditionalRenderTag } from './workflow-conditional-render-tag.js'
export { WorkflowFieldDividerTag } from './workflow-field-divider-tag.js'
export { WorkflowFieldRowTag } from './workflow-field-row-tag.js'
export { WorkflowInputEditorTag } from './workflow-input-editor-tag.js'
export { WorkflowInputGroupTag } from './workflow-input-group-tag.js'
export { WorkflowNodeHandleTag } from './workflow-node-handle-tag.js'
export { WorkflowNodeRowTag } from './workflow-node-row-tag.js'
export { WorkflowNodeTag } from './workflow-node-tag.js'
export { WorkflowNodeTextTag } from './workflow-node-text-tag.js'
export { WorkflowNumberInputTag } from './workflow-number-input-tag.js'
export { WorkflowPanelTag } from './workflow-panel-tag.js'
export { WorkflowSectionTag } from './workflow-section-tag.js'
export { WorkflowSelectInputTag } from './workflow-select-input-tag.js'
export { WorkflowSeparatorTag } from './workflow-separator-tag.js'
export { WorkflowStringInputTag } from './workflow-string-input-tag.js'
export { WorkflowVarFieldGroupTag } from './workflow-var-field-group-tag.js'
export { WorkflowVarFieldTag } from './workflow-var-field-tag.js'
export { WorkflowVarInputTag } from './workflow-var-input-tag.js'
export { WorkflowVariableInputTag } from './workflow-variable-input-tag.js'

// packages/sdk/src/client/components/typography.tsx

import React from 'react'

/**
 * Props for the Typography component
 */
export interface TypographyProps {
  /** The content of the title */
  children: React.ReactNode
  /** The variant of the title */
  variant?: 'extraLarge' | 'large' | 'standard' | 'medium' | 'small' | 'extraSmall'
}

/**
 * Props for the Typography.Body component
 */
export interface TypographyBodyProps {
  /** The content of the body */
  children: React.ReactNode
  /** The variant of the body */
  variant?: 'standard' | 'large' | 'strong' | 'interactive'
}

/**
 * Props for the Typography.Caption component
 */
export interface TypographyCaptionProps {
  /** The content of the caption */
  children: React.ReactNode
}

/**
 * Typography component for displaying titles/headings.
 */
export const Typography: React.FC<TypographyProps> & {
  Body: React.FC<TypographyBodyProps>
  Caption: React.FC<TypographyCaptionProps>
} = ((props: TypographyProps) =>
  React.createElement('auxxtypography', {
    ...props,
    component: 'Typography',
  })) as any

/**
 * Typography.Body component for body text.
 */
Typography.Body = (props: TypographyBodyProps) =>
  React.createElement('auxxtypographybody', {
    ...props,
    component: 'TypographyBody',
  })

/**
 * Typography.Caption component for caption text.
 */
Typography.Caption = (props: TypographyCaptionProps) =>
  React.createElement('auxxtypographycaption', {
    ...props,
    component: 'TypographyCaption',
  })

// packages/sdk/src/client/components/button.tsx

import React from 'react'

/**
 * Props for the Button component
 */
export interface ButtonProps {
  /** Button content */
  label: string
  /** Button variant */
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  /** Button size */
  size?: 'small' | 'medium' | 'large'
  /** Whether the button is disabled */
  disabled?: boolean
  /** Click handler */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Button type */
  type?: 'button' | 'submit' | 'reset'
}

/**
 * Interactive button component.
 */
export const Button: React.FC<ButtonProps> = (props) =>
  React.createElement('auxxbutton', {
    ...props,
    component: 'Button',
  })

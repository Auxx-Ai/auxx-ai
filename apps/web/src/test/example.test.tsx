// apps/web/src/test/example.test.tsx

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from './utils'

// Simple components to test
function TestComponent({ message }: { message: string }) {
  return <div data-testid='test-message'>{message}</div>
}

function InteractiveComponent() {
  const [count, setCount] = React.useState(0)

  return (
    <div>
      <span data-testid='count'>{count}</span>
      <button data-testid='increment' onClick={() => setCount((c) => c + 1)}>
        Increment
      </button>
    </div>
  )
}

function FormComponent() {
  const [name, setName] = React.useState('')
  const [submitted, setSubmitted] = React.useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
      }}>
      <input
        data-testid='name-input'
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder='Enter your name'
      />
      <button data-testid='submit' type='submit'>
        Submit
      </button>
      {submitted && <div data-testid='success'>Form submitted!</div>}
    </form>
  )
}

describe('Example Tests', () => {
  describe('Basic Rendering', () => {
    it('should render a simple component', () => {
      const message = 'Hello, Vitest!'

      renderWithProviders(<TestComponent message={message} />)

      expect(screen.getByTestId('test-message')).toHaveTextContent(message)
      expect(screen.getByTestId('test-message')).toBeInTheDocument()
    })

    it('should render with different props', () => {
      renderWithProviders(<TestComponent message='Different message' />)

      expect(screen.getByTestId('test-message')).toHaveTextContent('Different message')
    })
  })

  describe('User Interactions', () => {
    it('should handle click events', async () => {
      const user = userEvent.setup()

      renderWithProviders(<InteractiveComponent />)

      // Initial state
      expect(screen.getByTestId('count')).toHaveTextContent('0')

      // Click button
      await user.click(screen.getByTestId('increment'))

      // Check updated state
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    it('should handle multiple clicks', async () => {
      const user = userEvent.setup()

      renderWithProviders(<InteractiveComponent />)

      const button = screen.getByTestId('increment')

      await user.click(button)
      await user.click(button)
      await user.click(button)

      expect(screen.getByTestId('count')).toHaveTextContent('3')
    })
  })

  describe('Form Handling', () => {
    it('should handle input changes', async () => {
      const user = userEvent.setup()

      renderWithProviders(<FormComponent />)

      const input = screen.getByTestId('name-input')

      await user.type(input, 'John Doe')

      expect(input).toHaveValue('John Doe')
    })

    it('should handle form submission', async () => {
      const user = userEvent.setup()

      renderWithProviders(<FormComponent />)

      const input = screen.getByTestId('name-input')
      const submitButton = screen.getByTestId('submit')

      await user.type(input, 'Jane Smith')
      await user.click(submitButton)

      expect(screen.getByTestId('success')).toHaveTextContent('Form submitted!')
    })
  })

  describe('Accessibility', () => {
    it('should have proper attributes', () => {
      renderWithProviders(
        <button aria-label='Close dialog' data-testid='close-btn'>
          ×
        </button>
      )

      const button = screen.getByTestId('close-btn')
      expect(button).toHaveAttribute('aria-label', 'Close dialog')
    })

    it('should support keyboard navigation', async () => {
      const user = userEvent.setup()

      renderWithProviders(
        <div>
          <button data-testid='btn-1'>Button 1</button>
          <button data-testid='btn-2'>Button 2</button>
        </div>
      )

      // Tab to first button
      await user.tab()
      expect(screen.getByTestId('btn-1')).toHaveFocus()

      // Tab to second button
      await user.tab()
      expect(screen.getByTestId('btn-2')).toHaveFocus()
    })
  })

  describe('Basic Assertions', () => {
    it('should perform basic value assertions', () => {
      expect(true).toBe(true)
      expect('hello').toMatch(/ell/)
      expect([1, 2, 3]).toContain(2)
      expect({ name: 'test' }).toHaveProperty('name')
    })

    it('should work with numbers', () => {
      expect(2 + 2).toBe(4)
      expect(10).toBeGreaterThan(5)
      expect(3.14).toBeCloseTo(3.1, 1)
    })

    it('should work with strings', () => {
      expect('hello world').toContain('world')
      expect('HELLO').toEqual('HELLO')
      expect('test').toHaveLength(4)
    })

    it('should work with arrays', () => {
      const fruits = ['apple', 'banana', 'orange']
      expect(fruits).toHaveLength(3)
      expect(fruits).toContain('banana')
      expect(fruits[0]).toBe('apple')
    })
  })

  describe('Async Operations', () => {
    it('should handle promises', async () => {
      const promise = Promise.resolve('success')
      await expect(promise).resolves.toBe('success')
    })

    it('should handle async functions', async () => {
      const asyncFunction = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'completed'
      }

      const result = await asyncFunction()
      expect(result).toBe('completed')
    })
  })
})

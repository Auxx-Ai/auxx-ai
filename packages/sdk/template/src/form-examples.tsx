// packages/sdk/template/src/form-examples.tsx

/**
 * Additional form examples demonstrating various patterns and use cases.
 * These examples can be imported and used in your extension.
 */

import { useRef } from 'react'
import { Forms, Form, FormField, FormSubmit, type FormRef, type InferFormValues } from '@auxx/sdk/client'

// ============================================================================
// Example 1: Simple Login Form
// ============================================================================

const loginFormSchema = {
  email: Forms.string()
    .email('Please enter a valid email')
    .placeholder('you@example.com'),

  password: Forms.string()
    .minLength(8, 'Password must be at least 8 characters')
    .placeholder('Enter your password'),

  rememberMe: Forms.boolean().default(false),
}

export function LoginForm() {
  async function handleLogin(values: InferFormValues<typeof loginFormSchema>) {
    console.log('Login attempt:', values)
    // Call your authentication API here
  }

  return (
    <Form schema={loginFormSchema} onSubmit={handleLogin}>
      <FormField name="email" label="Email" />
      <FormField name="password" label="Password" />
      <FormField name="rememberMe" label="Remember me" />
      <FormSubmit>Sign In</FormSubmit>
    </Form>
  )
}

// ============================================================================
// Example 2: Product Configuration Form
// ============================================================================

const productConfigSchema = {
  productName: Forms.string()
    .minLength(3)
    .maxLength(100)
    .placeholder('Enter product name'),

  price: Forms.number()
    .positive('Price must be positive')
    .placeholder('0.00'),

  quantity: Forms.number()
    .integer('Quantity must be a whole number')
    .positive('Quantity must be positive')
    .min(1, 'Minimum quantity is 1')
    .default(1),

  category: Forms.select([
    { value: 'electronics', label: 'Electronics' },
    { value: 'clothing', label: 'Clothing' },
    { value: 'books', label: 'Books' },
    { value: 'other', label: 'Other' },
  ]),

  description: Forms.string()
    .multiline()
    .maxLength(1000)
    .optional()
    .placeholder('Product description (optional)'),

  inStock: Forms.boolean().default(true),
}

export function ProductConfigForm() {
  const formRef = useRef<FormRef<typeof productConfigSchema>>(null)

  async function handleSubmit(values: InferFormValues<typeof productConfigSchema>) {
    console.log('Product configuration:', values)
    // Save product configuration

    // Reset form after successful save
    formRef.current?.reset()
  }

  return (
    <Form
      schema={productConfigSchema}
      ref={formRef}
      onSubmit={handleSubmit}
      mode="onChange">
      <FormField
        name="productName"
        label="Product Name"
        description="The name of your product"
      />

      <FormField
        name="price"
        label="Price (USD)"
        description="Product price in US dollars"
      />

      <FormField
        name="quantity"
        label="Quantity"
        description="Available quantity in stock"
      />

      <FormField
        name="category"
        label="Category"
        description="Select a product category"
      />

      <FormField
        name="description"
        label="Description"
        description="Optional product description"
      />

      <FormField
        name="inStock"
        label="Currently in stock"
      />

      <FormSubmit loadingText="Saving...">Save Product</FormSubmit>
    </Form>
  )
}

// ============================================================================
// Example 3: User Profile Form with Custom Error Handling
// ============================================================================

const profileFormSchema = {
  firstName: Forms.string()
    .minLength(2, 'First name must be at least 2 characters')
    .placeholder('John'),

  lastName: Forms.string()
    .minLength(2, 'Last name must be at least 2 characters')
    .placeholder('Doe'),

  email: Forms.string()
    .email('Please enter a valid email address')
    .placeholder('john.doe@example.com'),

  age: Forms.number()
    .optional()
    .positive('Age must be positive')
    .integer('Age must be a whole number')
    .min(13, 'You must be at least 13 years old')
    .max(120, 'Please enter a valid age'),

  bio: Forms.string()
    .multiline()
    .optional()
    .maxLength(500, 'Bio cannot exceed 500 characters')
    .placeholder('Tell us about yourself...'),

  receiveEmails: Forms.boolean().default(true),
}

export function UserProfileForm() {
  async function handleSubmit(values: InferFormValues<typeof profileFormSchema>) {
    console.log('Profile update:', values)

    // Simulate API call that might fail
    if (values.email === 'taken@example.com') {
      throw new Error('This email is already taken')
    }

    // Save profile
    console.log('Profile saved successfully')
  }

  function handleError(error: Error) {
    console.error('Failed to save profile:', error.message)
    // You could show a custom notification here
  }

  function handleValidationError(errors: Record<string, string>) {
    console.warn('Validation failed:', errors)
    // Handle validation errors (they're already shown in the form)
  }

  return (
    <Form
      schema={profileFormSchema}
      onSubmit={handleSubmit}
      onError={handleError}
      onValidationError={handleValidationError}
      mode="onBlur">
      <FormField name="firstName" label="First Name" />
      <FormField name="lastName" label="Last Name" />
      <FormField name="email" label="Email Address" />
      <FormField name="age" label="Age" description="Optional" />
      <FormField name="bio" label="Bio" description="Tell us about yourself" />
      <FormField name="receiveEmails" label="Receive email notifications" />
      <FormSubmit>Update Profile</FormSubmit>
    </Form>
  )
}

// ============================================================================
// Example 4: Form with Imperative Control (FormRef)
// ============================================================================

const settingsFormSchema = {
  apiKey: Forms.string()
    .minLength(20, 'API key must be at least 20 characters')
    .placeholder('Enter your API key'),

  endpoint: Forms.string()
    .url('Please enter a valid URL')
    .default('https://api.example.com'),

  timeout: Forms.number()
    .positive('Timeout must be positive')
    .integer('Timeout must be a whole number')
    .min(1000, 'Minimum timeout is 1000ms')
    .default(5000),

  enableLogging: Forms.boolean().default(false),
}

export function SettingsForm() {
  const formRef = useRef<FormRef<typeof settingsFormSchema>>(null)

  async function handleSubmit(values: InferFormValues<typeof settingsFormSchema>) {
    console.log('Settings saved:', values)
  }

  function handleReset() {
    // Programmatically reset the form
    formRef.current?.reset()
  }

  function handleTestConnection() {
    // Get current form values without submitting
    const values = formRef.current?.getValues()
    console.log('Testing connection with:', values)

    // You could also manually trigger validation
    formRef.current?.validate().then((isValid) => {
      console.log('Form is valid:', isValid)
    })
  }

  function handleSetDefaults() {
    // Programmatically set field values
    formRef.current?.setValue('endpoint', 'https://api.example.com')
    formRef.current?.setValue('timeout', 5000)
  }

  return (
    <>
      <Form
        schema={settingsFormSchema}
        ref={formRef}
        onSubmit={handleSubmit}>
        <FormField
          name="apiKey"
          label="API Key"
          description="Your authentication key"
        />

        <FormField
          name="endpoint"
          label="API Endpoint"
          description="The base URL for API calls"
        />

        <FormField
          name="timeout"
          label="Timeout (ms)"
          description="Request timeout in milliseconds"
        />

        <FormField
          name="enableLogging"
          label="Enable debug logging"
        />

        <FormSubmit>Save Settings</FormSubmit>
      </Form>

      {/* Additional buttons using FormRef */}
      <button onClick={handleReset}>Reset Form</button>
      <button onClick={handleTestConnection}>Test Connection</button>
      <button onClick={handleSetDefaults}>Load Defaults</button>
    </>
  )
}

// ============================================================================
// Example 5: Feedback Form with All Field Types
// ============================================================================

const feedbackFormSchema = {
  name: Forms.string()
    .minLength(2)
    .placeholder('Your name'),

  email: Forms.string()
    .email()
    .placeholder('your@email.com'),

  rating: Forms.select([
    { value: '5', label: '⭐⭐⭐⭐⭐ Excellent' },
    { value: '4', label: '⭐⭐⭐⭐ Good' },
    { value: '3', label: '⭐⭐⭐ Average' },
    { value: '2', label: '⭐⭐ Poor' },
    { value: '1', label: '⭐ Very Poor' },
  ]),

  wouldRecommend: Forms.boolean().default(false),

  feedback: Forms.string()
    .multiline()
    .minLength(20, 'Please provide at least 20 characters of feedback')
    .maxLength(1000)
    .placeholder('Share your thoughts...'),

  contactMe: Forms.boolean().default(false),
}

export function FeedbackForm() {
  async function handleSubmit(values: InferFormValues<typeof feedbackFormSchema>) {
    console.log('Feedback submitted:', values)
    // Submit feedback to your backend
  }

  function handleChange(values: Partial<InferFormValues<typeof feedbackFormSchema>>) {
    // Track form changes for analytics or auto-save
    console.log('Form changed:', values)
  }

  return (
    <Form
      schema={feedbackFormSchema}
      onSubmit={handleSubmit}
      onChange={handleChange}
      mode="onBlur">
      <FormField name="name" label="Name" />
      <FormField name="email" label="Email" />
      <FormField name="rating" label="How would you rate your experience?" />
      <FormField name="wouldRecommend" label="Would you recommend us to others?" />
      <FormField name="feedback" label="Your Feedback" />
      <FormField name="contactMe" label="Contact me about my feedback" />
      <FormSubmit loadingText="Submitting...">Submit Feedback</FormSubmit>
    </Form>
  )
}

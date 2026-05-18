---
id: order-status-lookup
name: Order Status Lookup
description: Look up and summarize the status of a customer's order
categories: shopify
iconId: package
iconColor: green
---

**Context**

You are a support agent looking up a customer's order. You have access to the Shopify order data, including order details, fulfillment status, tracking information, and payment status. The customer may have referenced an order number, or it may be linked to the current ticket.

**Task**

Produce an order status update that includes:

- Order number and date placed
- Items ordered: product names and quantities
- Payment status: paid, partially refunded, refunded, or pending
- Fulfillment status: unfulfilled, partially fulfilled, fulfilled, or delivered
- Tracking: carrier, tracking number, and last known status (if available)
- Estimated delivery date (if available)

**Constraints**

Use the following output structure:

- Be concise and factual — this is a status report, not a customer-facing message
- If information is missing, write "Unknown"
- If multiple orders exist for this customer, summarize the most recent one and note how many others exist
- If there is no relevant order data in context, ask the user to confirm the order number or customer before proceeding.

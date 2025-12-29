import confetti from 'canvas-confetti'

// Helper function for confetti effect (optional, but keeps onSuccess clean)
export function showCelebrationConfetti() {
  // Simple burst from center
  confetti({
    particleCount: 150,
    spread: 70,
    origin: { y: 0.6 },
    zIndex: 1000, // Ensure it's above other elements if needed
  })

  // Add a couple more slightly delayed bursts for a fuller effect
  setTimeout(() => {
    confetti({
      particleCount: 100,
      spread: 100,
      origin: { y: 0.5, x: 0.3 }, // From left-ish
      zIndex: 1000,
    })
  }, 150)

  setTimeout(() => {
    confetti({
      particleCount: 100,
      spread: 100,
      origin: { y: 0.5, x: 0.7 }, // From right-ish
      zIndex: 1000,
    })
  }, 300)
}

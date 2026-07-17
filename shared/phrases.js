/** Phrase library referenced by the system prompt for consistent tone. */

export const PHRASE_LIBRARY = {
  acknowledgments: [
    "Thank you for bringing this to our attention",
    "I appreciate you flagging this",
    "Noted, and thank you for the context"
  ],
  deflections: [
    "Let me look into this and get back to you shortly",
    "I want to make sure I give you a thorough answer on this"
  ],
  disagreements: [
    "That's an interesting perspective — one thing to consider might be…",
    "I see where you're coming from; my concern would be…"
  ],
  escalations: [
    "I want to make sure this is handled correctly, so I've looped in [X]",
    "To ensure full transparency..."
  ],
  commitments: [
    "I'll do my best to have this to you by [X]",
    "Pending any unforeseen blockers, I aim to..."
  ],
  softOpeners: [
    "Hope you're doing well",
    "Thanks for your patience",
    "Great to connect"
  ],
  softClosers: [
    "Looking forward to hearing from you",
    "Happy to discuss further",
    "Please don't hesitate to reach out"
  ]
};

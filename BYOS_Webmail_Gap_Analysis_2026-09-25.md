# BYOS Gap Analysis vs. Competitors

**Date:** 2026-09-25
**Purpose:** Competitive feature review against Gmail, Outlook, Proton Mail, Tuta, Fastmail, and Thundermail
**Status:** For review before next development cycle

---

## Executive Summary

BYOS has a working zero-knowledge business email client with:
- Path A internal E2E encryption (compose + read + reply + sent folder)
- Post-quantum hybrid cryptography (X-Wing = X25519 + ML-KEM-768)
- Customer-controlled storage
- HTML signatures with layout and external images
- MIME parsing for clean replies

**The single biggest gap is email import.** Every competitor offers migration from Gmail/Outlook. Without it, BYOS can only sell to people starting fresh email — which is almost nobody.

---

## Critical Gaps (Users Will Notice Immediately)

| Gap | Who Has It | Impact | Effort |
|---|---|---|---|
| **Email import from Gmail/Outlook** | All major providers | Blocks all switching customers | 3–5 days |
| **Snooze** | Gmail, Outlook, Fastmail, Tuta | "Remind me tomorrow" — expected by modern users | 1 day |
| **Undo Send** | Gmail, Fastmail, Tuta | 5–10 second undo window | 0.5 day |
| **Threading / Conversation View** | Gmail, Outlook, Proton | Currently one-off messages; no thread grouping | 2 days |
| **Mobile Responsive Webmail** | All | Must work on phone browsers | 2 days |
| **Keyboard Shortcuts** | Gmail, Fastmail, Outlook | `c` for compose, `j/k` navigation, etc. | 1 day |

---

## Important Gaps (Competitive Table-Stakes)

| Gap | Who Has It | Impact | Effort |
|---|---|---|---|
| **Scheduled Send on Path A** | Gmail, Fastmail, Tuta | Currently falls back to Path B | 1 day |
| **Attachments on Path A** | Gmail, Outlook, Proton | Currently falls back to Path B | 2 days |
| **Contact Management Polish** | All | Partially implemented; needs UX work | 1 day |
| **Rules / Filters UI** | Gmail, Outlook, Fastmail | API exists; needs a UI | 2 days |
| **Nested Labels** | Gmail, Tuta | Tuta just shipped nested labels | 1 day |
| **Focused Inbox / Categories** | Gmail, Outlook, Proton | Auto-categorize Primary/Social/Promotions | 3 days |
| **Dark Mode Verification** | All | Signal exists; verify full coverage | 0.5 day |
| **Rich Text Composer Polish** | Gmail, Outlook | Tables, code blocks, better toolbar | 2 days |

---

## Nice-to-Have Gaps (Differentiators)

| Gap | Who Has It | Impact | Effort |
|---|---|---|---|
| **Shared Mailboxes / Delegation** | Outlook, Fastmail, Proton | Tuta shipped collapsible shared mailboxes | 3 days |
| **AI Features** | Gmail (Gemini), Outlook (Copilot), Proton (Lumo) | Smart compose, summaries, suggested replies | 5+ days |
| **Offline Support** | Fastmail, Tuta | Read and draft without connection | 3 days |
| **Masked Email / Aliases** | Fastmail, Proton | Generate burner addresses per service | 2 days |
| **Unified Inbox (multi-account)** | Gmail, Outlook, Proton | Partially implemented | 2 days |
| **Content Search on Mobile** | Proton | Search body text, not just subject | 1 day |
| **PGP Encryption** | Proton, Forward Email | Interop with external PGP users | 5 days |
| **Calendar Integration** | Gmail, Outlook, Proton, Tuta | Tuta includes free encrypted calendar | 10+ days |
| **File Sharing (large files)** | Thundermail (Send) | Encrypted large-file sharing | 3 days |

---

## BYOS Advantages (Keep Leaning Into These)

| Advantage | Why It Matters |
|---|---|
| **Customer-controlled storage** | Nobody else offers this. Proton and Tuta store your mail on their servers. |
| **Post-quantum E2E from day one** | Proton and Tuta are rolling this out; BYOS shipped it from launch. |
| **Zero-knowledge sent folder** | The sent copy is encrypted to your own key — even the server can't read what you sent. |
| **Individual mailbox model** | No org admin can read your mail. Stronger privacy commitment than any competitor. |
| **Open standards (SMTP/IMAP)** | Thundermail is the only other provider emphasizing this. Proton and Tuta lock you in. |

---

## Recommended 30-Day Priority

| Priority | Feature | Effort | Why |
|---|---|---|---|
| **1** | Email import from Gmail/Outlook via IMAP | 3–5 days | Blocks all switching customers |
| **2** | Threading / Conversation View | 2 days | Expected by every modern user |
| **3** | Snooze | 1 day | High-visibility, low-effort |
| **4** | Undo Send | 0.5 day | Small but delightful |
| **5** | Keyboard Shortcuts | 1 day | Power-user differentiator |
| **6** | Mobile Responsive Polish | 2 days | Halves the addressable market without it |
| **7** | Rules / Filters UI | 2 days | API exists; just needs a UI |
| **8** | Dark Mode Verification | 0.5 day | Polish |

**Total: ~12 days of focused work.**

---

## Immediate UI Fixes (This Week)

These are separate from the competitive gaps above and are quick wins:

1. **Bold unread messages, normal read messages**
   - Unread: `font-semibold` (600)
   - Read: normal weight (400), muted sender color

2. **Sidebar folder counts show unread only**
   - Hide badge when count is 0
   - Sent, Drafts, Trash never show a count

3. **Verify remaining polish**
   - Dark mode coverage
   - Loading states
   - Empty states per folder

---

## Notes

- Effort estimates assume the current stack (SolidJS + Vite + TailwindCSS + Go + Rust/WASM)
- Effort is founder-only time, not team time
- Priority order optimizes for "unblocks customers" over "nice to have"
- Competitor research is based on public product pages as of 2026-09-25

---

## Follow-Up

Once email import ships, revisit this document. The gap landscape will have
shifted, and it's worth re-running the competitive analysis before the
next development cycle.
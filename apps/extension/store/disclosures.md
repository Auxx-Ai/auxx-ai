# Data-collection disclosures

What to declare in the Chrome Web Store dev console's "Privacy practices" form.
Mismatches between this and what the reviewer observes are a common rejection
reason — mark anything ambiguous as **YES** and explain in the privacy policy.

## "What user data do you plan to collect from users now or in the future?"

Tick these:

| Category | Tick? | Why |
| --- | --- | --- |
| Personally identifiable information | **YES** | Parsed contact fields (name, email, phone, profile URL, company name, domain, avatar URL) sent to the user's own Auxx.ai workspace on user-initiated save. |
| Health information | NO | Never read or sent. |
| Financial and payment information | NO | Extension does not touch payment / financial data. |
| Authentication information | **YES** | A short-lived bearer token is minted from the user's existing auxx.ai session to authenticate the record-detail embed iframe. Held in iframe memory only; not persisted to `chrome.storage.*` or sent to any third party. |
| Personal communications | **YES** | The Gmail parser reads thread DOM at user request to extract recipient identity (name + email). Message body content is not stored, transmitted, or used for any other purpose, but the access exists. |
| Location | NO | No IP, GPS, or region-level collection. |
| Web history | NO | The extension does not track browsing. The only URL transmitted is the page on which the user explicitly clicked Save, sent once to `record.create` so the record can include the source URL the user is capturing from. |
| User activity | NO | No click / mouse / keystroke / scroll instrumentation outside the extension's own panel UI. |
| Website content | **YES** | Page DOM (text, images, hyperlinks) is read on the supported hosts (LinkedIn, Gmail, X, Facebook, Instagram, generic websites) only at user request, to parse the contact or company being saved. |

## Certifications (all three required, all three apply)

- [x] **I do not sell or transfer user data to third parties, outside of
      the approved use cases.** Parsed records flow only to the user's own
      Auxx.ai workspace via our API; no third-party recipients.
- [x] **I do not use or transfer user data for purposes that are unrelated
      to my item's single purpose.** All collected data serves the single
      purpose of saving contacts/companies into the user's Auxx.ai database.
- [x] **I do not use or transfer user data to determine creditworthiness
      or for lending purposes.** No credit / lending use whatsoever.

## Remote code: YES

See `permissions.md` for the full justification. Short version: the
record-detail panel embeds an `<iframe>` from `https://auxx.ai/embed/record/<id>`
that runs JavaScript hosted on auxx.ai. The CSP `frame-src` is restricted
to auxx.ai domains; no third-party origins can be loaded.

## Privacy policy

Public URL: https://auxx.ai/privacy-policy

The policy must cover, at minimum:

- What the extension reads — page DOM on listed hosts at user request
- What the extension sends — parsed contact records → user's Auxx.ai API
- What the extension stores — `chrome.storage.local`: theme, active org id
- Whether data is shared with third parties — no
- Data deletion — user can delete their Auxx.ai account; the extension stores
  nothing locally that survives an uninstall

The current version (`apps/homepage/src/app/privacy-policy/page.tsx`,
section 7) covers all five.

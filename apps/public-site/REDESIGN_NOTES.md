# BYOS Public Website Redesign

## Direction

A warm editorial identity built around the established BYOS ivory and mocha palette. The design uses oversized type, restrained motion, a crafted product preview, generous whitespace, and a clearer customer journey.

The central message is: **Business email. Your rules.**

## What changed

- Rebuilt the homepage around customer benefits rather than protocol names and cryptography experiments.
- Added a product workspace preview with interactive Mail, Calendar and Notes views.
- Added an ownership story, a three-step onboarding explanation, simplified volume pricing, plain-language FAQs and a focused final call to action.
- Removed the live WASM crypto demonstration from the marketing journey.
- Reworked desktop and mobile navigation, shared page headers and the footer.
- Redesigned Pricing, Security, Privacy, Support and Field Notes pages to use the same visual system.
- Kept deeper cryptographic detail in an optional disclosure on the Security page.
- Replaced speculative competitor-savings and raw storage-cost messaging with clear pricing bands and a note that storage is billed separately.
- Updated the favicon and social sharing artwork.

## Important content decisions

- The website does not claim every email is end-to-end encrypted.
- The Security page explains that incoming email is processed transiently for delivery before persistent mailbox data is encrypted for storage.
- Storage charges are described as separate and provider-dependent. No estimated per-GB rate is presented as a guaranteed price.
- No unsupported free-trial, setup-time, or automatic security-certification claims have been added.
- The Privacy page is a plain-language service overview and should be checked against the deployed product, current subprocessors, retention practices, customer terms and applicable legal requirements before publication as a final legal policy.

## Validation performed

- TypeScript/TSX syntax transpilation checks passed for the three edited Solid components.
- Astro frontmatter syntax transpilation checks passed for the edited pages and layout.
- Homepage browser-module syntax check passed.
- CSS parsed with zero syntax errors using `tinycss2`.
- Social sharing PNG regenerated from the new SVG artwork.

## Validation not completed

A full Astro build and browser preview were not completed in this environment. `npm ci` timed out while installing dependencies. The lockfile resolves Astro 7.4.4, which declares Node.js `>=22.23.4`; the available environment is Node.js 22.16.0. Run installation and the production build using a compatible Node version before deployment.

## Local run

From this directory, with a compatible Node.js version:

```bash
npm ci
npm run dev
npm run build
```

The public site uses `PUBLIC_CP_URL` for account links. The supplied `.env` file from the original archive has been excluded from this redesign package. Configure your own local environment from `.env.example`.

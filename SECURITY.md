# Security Policy

## Supported Versions

This is a static browser app. Security fixes are expected to target the current maintained code line only.

| Version | Supported |
| ------- | --------- |
| 1.1.x | Yes |
| Earlier versions | No, unless a maintainer explicitly marks a branch or release as supported |

## Reporting a Vulnerability

Do not open a public issue with exploit details, private data, or proof-of-concept payloads.

Use GitHub's private vulnerability reporting flow for this repository when available:

https://github.com/NatsumeAoii/dnd5e-quickref/security/advisories/new

If that flow is unavailable, contact the repository owner through the GitHub profile linked from the repository and ask for a private disclosure channel before sharing sensitive details:

https://github.com/NatsumeAoii

Include:

- Affected version, commit, or deployed URL.
- Browser and operating system, if relevant.
- Clear reproduction steps.
- Impact and affected data or workflow.
- Minimal proof of concept, if needed to verify the issue.
- Any suggested fix or mitigation.

## What to Expect

- A maintainer should acknowledge a report within 7 days when the project is actively maintained.
- Confirmed vulnerabilities are triaged based on impact, exploitability, and deployment risk.
- Fixes should be handled privately until a mitigation is available, unless the issue is already public or actively exploited.
- Public disclosure should include enough detail for users to update or mitigate without exposing unnecessary exploit detail.

## Security Considerations for Deployers

- Serve the app over HTTPS in production so the service worker, PWA features, and browser storage APIs work correctly.
- Do not add secrets, API keys, credentials, or private rule data to `public/`, `src/`, `js/data/`, or built `dist/` output. Static assets are downloadable by users.
- Keep the Content Security Policy in `index.html` restrictive when adding new assets or integrations.
- Treat rule JSON as content that can affect rendered UI. Preserve `DataService` validation and `safeHTML`/Trusted Types protections when changing rendering paths.
- User notes and favorites are stored client-side in IndexedDB and `localStorage`; do not treat them as server-backed or encrypted.
- Service-worker cache changes can affect update behavior and offline availability. Test first load, reload after deploy, and offline load when changing `public/sw.js`.
- If deploying under a subdirectory, keep Vite's relative base behavior (`base: './'`) or test all asset and service-worker paths after changing it.


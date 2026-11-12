# Decisions and deviations from docs/PLAN.md

## clipper2-js licence (Boost Software License 1.0)
The plan restricts dependencies to MIT / ISC / BSD / Apache-2.0. `clipper2-js` is
published under the Boost Software License 1.0. It is permissive (no copyleft, no
attribution-in-binary requirement for object code), and it is the only maintained pure-TS
Clipper2 port, so it is **accepted**. Its licence text is included in
`THIRD_PARTY_LICENSES.txt` and embedded as a comment in `dist/index.html`
(the package ships no licence file; `scripts/gen-licenses.mjs` supplies the standard BSL-1.0 text).

## @types/node as dev dependency
Needed so `vite.config.ts` (node:fs) and tests type-check. Dev only, MIT.

## check-dist allow-list
`scripts/check-dist.mjs` accepts URLs inside comments and XML namespace identifiers
(`www.w3.org`, `schemas.microsoft.com`). These are names, never fetched. The latter appears
in three's `3MFLoader` as 3MF XML namespace strings.

# Hubnot in the browser — TypeScript proof of concept

A static, browser-only client that creates real native Hubnot `issue.open`
events in a selected GitHub repository. Defaults to this checkout's origin,
`exergy-connect/hubnot`; enter any `owner/repo` or GitHub repository URL.
This does not create a GitHub Issues ticket.

## Run

Requires Node.js 20.19+ or 22.12+ for development (Node 24 recommended).

```sh
cd ts
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Supported targets include Safari/iOS 15+, Chrome/Android 90+, and Firefox 90+.
Ed25519 is bundled locally through `@noble/curves`, so native Ed25519 support is
not required. SHA-256 and secure randomness use Web Crypto. HTTPS or localhost is required. No backend, local Git, Hubnot
executable, OAuth proxy, or CORS proxy is used at runtime.

```sh
npm test
npm run build
npm run preview
# Install browsers once, then run mobile browser integration tests:
npx playwright install chromium webkit
npm run test:browser
```

`../docs/` can be served by any static HTTPS host. Vite uses relative asset URLs,
so the build also works under a subdirectory.

## Create an issue

1. Select an initialized repository (at least one branch/commit).
2. Enter a fine-grained GitHub personal access token scoped to that repository
   with **Contents: read and write**. Organization approval/SSO may also apply.
   A classic token needs appropriate repository access (`repo` for private repos).
3. Check the repository, enter your author name, title and optional description.
4. Choose **Sign & publish issue**. Save the displayed receipt.

The token goes only to `https://api.github.com`. By default it stays in page
memory. **Remember token for this repository on this browser** opts into
`localStorage`, keyed by the normalized `owner/repo` (GitHub URL and case variants
share the same entry). Selecting a different repository clears the current token
and restores only that repository's saved token. Unchecking removes that entry;
other repositories' saved tokens are preserved. Saved tokens are unencrypted and
accessible to scripts on the same site; use this option only on a trusted browser.
If storage is blocked, the interface reports it and continues using memory only.
There are no analytics, remote fonts, or third-party runtime scripts. Success
clears the token input; a saved token is restored for the next issue or reload.
Reloading discards publication/retry state, regardless of the token preference.

## Native format and transport

The browser generates a fresh, temporary Ed25519 private key for each issue.
The actor fingerprint is SHA-256 of the raw public key. It signs the exact UTF-8
`hn/0` payload, computes its `sha256:` event ID, then zeroes the private seed after signing. A title/body
opening is the minimal native issue format; no rich revision state is necessary.

GitHub's Git database REST API creates a tree containing only `event.json` and
`signature` (unpadded base64), a parentless actor-root commit, and
`refs/hn/actors/<actor fingerprint>`. No code branch is changed. See the
[GitHub references API](https://docs.github.com/en/rest/git/refs) and the
[native protocol](../docs/protocol-v0.md).

To consume the issue with the existing CLI in a local clone:

```sh
hn sync origin
hn issue list
hn issue show sha256:FULL_EVENT_DIGEST_FROM_RECEIPT
```

The repository's replication selection or contribution policy can restrict
admission; a successful remote write is not a policy admission or role grant.

## Boundaries and recovery

This is a creation-only interoperability experiment, not the complete CLI port.
It does not list/edit issues, reuse identities, manage keys, evaluate policy,
or replicate/validate remote histories. Each issue is a distinct actor; the
public author name is descriptive, not a verified GitHub identity. Later edits
can be signed by another authorized actor through the CLI. Prefer a test fork.

Publishing requires write access. Empty repositories are rejected instead of
silently adding a code commit. Permission errors, network
failures, and ref conflicts are shown in the interface.

After a failure, keep the page open and retry the same signed issue. Once a
commit exists, retries reuse it. A failed/timed-out ref creation is reconciled
by reading the exact ref and comparing its commit; existing refs are never
updated or overwritten. Failures before ref publication may leave unreachable
Git objects. If you reload after an uncertain write, inspect the receipt's ref
before creating another issue: there is no durable retry journal or automatic
cross-session deduplication.

Validation includes exact-byte signature tests, mocked API failure/retry tests,
and a fixture verified by the Go implementation (`go test -run TestBrowserIssueFixture .`
from the repository root). No live GitHub writes are performed by tests.

## Automated bundle publication

`.github/workflows/browser.yml` runs the unit tests, minifies JavaScript/CSS,
and tests the production build in Chromium (Android profile) and WebKit (iPhone
profile). Builds are uploaded as the `hubnot-docs` workflow artifact. On pushes
to `main` or manual runs on `main`, a separate job commits the generated root
`docs/` directory back to `main`. Pull requests never publish. Bot commits do
not retrigger the workflow. A stale build is rejected rather than overwriting a
newer source revision; rerun against the latest `main` if that happens.

The repository must allow the workflow's `contents: write` token to push to
`main`; protected branch rules may prevent publication. No token secret is
needed for the build workflow. This publishes static files to Git, not a hosting
service: serve `docs/` over HTTPS for phones (a LAN HTTP address is not a secure
context). Relative asset paths allow hosting at `/docs/` or a repository subpath.
Mobile checks are browser emulation, not physical device certification.

The bundle uses `docs/index.html`, `docs/LICENSES.txt`, and `docs/browser-assets/`.
Existing Markdown documentation is preserved; the workflow replaces only the
generated `docs/browser-assets/` directory. The uploaded artifact includes only
the browser bundle files.

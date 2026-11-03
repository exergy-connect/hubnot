# Hubnot in the browser — TypeScript proof of concept

A static, browser-only client that browses and creates native Hubnot object openings in a selected GitHub repository. Defaults to this checkout's origin,
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

## Create a signed object

1. Select an initialized repository (at least one branch/commit).
2. Enter a fine-grained GitHub personal access token scoped to that repository
   with **Contents: read and write**. Organization approval/SSO may also apply.
   A classic token needs appropriate repository access (`repo` for private repos).
3. Check the repository, select the object type, and enter its fields in the New signed tab.
4. Choose **Sign & publish** for the selected type. Save the displayed receipt.

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

To consume an issue with the existing CLI in a local clone:

```sh
hn sync origin
hn issue list
hn issue show sha256:FULL_EVENT_DIGEST_FROM_RECEIPT
```

The repository's replication selection or contribution policy can restrict
admission; a successful remote write is not a policy admission or role grant.

## Boundaries and recovery

This is a minimal browsing and creation interoperability experiment, not the complete CLI port.
It does not edit issues, reuse identities, manage keys, evaluate policy,
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

## Browse existing objects

The repository and token controls apply to both **Existing issues** and
**New signed** tabs for the selected object type. Public repositories can be browsed without a token;
private repositories require Contents read access. Choose the Existing tab to
load, or use Load issues to refresh. Drafts survive switching tabs.

The browser walks `refs/hn/actors/*` histories and verifies exact-byte signatures,
actor fingerprints, sequence/predecessor links and linear Git ancestry before
displaying issue openings. It shows original titles/descriptions, authors, dates
and full event IDs as plain text. Revisions, comments, current open/closed status,
accepted remote-ref namespaces and policy admission are outside this reader.
A valid signature identifies the signing key; it grants no repository authority.

To bound API traffic, this PoC supports at most 100 actor refs and 300 events per
load. Exceeding those bounds or encountering invalid/unavailable history shows an
error instead of a partial catalog. GitHub rate-limit errors are also displayed.
Changing repositories or tokens clears results and discards stale responses.

## Object type selector

The dropdown scopes both tabs to one of six supported native `hn/0` types:

| Type | Creation fields and behavior |
| --- | --- |
| Issue | Title and optional body. |
| Project | Title and body; starts unarchived with no custom fields/views. |
| Project item | Draft title/body, existing project opening ID and the same ID as schema revision. |
| Discussion | Title, body and category; starts open. |
| Discussion reply | Existing discussion opening ID and nonempty body. |
| Workflow | Name, title and description; starts disabled, without an executable pipeline. |

The reader filters verified actor histories by the selected opening kind. Typed
resource state is encoded in `Event.body` as required by the native protocol,
with `intent: open`; it is not an issue with a different label. Drafts are kept
separately in memory for each type. Type selection is locked while a signed
publication is pending so retries retain their original object.

Before publishing a child, the browser checks that its parent opening is in the
selected repository's verified histories. Project items currently use only the
project's opening schema and create draft targets with no custom values. Replies
are top-level in their discussion. Full dependency closure, moderation and policy
admission remain the CLI reader's responsibility. Browsing still shows openings,
not projected current state. The same 100-actor/300-event limits apply.

Proposals, reviews, CI, governance facts, identity relationships, memory, audits
and custom artifacts are shown as disabled CLI-only entries. They require
additional relationship-aware operations or separate protocol support and are
not authored by this PoC.

## Emulated hn console

The console below the tabs uses the repository and token controls above, plus
its own author-name field. It provides these commands for each selectable type:

```sh
hn help
hn version
hn issue list
hn issue list --json
hn issue show sha256:FULL_EVENT_ID
hn issue open --body "Description" "An issue title"
hn project open --input '{"schema":"hn.project/1","title":"Roadmap","body":"Planning","archived":false}'
hn project list
hn retry
```

`list`, `show`, and `open` work for issue, project, project-item, discussion,
discussion-reply and workflow. `show` accepts a full ID or a unique prefix of at
least eight hex characters. Resource `open --input` takes inline JSON with the
native state schema; it supports the same minimal shapes as the forms. Unsupported
fields/values are rejected, including enabling workflows or archiving new projects.
It does not read local files. This is an explicit command subset, not a full Go
CLI port: revision, governance, execution, synchronization, other protocols and
other commands report an unsupported-command error. The version is the browser
PoC version. JSON output is a browser catalog, not the CLI's versioned envelope.

The argument parser supports single/double quotes and backslash escapes. It never
executes a shell, expands variables or runs pipes. Arrow Up/Down recall the last
100 commands in memory; Clear clears output. Nothing in the console is persisted.
Selected tokens are not echoed, and there is no token command flag.

Creation signs locally and publishes real Git objects. An uncertain write retains
the signed event and known commit in memory; `hn retry` reuses them and requires
the original repository to remain selected. Further creation is blocked until
that retry succeeds. Keep the page open and save the displayed event/ref/commit
receipt for recovery. Form and console writes are serialized. The console's
object type comes from the command, independently of the dropdown selection.

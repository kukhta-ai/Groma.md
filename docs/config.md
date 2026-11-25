# Project configuration

`<groma-root>/config.json` selects the project's plugins and settings. Commit it
so colleagues select the same sources. This file grants no permission to execute
code. Each computer separately approves executable content outside Git.

```json
{
  "scanners": [
    { "id": "typescript", "source": "@groma/scanner-typescript@0.2.4", "include": ["**/*.ts"] }
  ],
  "workSources": [{ "id": "backlog", "version": "1.55.3" }],
  "exclude": ["/test/"],
  "useGitignore": true,
  "automaticUpdates": false
}
```

## Plugins and execution approval

Ids are lowercase kebab-case and unique across sections. `scanners` entries have
`id`, `source`, `include`, and optionally `settings`, `exclude` and `integrity`.
`workSources` contains at most one entry, currently `backlog`, with an exact
`version` and optional `integrity`.

An npm source records an exact `package@version`. A Git source is
`git+https://repository#tag-or-commit`; approval resolves a tag to its exact
commit and records that commit. A local `./path` identifies a runnable package.
Approval captures its complete content into a separate retained directory.
Changing the original local package requires an explicit **Update** and new
approval. A selected Backlog version is exact; Groma uses its approved managed
SDK, preserving any unrelated global Backlog installation.

Add, Install, Restore and Update stage metadata and bytes with package lifecycle
scripts disabled. They show source, package version, Git commit where applicable,
and a SHA-256 content digest. Confirming approves those captured bytes. Declining,
expiration, a changed project selection or a different browser session prevents
activation. Proposals last five minutes and can be confirmed once.

The loader verifies the external approval and complete content digest immediately
before importing a scanner. Every managed Backlog operation verifies the selected
SDK before spawning its executable. Modified content is refused. Approved code
runs with your account's privileges; this mechanism is not a sandbox.

A project `integrity` is an optional additional constraint. Without it, execution
still requires a unique external approval for the exact source identity and a
matching complete content digest. This permits one shared configuration with
separately approved platform-specific SDKs. Duplicate external identities fail.
See [plugin approval and CI](scanners/trust.md) for the external authority format.

There is no automatic `scanners.json` migration or adoption of an ambient global
Backlog command. Select plugins through the normal explicit setup flow.

## Optional update checks

`automaticUpdates` defaults to `false`. **Check for updates automatically** in
Plugins (web checkbox or terminal `t`) enables release metadata checks. A check
can report an available compatible stable npm release. It cannot install content,
change `config.json`, import a new release or trigger a scan. File edits do not
check npm. Explicit **Update** reviews and confirms the proposed release.

Installed approved scanners keep working offline. A session owns at most one
in-flight metadata check, and closing it cancels that check. Disabling checks
while a request is pending prevents that result from being published.

## Restoring on another computer

`groma plugin install` and the native Restore actions restore exact configured
sources, never the newest compatible release. An existing external approval uses
its retained SDK. If that directory was deleted, restoration requires its saved
package manifest and frozen Bun lock; the rebuilt complete content must match the
approved digest. Missing locks or changed bytes fail closed. A new computer must
explicitly review the selected content or receive a separately reviewed external
approval profile. A missing local source must be brought back by its author.

The authenticated web startup retains **Restore** and **Proceed without them**.
Proceeding opens saved architecture read-only. Plugins offers individual and
batch actions. A batch stages all its proposed content before approval and changes
selections together. Metadata conflicts require reviewing a fresh proposal;
authored selections are preserved. Removing a plugin keeps retained packages and
saved architecture, but removes that selection from project configuration.

## Commands

```sh
groma plugin add backlog
groma plugin add @groma/scanner-go
groma plugin list
groma plugin install
groma plugin update typescript
groma plugin update backlog
groma plugin remove backlog
```

Bare npm names select a compatible stable release and show the exact proposed
version before consent. Scanner Update can also choose an exact version of the
same package or a Git revision of the same repository. Backlog Update proposes
the fork's pinned managed version, currently `1.55.3`. CLI interactive commands,
the terminal Plugins page and authenticated web Plugins retain these operations.
Unattended commands require matching previously reviewed external approval.

`exclude` and `useGitignore` apply to scanners as described in
[Scanners](scanners/index.md). [Plugin settings](scanners/setup.md) describes
source detection, readiness and native controls.

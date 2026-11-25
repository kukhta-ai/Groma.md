# Executable plugin approval

Project configuration is selection metadata. Execution permission belongs to an
external user-owned authority file. The default is
`~/.groma/plugin-approvals.json`. Select another file explicitly:

```sh
groma --plugin-approvals /absolute/private/plugin-approvals.json scanner check
groma --plugin-approvals /absolute/private/plugin-approvals.json scan
```

The file must remain outside the project and every Git checkout, including
through path aliases. On Unix it and its directory must be owned by the current
user and not writable by other users. The file must be ordinary, not a symlink or
hard link. Project configuration and environment variables cannot select this
authority. Do not commit it or copy a project's proposed approval file into use
without reviewing its origin and content.

## Interactive flow

CLI, terminal and authenticated browser actions retain Add, Install, Restore and
Update. Before approval, Groma downloads content into owned staging directories,
reads package metadata and computes its digest. It does not import the plugin or
run package lifecycle scripts. A proposal identifies the exact npm version, Git
commit or canonical local source and the complete staged content digest.

A proposal belongs to one canonical project and one caller session, lasts five
minutes and is consumed once. Confirmation retains the captured bytes, records
consent outside Git and applies project selections under the existing config
lock. A stale selection is refused so the user can review a new proposal. A batch
is staged completely before consent; a failed proposal activates no partial batch.
Removal does not require permission to execute code.

Interactive grants include a canonical `projectRoot` binding. Approving different
content in another project sharing the authority cannot retarget an existing
project's selection. For a given source, this project's grant takes precedence
over an explicitly supplied global bootstrap profile. Another project's grant
never applies. Duplicate grants within one scope and identity are rejected.

Local packages are captured into retained directories, not imported from their
mutable original paths. Groma also verifies that the original still matches
before importing the retained entry. Use Update to review edits. Packages must be
runnable with their dependencies in the captured content root; packaging a
monorepo plugin first avoids relying on source outside its package.

## Reviewed CI profiles

Unattended operations do not accept new plugin content. A deployment owner can
prepare exact SDKs as data with lifecycle scripts disabled, review their frozen
package inputs and complete content digests, and provision a private authority
file separately from the repository. WPM's runtime uses this explicit bootstrap
route. The schema is:

```json
{
  "schemaVersion": 1,
  "approvals": [{
    "kind": "scanner",
    "id": "typescript",
    "source": "@groma/scanner-typescript@0.2.4",
    "name": "@groma/scanner-typescript",
    "version": "0.2.4",
    "integrity": "sha256:REPLACE_WITH_REVIEWED_CONTENT_DIGEST",
    "contentRoot": "/absolute/private/typescript-sdk"
  }]
}
```

Replace the digest placeholder using `pluginContentIntegrity` from
`src/plugins/integrity.ts` over the exact deployed directory. An npm SDK root
contains its `package.json`, frozen `bun.lock` and complete `node_modules`; the
scanner is below `node_modules/<package>`. A Backlog record has `kind:
"workSource"`, `id: "backlog"`, `name: "backlog.md"`, exact `version: "1.55.3"`
and `source: "backlog.md@1.55.3"`. Its SDK contains the matching wrapper and
current-platform native package. Rehash immediately before deployment and
execution. A deliberately reviewed bootstrap record may omit `projectRoot`;
normal interactive confirmations always bind it.

Optional `restore: { "packageJson": "original manifest bytes", "bunLock":
"original frozen lock bytes" }` retains exact package-manager inputs. Restoring a
deleted remote SDK requires these inputs and a frozen, script-free install whose
complete digest matches. No newest-compatible or newly resolved transitive
closure substitutes for the approved one. Without a recipe, retain or reprovision
the exact approved SDK externally. A modified existing SDK is refused rather than
automatically overwritten.

Profiles may differ across platforms. Shared project configuration may omit its
optional `integrity`; execution still requires a unique exact-source approval and
a matching SDK digest. If configuration includes `integrity`, that constraint is
strict. SDKs prepared externally do not cause a host-specific hash to be written
into shared project configuration.

After provisioning approved SDKs, CI runs `scanner check` and `scan` with the
explicit authority argument. These commands cannot silently approve or replace
code. `plugin install` may restore already approved missing content; a new
computer without an external profile needs an explicit human review.

## Integrity boundary

The versioned content digest binds sorted relative paths, file bytes, executable
bits and confined internal symlinks. Git control directories are excluded.
External links and nonregular content are rejected. Every import verifies its
entry and full current content against the selected external approval; managed
Backlog resolves and verifies before every native invocation.

Approval is permission to run code with the account's privileges. It is not a
sandbox or a promise that approved code cannot access files, networks or launch
processes. This boundary prevents repository metadata, background updates and
unconfirmed replacements from granting that permission.

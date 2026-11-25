# Project plugin settings

[`config.json`](../config.md) lists the project's plugins; its page explains how a colleague
restores them. This page covers the plugins screen and scanner setup.

Open **Plugins** from the groma.md splash screen (`s`), the terminal map
(`Shift+S`), or **Settings → Plugins** in the web toolbar.
`groma scanner settings` opens the same terminal
screen; without a terminal it prints the shared settings snapshot as JSON.

Within **Scanners**, the screen groups **Installed**, **Missing on this computer**,
and **Recommended**. **Work sources** lists Backlog.md: listed, or offered with **Install**. Empty groups are hidden. Search filters the list by
scanner name, package or technology. Web rows keep the scanner name, version,
origin and available action together. **Matching files** expands the source
detection evidence; **Scanner details** reveals diagnostics for failures.
The web offers bulk installation when a group has multiple installable scanners. A single
recommendation has one **Install** button; multiple recommendations also offer
**Install all**. Settings is always available in live web.
A warning appears only when scanning needs attention and opens the affected
scanner in Settings. Potential duplicates belong to the separate Project review.

**Install** resolves a compatible stable release, stages its exact bytes without
lifecycle scripts, and shows package identity and content digest for approval.
Only confirmed content is selected and scanned. **Install recommended scanners**
proposes all current recommendations as one batch; **Install missing plugins**
restores the exact configured sources. A batch must stage completely before its
one-time confirmation. A failed proposal activates no partial batch.

Scans and live maps use already approved installed scanners. The project's
`automaticUpdates` setting defaults to `false`; **Check for updates automatically**
in Plugins (web checkbox or terminal `t`) enables metadata checks. An enabled
check can show a newer release but cannot download replacement SDKs, change
selections or rescan. Opening Plugins shares any metadata check already running.
Offline use keeps approved installed versions working. File edits alone do not
check npm. Explicit Update requires reviewing the proposed exact content.

**Add plugin** accepts a package name, exact npm version, Git source or local
package path. Bare names use the same published-release selection. For a missing
local package, restore its directory. **Remove from project** keeps saved
architecture. For npm scanners, **Update** installs the newest compatible stable
release and saves its exact version. Opening web settings checks for newer
compatible releases and shows the installed and available versions with **Update**
on the row. The button proposes that shown version for explicit content approval. An available upgrade does not
raise a scan warning. Update check errors appear in Details without changing scan
readiness. **Remove from project** and **Choose version** are in Details.
**Choose version** selects an exact version of the same package. Background checks cannot replace it. Git updates
require a tag or commit in the same repository and keep that revision.

Release selection and download both use the package manager built into groma.md,
so they follow the same npm settings. They read the default registry
(`registry=`), a scope's registry (`@scope:registry=`) and registry tokens
(`//host/:_authToken=`) from the `.npmrc` in your home directory, and the
`npm_config_registry` environment variable. A proxy comes from the `HTTP_PROXY`
and `HTTPS_PROXY` environment variables, including credentials in the proxy URL.
The `proxy` and `https-proxy` keys of `.npmrc` are not read, and neither is a
`.npmrc` inside the project.

Git scanner sources and Git dependencies use native Git settings unchanged, including
CA files and directories, certificate verification, HTTPS and HTTP proxies, URL
rewrites and authentication; staging disables Git hooks. Groma does not replace Git trust stores or block
HTTPS proxies. Maintain Git and its trust store in the environment that runs it.

The CLI uses the same release selection:

```sh
groma plugin update typescript
groma plugin update typescript @groma/scanner-typescript
groma plugin update typescript @groma/scanner-typescript@0.1.2
```

Scanners validate project requirements when scanning. A failed scanner shows its
error and **Retry** after fixing the problem. Download and release-selection
failures show the affected package, the next step and **Retry installation**.
Full error output is available inline through Details; the web shows **Needs
attention** on the row and keeps the full diagnostic in **Error details**. groma.md does
not install project dependencies or development tools on the user's behalf.

In the terminal, `i` installs recommended scanners, `m` installs missing plugins,
and `r` retries a failed installation. `/` edits search, Enter keeps the filter, and Escape clears it
while editing. `d` toggles details; Page Up/Down scrolls the open details or moves
through the list. Web details expand inside the selected row.

A warning means no available selection matches detected source projects. A quiet
hint means some detected technology support is missing or its project match is unknown. Actual
scanner failures show their error. No detected source project is neutral, so a
project used only to read saved or hand-written architecture needs no scanners.
Unknown metadata or compatibility remains unknown; a match never promises complete
architecture coverage. Official and third-party plugins use the same rules.

The live session starts its source watch before the first scan. Edits made during
that scan wait for the current batch to finish.
The live session watches relevant source declarations through the scanner adapter,
including with no scanner selected so new projects can appear in settings. Only
approved project selections with unchanged captured content and without known
metadata incompatibilities execute scans.
An incompatible groma.md API version blocks the plugin before its
code is loaded, including preparation checks. Settings show the reason; other
eligible scanners can still run. An empty observation set does not
write architecture. Missing packages do not prevent available scanners from
running. Partial scans keep Code and relationships from absent scanners, including
relationships that need several scanners. An active scanner failure keeps that scanner's
saved result while successful scanners update theirs. Each failed scanner shows
its own error. Setup reports readiness problems and continues to the scan. Package changes and exclusion lists update
subscriptions without restarting. Architecture and Backlog updates have separate
subscriptions.

## Initialization and command-line setup

`groma init` reviews scanner support before its first scan. The terminal shows
project declarations, evidence locations, package availability, and coverage
gaps, then offers the installable packages in one selection. The browser saves
project settings first, then shows the same proposal with package checkboxes
before scanning. Existing scanner selections are retained. Clear a new package selection to decline it.
Each browser session receives its own five-minute, one-time content proposal.
Another window cannot confirm that session's proposal. The exact original staged
bytes are used on confirmation. Selection conflicts require reviewing again.
The terminal setup flow retains successful individual selections when a later
selection fails. Web batches stage completely before confirmation. Previously
approved installed versions run immediately; background checks only notify.

Run the journey again after project technologies change:

```sh
groma scanner setup
```

Setup adds only selected scanners. `config.json` in the selected architecture
directory records their exact resolved package versions; background checks never
change these selections. Disable an existing scanner explicitly with
`groma plugin remove <id>`.

## Package availability and project readiness

`groma scanner discover` reads declarations and reports project matches and official candidates;
it does not run plugins or install anything. Detection offers a package name.
Install resolves a published release for groma.md and this computer; the scanner
then validates source inputs and language support.

`groma plugin list` reports whether each listed plugin is on this computer without executing scanner code. `groma scanner check` separately loads
enabled plugins and runs their source-readiness checks:

- `ready`: the source-readiness check passed; the scan can still report a
  syntax or analysis error.
- `blocked`: scanner assets or supported source inputs are missing or invalid. The
  plugin's concrete instructions are printed and the command fails.
- `unchecked`: the plugin has no readiness hook. It remains enabled and its
  scan establishes whether the project is supported.

Java and C# check their bundled workers and runtimes plus source project
inputs. Framework scanners use their own compiler tools. A supported fresh
checkout needs no installed project dependencies, build output, or separately
installed language SDK. Missing external types remain unresolved facts.

If approved scanner assets are missing, restore the exact frozen SDK. Modified
content is blocked and must be reviewed through an explicit Update. Correct invalid
source or unsupported configuration according to its diagnostic. Failed scanners
retain their saved evidence while successful scanners update architecture.
Missing or unselected packages do not prevent other selections from running.

## Noninteractive use

Without a terminal, initialization and `groma scanner setup` report the
proposal and readiness without asking for input or installing packages.
`groma scanner setup --no-interactive` requests this behavior explicitly.
Discovery can also run before initialization in an existing Git repository:

```sh
groma scanner discover --json
groma init 'My project' --directory groma
groma scanner setup --no-interactive
```

Interactive `groma plugin add <package>` selects a compatible release and asks
for explicit approval of its identity and complete content digest. Unattended
commands require a separately reviewed user-owned authority outside Git. See
[executable plugin approval](trust.md) for provisioning and frozen restoration.
Once CI has provisioned exact approved SDKs:

```sh
groma --plugin-approvals /absolute/private/plugin-approvals.json scanner check
groma --plugin-approvals /absolute/private/plugin-approvals.json scan
```

Local scanner paths remain available for development through `plugin add`.
Groma captures their runnable package bytes into a retained directory and rejects
changes to the original source before import. Update explicitly reviews those
changes. Commit or distribute the runnable package to share it; each computer
still needs its own explicit content approval. A local path does not establish
that an official public release exists.

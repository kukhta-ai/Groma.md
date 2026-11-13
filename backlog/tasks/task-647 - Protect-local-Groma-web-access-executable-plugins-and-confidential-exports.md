---
id: TASK-647
title: Protect local Groma web access executable plugins and confidential exports
status: In Progress
assignee: []
created_date: '2026-11-13 06:09'
updated_date: '2026-11-13 16:08'
labels: []
dependencies: []
modified_files:
  - docs/scanners/trust.md
  - src/plugins/approval.ts
  - src/plugins/integrity.ts
  - src/plugins/proposal-items.ts
  - src/plugins/trust.ts
  - src/viewers/web/access.ts
  - src/viewers/web/handoff.ts
  - src/viewers/web/plugin-confirmation.ts
  - src/viewers/web/plugin-routes.ts
  - src/work/backlog-tool.ts
  - test-bun/backlog-tool.test.ts
  - test-bun/plugin-approval.test.ts
  - test-bun/plugin-fixture.ts
  - test-bun/source-confinement.test.ts
  - test-bun/web-access.test.ts
  - test-bun/web-backlog-fixture.ts
  - test-bun/web-client.ts
  - test-bun/web-server-access.test.ts
  - README.md
  - docs/config.md
  - docs/scanners/setup.md
  - docs/viewers/web/index.md
  - plugins/work-sources/backlog/src/index.ts
  - src/cli.ts
  - src/config.ts
  - src/history/snapshots.ts
  - src/init-command.ts
  - src/plugins/management.ts
  - src/plugins/settings-model.ts
  - src/plugins/settings.ts
  - src/scanner/background-updates.ts
  - src/scanner/cli.ts
  - src/scanner/modules/inventory.ts
  - src/scanner/modules/package-manager.ts
  - src/scanner/modules/package.ts
  - src/scanner/modules/readiness.ts
  - src/scanner/registry.ts
  - src/scanner/session.ts
  - src/viewers/source/diff.ts
  - src/viewers/source/read.ts
  - src/viewers/source/structure.ts
  - src/viewers/tui/plugin-settings.ts
  - src/viewers/web/data.ts
  - src/viewers/web/export.ts
  - src/viewers/web/map-session.ts
  - src/viewers/web/server.ts
  - src/viewers/web/settings/plugins.ts
  - src/viewers/web/startup/page.ts
  - src/viewers/web/startup/restore.ts
  - src/viewers/web/work/badge.ts
  - src/viewers/web/work/island.ts
  - src/welcome/model.ts
  - src/work/backlog-cli.ts
  - src/work/sources.ts
  - test-bun/angular-scanner.test.ts
  - test-bun/csharp-lint.test.ts
  - test-bun/csharp-outline.test.ts
  - test-bun/csharp-source-units.test.ts
  - test-bun/go-scanner.test.ts
  - test-bun/java-duplicates.test.ts
  - test-bun/java-outline.test.ts
  - test-bun/javascript-scanner.test.ts
  - test-bun/lint-command.test.ts
  - test-bun/npm-trust.test.ts
  - test-bun/php-scanner.test.ts
  - test-bun/python-scanner.test.ts
  - test-bun/rust-scanner.test.ts
  - test-bun/scanner-compatibility.test.ts
  - test-bun/scanner-composition.test.ts
  - test-bun/scanner-exclusions.test.ts
  - test-bun/scanner-installation.test.ts
  - test-bun/scanner-restore.test.ts
  - test-bun/scanner-settings-lifecycle.test.ts
  - test-bun/scanner-settings.test.ts
  - test-bun/scanner-update.test.ts
  - test-bun/source-coverage.test.ts
  - test-bun/swift-scanner.test.ts
  - test-bun/viewer-scanner-availability.test.ts
  - test-bun/vue-lint.test.ts
  - test-bun/vue-scanner.test.ts
  - test-bun/web-export.test.ts
  - test-bun/web-sharing.test.ts
  - test-bun/web-startup.test.ts
  - test-bun/work-source-selection.test.ts
  - test-bun/architecture-findings.test.ts
  - test-bun/source-relationships.test.ts
  - test-bun/git-proxy-trust.test.ts
  - test-bun/compiled-scanner.test.ts
  - test-bun/react-scanner.test.ts
  - test-bun/code-outline.test.ts
  - plugins/scanners/java/build.ts
ordinal: 706000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only authenticated local sessions can read private project data or change it
- [ ] #2 Executable plugins require consent bound to exact content and restore retains approved versions
- [ ] #3 Source exports preserve confidentiality and require explicit acknowledgement
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Recover approved security changes from the interrupted 2026-11-06 session against exact base9f2590f. Existing behavioral regressions establish web auth, plugin consent, trust and source capture. Full native checks and independent review precede pinning; no publication or merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Recovery restored the interrupted security implementation against upstream9f2590f. Frozen Bun1.4.4 install with lifecycle scripts disabled succeeded without lock drift. Focused real Bun security checks:30 passed across web access/server, plugin approval, source confinement and managed Backlog tool. Recovered missing rm import in existing scanner composition regression. Full check and source freeze remain pending. WPM integration is still pending, with no production fork pin or candidate claim.

Additional preserved fixtures now supply explicit owned consent for findings, relationships, compiled scanner, proxy transport, React and mixed outlines. Proxy and compiled-scanner checks pass; isolated fixtures avoid copying transient locks while a shared source fixture is being read. No production scope or assertions removed.

Cold independent review reproduced a web-confirm integration bug: same-path local Update left the live registry on old code because its shared config signature was unchanged. The supported web Update flow requires forced reconfiguration after consent. Extend the existing live-update regression through production pluginResponse rather than calling reconfigure directly.

Forced reconfiguration also refreshes the live work-source consumer after web approval, matching native session.change behavior.

Recovered source passes TypeScript7.1.0-beta and native Bun security regressions. Six preserved fixture files pass64/64 with the upstream runner settings; production web-confirm regression passes15/15 with server access. Full check retains1031 viewer tests:939 pass64 skip28 fail, all remaining failures require unavailable Java/Swift/COBOL/JVM tooling; the full gate is NOT passed. Cold independent review found web-confirm stale registry and verified its fix. Source freeze checkpoint supports remote CI; architecture curation and integration qualification remain pending.

CI43456996149 on immutable ad95fd4: Linux full repository check passes1005 viewer tests with24 standard conditional skips; two existing Java registered-scanner tests fail because the maintainer build copy rewrites jlink internal relative symlinks into absolute links outside the package. Plugin confinement correctly rejects them. Routine correction plan: preserve relative symlink bytes when copying the built Java runtime into its development scanner root; keep integrity rejection unchanged. Existing java-duplicates and java-outline tests already detect the supported-flow regression, so no duplicate test is added. Verify cp/integrity behavior with owned synthetic scratch, then repeat the unchanged full CI on all three platforms. Local heavy compiler/dependency provisioning remains blocked below10GiB capacity.

Focused Bun1.4.4 owned-scratch probe reproduces the original cp behavior: the copied Java-style legal link escapes the package and is rejected. With verbatimSymlinks:true the copied root has exactly the original content digest; changing the linked target changes that digest. Integrity code and confinement checks are unchanged. Existing Java registered-scanner failures provide the end-to-end regression cases; full platform CI still required.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Acceptance criteria have objective verification evidence.
- [ ] #2 Relevant checks pass and changes remain task-scoped.
- [ ] #3 Public contracts or documentation are updated when behavior changes.
- [ ] #4 Implementation Plan reflects the final approach; correction history and verification are recorded in Implementation Notes.
<!-- DOD:END -->

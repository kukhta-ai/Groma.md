---
id: TASK-647
title: Protect local Groma web access executable plugins and confidential exports
status: In Progress
assignee: []
created_date: '2026-11-13 06:09'
updated_date: '2026-11-25 00:05'
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

Full Linux CIcd73635 again reaches1005 passed24 conditional skips2 Java registration failures. The development build copy is now correct, but each of the two existing tests independently copies GROMA_TEST_JAVA_PACKAGE into its artifact root with default cp, rewriting the same internal links before consent. Extend the same verbatim link preservation to these two fixture copies; retain all existing behavioral assertions and source-confinement checks. Standalone/npm build checks, fresh-checkout scanner-package checks and C# worker checks already passed on cd73635. Full revised platform CI remains required.

Resume2026-11-24: full dd9b613 CI passes Linux, Windows has6 failures, macOS cancelled. Two npm update failures rename into an already retained identical content cache and Windows reports EPERM instead of EEXIST/ENOTEMPTY. Extend only existing-target reuse handling: verify complete digest before reusing it, propagate missing destination/original failure and reject changed bytes. Three other failures are owned fixture cleanup EPERM; use the native bounded recursive rm lifecycle options (3 retries,100ms) after existing awaited scanner work, preserving cleanup failure reporting. Backlog web fixture tar also needs cwd-relative output and input paths. Existing update, outline/exclusion and web startup tests reproduce these failures; keep assertions and scope. No publication or reduced gates.

Changed src/scanner/modules/package.ts: Windows EPERM can reuse only an existing digest-identical retained destination; absent destination still propagates the rename failure. Path is already present in the complete modified-file list.

Changed existing tracked test-bun/plugin-fixture.ts: bounded native recursive removal handles transient Windows filesystem EPERM and still rejects persistent cleanup errors. No test execution retries added.

Changed existing tracked test-bun/web-backlog-fixture.ts: tar receives a relative archive filename and cwd=package parent, avoiding Windows drive-letter interpretation. No assertions removed.

Focused qualification after Windows fixes: frozen Bun1.4.4 restore completed with unchanged bun.lock; full TypeScript check passes and scoped Biome lint passes. Four real Bun files (plugin approval, scanner update, web startup, scanner exclusions) pass42 tests/346 assertions. Independent targeted review found no weakening of exact-byte approval or Restore: EPERM reuses only a complete digest-identical target, missing target propagates original error, persistent cleanup errors fail. Native Windows and macOS results still require fresh full CI. No publication or merge.

Native macOS CI7f4be04 reports one fixture mismatch: the security ledger correctly stores canonical /private/var project paths, but the shared-authority test expects raw /var aliases. Canonicalize the existing fixture base at creation; preserve both project identities and cross-project denial assertions. Production authority logic is unchanged. Wait for Windows results before batching the final fork revision.

Changed already tracked test-bun/plugin-approval.test.ts: canonical realpath fixture base makes ledger identity expectations portable to macOS temp-directory aliases; no assertions removed.

Canonical macOS fixture correction passes13 real plugin-approval tests/53 assertions locally; existing refusal and cross-project binding assertions unchanged. Linux full CI7f4be04 passed. macOS full CI had only the raw /var versus canonical /private/var expectation failure. Windows full result still running; preserve that run for native defect evidence while the corrected fixture enters a fresh full CI.

CI45506453764 on1b98487 passes Linux/macOS; Windows has3 cleanup-only EPERM failures in the existing TypeScript-installed mixed Go/Rust outline and scanner-default exclusion cases. SDK API.close ends worker stdin without awaiting exit. Keep the complete assertions and execute these three cases once in disposable Bun subprocesses; the parent owns a private temporary directory and removes it strictly after child exit, with an explicit completion marker so a missed/conditional-skipped child cannot pass. Pinned Bun1.4.4 help verifies --test-name-pattern and --no-orphans. No production scanner, consent or confinement rules change. The restored protected runtime is still provisioning; agent-instructions currently rejects missing receipt, so the previously selected task/inspect guides were re-read from the source docs. Local Backlog1.45.2 does not support the newer instructions subcommand; task edits still use the mandated local CLI. Full native fork checks and all-platform CI remain required.

Prepared fixture-lifetime fix on1b98487: the3 existing assertions run unchanged in one exact-name Bun1.4.4 subprocess each; --no-orphans bounds descendants, parent owns private canonical temporary root and strictly removes it after child exit. Completion marker rejects both unmatched and conditionally skipped child cases; native negative probes confirm rejection and no owned directory leaks. Existing scanner-exclusions6/6 passes including actual child execution; TypeScript7.1.0-beta and scoped Biome4 files pass. Full bun run check executed:939 viewer passes64 conditional skips28 failures, same unavailable Java/Swift/COBOL/JVM prerequisites as prior local baseline, so local full gate remains unverified. Source/consent/confinement behavior is unchanged. Own scope/spec/quality review checked parent cleanup on errors and preserved all assertions. All-platform fork CI is required before final pin; no full-gate pass claimed.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Acceptance criteria have objective verification evidence.
- [ ] #2 Relevant checks pass and changes remain task-scoped.
- [ ] #3 Public contracts or documentation are updated when behavior changes.
- [ ] #4 Implementation Plan reflects the final approach; correction history and verification are recorded in Implementation Notes.
<!-- DOD:END -->

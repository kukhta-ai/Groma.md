import type { PluginChangeProposal } from '../../plugins/approval.ts'
import { escaped } from './atoms/escape.ts'

/** Consent names the exact executable content; every repository-controlled value remains text. */
export function renderPluginProposal(proposal: PluginChangeProposal): string {
  const items = proposal.plugins.map(plugin => `<li><strong>${escaped(plugin.name)}</strong><dl>`
    + `<dt>Source</dt><dd>${escaped(plugin.source)}</dd><dt>Version</dt><dd>${escaped(plugin.version)}</dd>`
    + (plugin.commit === undefined ? '' : `<dt>Commit</dt><dd>${escaped(plugin.commit)}</dd>`)
    + `<dt>SHA256</dt><dd>${escaped(plugin.integrity)}</dd></dl></li>`).join('')
  return `<h2>Approve executable plugins</h2><p>These plugins run with your local account permissions.</p><ul>${items}</ul>`
}

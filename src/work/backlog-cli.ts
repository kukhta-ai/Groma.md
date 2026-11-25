import { approvedBacklogCommand } from './backlog-tool.ts'
import type { PluginTrustOptions } from '../plugins/trust.ts'

async function succeeds(repositoryRoot: string, args: string[], options: PluginTrustOptions): Promise<boolean> {
  // Resolve outside the process error handler: missing approval is a blocking policy error, not a missing project.
  const command = await approvedBacklogCommand(repositoryRoot, options)
  try {
    const child = Bun.spawn([command, ...args], {
      cwd: repositoryRoot, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    })
    return await child.exited === 0
  } catch { return false }
}

/** Query only the selected exact approved native tool; never probe a command inherited from PATH. */
export function backlogInitialized(repositoryRoot: string, options: PluginTrustOptions = {}): Promise<boolean> {
  return succeeds(repositoryRoot, ['config', 'get', 'projectName'], options)
}

/** Initialize through the approved tool after explicit plugin consent. */
export function initializeBacklog(repositoryRoot: string, projectName: string, options: PluginTrustOptions = {}): Promise<boolean> {
  return succeeds(repositoryRoot, [
    'init', projectName, '--defaults', '--integration-mode', 'cli', '--auto-open-browser', 'false', '--agent-instructions', 'agents',
  ], options)
}

import { checkNpmScannerUpdates } from './modules/inventory.ts'

/** Optional release metadata checks notify without replacing approved content or starting a scan. */
export async function startBackgroundScannerUpdates(root: string): Promise<void> {
  for (const update of await checkNpmScannerUpdates(root)) {
    console.info(`Plugin update available: ${update.id} ${update.source}. Review it with groma plugin update.`)
  }
}

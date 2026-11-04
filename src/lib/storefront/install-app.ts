// Installing the site as an app, pure parts. Client safe.
//
// Chrome and Android offer a real install prompt (beforeinstallprompt). iPhones
// and iPads have none, so the menu says how to do it by hand. Once the site
// runs as the installed app there is nothing to offer. The manifest is
// src/app/manifest.ts, the menu row src/components/storefront/InstallAppRow.tsx.
// Tested in tests/storefront-install-app.test.ts.

export type InstallMode = 'prompt' | 'ios'

/** Null hides the row: already installed, or no way to install from this browser. */
export function installMode(input: { standalone: boolean; canPrompt: boolean; ios: boolean }): InstallMode | null {
  if (input.standalone) return null
  if (input.canPrompt) return 'prompt'
  return input.ios ? 'ios' : null
}

/** iPhone, iPod or iPad (an iPad reports itself as a Mac with a touch screen). */
export function isIosDevice(input: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  return /iPad|iPhone|iPod/.test(input.userAgent) || (input.platform === 'MacIntel' && input.maxTouchPoints > 1)
}

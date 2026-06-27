export type BrowserAutomationLink = {
  text: string
  href: string
}

export type BrowserAutomationResult = {
  success: boolean
  action: string
  currentUrl?: string
  title?: string
  visibleTextSnippet?: string
  links?: BrowserAutomationLink[]
  screenshotPath?: string
  error?: string
  needsConfirmation?: boolean
  durationMs: number
  lastAction?: string
}

export type BrowserAutomationState = {
  enabled: boolean
  launched: boolean
  browser: 'chromium' | 'chrome' | 'edge'
  profilePath: string
  headless: boolean
  currentUrl: string
  title: string
  lastAction: string
  lastError: string
  screenshotPath: string
  lastActionAt: string
}

export const launchBrowserAutomation = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:launch')

export const browserOpenUrl = async (url: string): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:open-url', { url })

export const browserSearchGoogle = async (query: string): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:search-google', query)

export const browserSearchYouTube = async (query: string): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:search-youtube', query)

export const browserOpenYouTubeResult = async (payload: {
  query?: string
  index?: number
  matchText?: string
}): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:open-youtube-result', payload)

export const browserOpenSearchResult = async (payload: {
  matchText?: string
  domainHint?: string
  index?: number
}): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:open-search-result', payload)

export const browserClickText = async (text: string): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:click-text', { text })

export const browserFillField = async (field: string, value: string): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:fill-field', { field, value })

export const browserScroll = async (
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount?: number
): Promise<BrowserAutomationResult> => window.electron.ipcRenderer.invoke('browser:scroll', { direction, amount })

export const browserBack = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:back')

export const browserForward = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:forward')

export const browserRefresh = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:refresh')

export const browserReadPage = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:read-page')

export const browserScreenshot = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:screenshot')

export const browserDownload = async (
  url: string,
  confirmed = false
): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:download', { url, confirmed })

export const browserCloseTab = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:close-tab')

export const browserClose = async (): Promise<BrowserAutomationResult> =>
  window.electron.ipcRenderer.invoke('browser:close-browser')

export const browserGetState = async (): Promise<{ success: boolean; state?: BrowserAutomationState; error?: string }> =>
  window.electron.ipcRenderer.invoke('browser:get-state')


import { app, IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

type PlaywrightBrowser = 'chromium' | 'chrome' | 'edge'
type PlaywrightSettings = {
  enabled: boolean
  browser: PlaywrightBrowser
  profilePath: string
  headless: boolean
  lastTestedAt?: string
  lastStatus?: string
}

type BrowserAutomationResult = {
  success: boolean
  action: string
  currentUrl?: string
  title?: string
  visibleTextSnippet?: string
  links?: Array<{ text: string; href: string }>
  screenshotPath?: string
  error?: string
  needsConfirmation?: boolean
  durationMs: number
  lastAction?: string
}

type BrowserAutomationState = {
  enabled: boolean
  launched: boolean
  browser: PlaywrightBrowser
  profilePath: string
  headless: boolean
  currentUrl: string
  title: string
  lastAction: string
  lastError: string
  screenshotPath: string
  lastActionAt: string
}

type RegisterPlaywrightBrowserOptions = {
  ipcMain: IpcMain
  readSecureVault: () => Record<string, any>
  writeSecureVault: (data: Record<string, any>) => void
  normalizePlaywrightSettings: (secureData: Record<string, any>) => PlaywrightSettings
}

const ensureDir = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true })
}

const browserCandidates: Record<PlaywrightBrowser, string[]> = {
  chromium: [
    path.join(process.env.ProgramFiles || '', 'Chromium', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Chromium', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ],
  chrome: [
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ],
  edge: [
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
}

const defaultProfilePath = () => path.join(app.getPath('userData'), 'playwright-profile')
const defaultScreenshotDir = () => path.join(app.getPath('userData'), 'browser-screenshots')
const defaultDownloadDir = () => path.join(app.getPath('downloads'), 'alpha-browser-downloads')

const visibleLinksScript = `() => {
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  return anchors
    .map((anchor) => {
      const text = (anchor.innerText || anchor.textContent || '').trim();
      const href = anchor.href || '';
      const rect = anchor.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      return { text, href, visible };
    })
    .filter((item) => item.visible && item.href)
    .slice(0, 60);
}`

const visibleTextScript = `() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const lines = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const style = window.getComputedStyle(parent);
    const rect = parent.getBoundingClientRect();
    const hidden = style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
    if (hidden) continue;
    lines.push(text);
    if (lines.length >= 160) break;
  }
  return lines.join('\\n');
}`

const initialState = (): BrowserAutomationState => ({
  enabled: false,
  launched: false,
  browser: 'chromium',
  profilePath: defaultProfilePath(),
  headless: false,
  currentUrl: '',
  title: '',
  lastAction: '',
  lastError: '',
  screenshotPath: '',
  lastActionAt: ''
})

class PlaywrightBrowserController {
  private context: BrowserContext | null = null
  private state: BrowserAutomationState = initialState()

  constructor(
    private readonly readSecureVault: () => Record<string, any>,
    private readonly writeSecureVault: (data: Record<string, any>) => void,
    private readonly normalizePlaywrightSettings: (secureData: Record<string, any>) => PlaywrightSettings
  ) {}

  private log(action: string, detail: string) {
    console.debug(`[BROWSER] action="${action}" ${detail}`)
  }

  private errorLog(action: string, reason: string) {
    console.debug(`[BROWSER_ERROR] action="${action}" reason="${reason}"`)
  }

  private getSettings() {
    const secureData = this.readSecureVault()
    const settings = this.normalizePlaywrightSettings(secureData)
    return { secureData, settings }
  }

  private resolveProfilePath(settings: PlaywrightSettings) {
    return settings.profilePath?.trim() ? path.resolve(settings.profilePath.trim()) : defaultProfilePath()
  }

  private resolveExecutable(browser: PlaywrightBrowser) {
    const found = browserCandidates[browser].find((candidate) => candidate && fs.existsSync(candidate))
    return found || ''
  }

  private updateState(partial: Partial<BrowserAutomationState>) {
    this.state = { ...this.state, ...partial }
  }

  private async getPage() {
    const context = await this.ensureContext()
    if (!context) return null
    let page = context.pages().find((item) => !item.isClosed()) || null
    if (!page) page = await context.newPage()
    await page.bringToFront().catch(() => undefined)
    return page
  }

  private async syncPageState(page: Page | null, action: string, screenshotPath = '', error = '') {
    if (!page) {
      this.updateState({
        lastAction: action,
        lastError: error,
        screenshotPath,
        lastActionAt: new Date().toISOString()
      })
      return
    }
    this.updateState({
      launched: true,
      currentUrl: page.url(),
      title: await page.title().catch(() => ''),
      lastAction: action,
      lastError: error,
      screenshotPath,
      lastActionAt: new Date().toISOString()
    })
  }

  private async visibleLinks(page: Page) {
    return (await page.evaluate(visibleLinksScript)) as Array<{ text: string; href: string }>
  }

  private async visibleText(page: Page) {
    const text = ((await page.evaluate(visibleTextScript)) as string) || ''
    return text.slice(0, 12000)
  }

  private async openResultBySearch(matchText?: string, domainHint?: string, index = 0): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    const page = await this.getPage()
    if (!page) {
      return { success: false, action: 'open_search_result', error: 'Browser not available.', durationMs: Date.now() - startedAt }
    }

    const links = await this.visibleLinks(page)
    const candidates = links.filter((link) => {
      if (!link.href) return false
      if (domainHint && !link.href.toLowerCase().includes(domainHint.toLowerCase())) return false
      if (matchText && !(link.text || link.href).toLowerCase().includes(matchText.toLowerCase())) return false
      return true
    })
    const target = candidates[index] || links[index]
    if (!target?.href) {
      return {
        success: false,
        action: 'open_search_result',
        error: 'Matching result visible nahi mila.',
        durationMs: Date.now() - startedAt
      }
    }

    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await this.syncPageState(page, 'open_search_result')
    return {
      success: true,
      action: 'open_search_result',
      currentUrl: page.url(),
      title: await page.title().catch(() => ''),
      links,
      durationMs: Date.now() - startedAt,
      lastAction: `Opened result: ${target.text || target.href}`
    }
  }

  async testLaunch() {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) {
        return { success: false, error: 'Playwright browser launch failed.' }
      }
      await this.closeBrowser()
      this.log('launch', `browser="${this.state.browser}" durationMs=${Date.now() - startedAt}`)
      return { success: true, message: `${this.state.browser} automation profile is ready.` }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Playwright browser launch failed.' }
    }
  }

  async clearProfile() {
    const { secureData, settings } = this.getSettings()
    const profilePath = this.resolveProfilePath(settings)
    await this.closeBrowser()
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, { recursive: true, force: true })
    }
    secureData.playwrightSettings = {
      ...settings,
      profilePath: '',
      lastStatus: 'profile-cleared',
      lastTestedAt: new Date().toISOString()
    }
    this.writeSecureVault(secureData)
    this.state = initialState()
    return { success: true, settings: secureData.playwrightSettings }
  }

  private async ensureContext() {
    const { settings } = this.getSettings()
    const profilePath = this.resolveProfilePath(settings)

    this.updateState({
      enabled: settings.enabled,
      browser: settings.browser,
      profilePath,
      headless: settings.headless
    })

    if (!settings.enabled) {
      throw new Error('Playwright disabled hai. Settings me enable karo.')
    }

    if (this.context) return this.context

    const executablePath = this.resolveExecutable(settings.browser)
    if (!executablePath) {
      throw new Error(`${settings.browser} browser executable nahi mila.`)
    }

    ensureDir(profilePath)
    ensureDir(defaultDownloadDir())

    this.context = await chromium.launchPersistentContext(profilePath, {
      executablePath,
      headless: settings.headless,
      acceptDownloads: true,
      downloadsPath: defaultDownloadDir(),
      viewport: null,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-default-browser-check',
        '--disable-features=Translate'
      ]
    })

    this.context.on('page', async (page) => {
      await page.bringToFront().catch(() => undefined)
      page.on('framenavigated', async (frame) => {
        if (page.mainFrame() === frame) {
          await this.syncPageState(page, 'navigate')
        }
      })
      page.on('close', async () => {
        const pages = this.context?.pages().filter((item) => !item.isClosed()) || []
        if (!pages.length) {
          this.updateState({ currentUrl: '', title: '' })
        }
      })
    })

    this.updateState({
      launched: true,
      lastAction: 'launch',
      lastError: '',
      lastActionAt: new Date().toISOString()
    })

    return this.context
  }

  async closeBrowser() {
    const startedAt = Date.now()
    if (this.context) {
      await this.context.close().catch(() => undefined)
      this.context = null
    }
    this.state = {
      ...this.state,
      launched: false,
      currentUrl: '',
      title: '',
      lastAction: 'close-browser',
      lastActionAt: new Date().toISOString()
    }
    this.log('close_browser', `durationMs=${Date.now() - startedAt}`)
    return { success: true, action: 'close_browser', durationMs: Date.now() - startedAt }
  }

  async launchBrowser(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      await this.syncPageState(page, 'launch')
      this.log('launch', `browser="${this.state.browser}" durationMs=${Date.now() - startedAt}`)
      return {
        success: true,
        action: 'launch',
        currentUrl: page?.url(),
        title: page ? await page.title().catch(() => '') : '',
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      this.updateState({ lastError: error?.message || 'Launch failed.' })
      this.errorLog('launch', error?.message || 'launch_failed')
      return { success: false, action: 'launch', error: error?.message || 'Launch failed.', durationMs: Date.now() - startedAt }
    }
  }

  async openUrl(url: string): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
      await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.syncPageState(page, 'open-url')
      this.log('open_url', `url="${finalUrl}" success=true durationMs=${Date.now() - startedAt}`)
      return {
        success: true,
        action: 'open_url',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      this.updateState({ lastError: error?.message || 'Open URL failed.' })
      this.errorLog('open_url', error?.message || 'open_url_failed')
      return { success: false, action: 'open_url', error: error?.message || 'Open URL failed.', durationMs: Date.now() - startedAt }
    }
  }

  async searchGoogle(query: string): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    const result = await this.openUrl(url)
    if (result.success) {
      const page = await this.getPage()
      const links = page ? await this.visibleLinks(page) : []
      this.log('search_google', `query="${query}" durationMs=${Date.now() - startedAt}`)
      return { ...result, action: 'search_google', links, lastAction: `Google search: ${query}` }
    }
    return { ...result, action: 'search_google' }
  }

  async searchYouTube(query: string): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    const result = await this.openUrl(url)
    if (result.success) {
      const page = await this.getPage()
      const links = page ? await this.visibleLinks(page) : []
      this.log('youtube_search', `query="${query}" durationMs=${Date.now() - startedAt}`)
      return { ...result, action: 'search_youtube', links, lastAction: `YouTube search: ${query}` }
    }
    return { ...result, action: 'search_youtube' }
  }

  async openYouTubeResult(payload: { query?: string; index?: number; matchText?: string }): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      if (payload.query?.trim()) {
        await this.searchYouTube(payload.query.trim())
      }
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const cards = page.locator('a#video-title')
      const count = await cards.count()
      if (!count) throw new Error('YouTube results visible nahi mile.')

      let targetIndex = Math.max(0, payload.index || 0)
      if (payload.matchText?.trim()) {
        const lowerMatch = payload.matchText.toLowerCase()
        for (let i = 0; i < count; i += 1) {
          const text = ((await cards.nth(i).textContent()) || '').toLowerCase()
          if (text.includes(lowerMatch)) {
            targetIndex = i
            break
          }
        }
      }

      const target = cards.nth(targetIndex)
      const title = ((await target.textContent()) || '').trim()
      await target.click({ timeout: 10000 })
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined)
      await this.syncPageState(page, 'open-youtube-result')
      this.log('click_first_video', `title="${title}" durationMs=${Date.now() - startedAt}`)
      return {
        success: true,
        action: 'open_youtube_result',
        currentUrl: page.url(),
        title: await page.title().catch(() => title),
        durationMs: Date.now() - startedAt,
        lastAction: `Opened video: ${title}`
      }
    } catch (error: any) {
      this.updateState({ lastError: error?.message || 'YouTube result open failed.' })
      this.errorLog('open_youtube_result', error?.message || 'youtube_result_failed')
      return {
        success: false,
        action: 'open_youtube_result',
        error: error?.message || 'YouTube result open failed.',
        durationMs: Date.now() - startedAt
      }
    }
  }

  async clickText(text: string): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const locator = page.getByText(text, { exact: false }).first()
      await locator.waitFor({ state: 'visible', timeout: 7000 })
      await locator.click({ timeout: 7000 })
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
      await this.syncPageState(page, 'click-text')
      this.log('click_text', `text="${text}" success=true durationMs=${Date.now() - startedAt}`)
      return {
        success: true,
        action: 'click_text',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        durationMs: Date.now() - startedAt,
        lastAction: `Clicked text: ${text}`
      }
    } catch (error: any) {
      this.updateState({ lastError: error?.message || 'Button visible nahi mila.' })
      this.errorLog('click', error?.message || 'selector_not_found')
      return { success: false, action: 'click_text', error: error?.message || 'Button visible nahi mila.', durationMs: Date.now() - startedAt }
    }
  }

  async fillField(field: string, value: string): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const candidates = [
        page.getByLabel(field, { exact: false }).first(),
        page.getByPlaceholder(field, { exact: false }).first(),
        page.locator(`input[name*="${field}" i], textarea[name*="${field}" i], input[id*="${field}" i], textarea[id*="${field}" i]`).first()
      ]

      let filled = false
      for (const locator of candidates) {
        try {
          await locator.waitFor({ state: 'visible', timeout: 2000 })
          await locator.fill(value, { timeout: 5000 })
          filled = true
          break
        } catch {}
      }
      if (!filled) throw new Error(`Field "${field}" visible nahi mila.`)

      await this.syncPageState(page, 'fill-field')
      this.log('fill_field', `field="${field}" durationMs=${Date.now() - startedAt}`)
      return {
        success: true,
        action: 'fill_field',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        durationMs: Date.now() - startedAt,
        lastAction: `Filled ${field}`
      }
    } catch (error: any) {
      this.updateState({ lastError: error?.message || 'Field fill failed.' })
      this.errorLog('fill_field', error?.message || 'field_not_found')
      return { success: false, action: 'fill_field', error: error?.message || 'Field fill failed.', durationMs: Date.now() - startedAt }
    }
  }

  async scroll(direction: 'up' | 'down' | 'top' | 'bottom', amount = 900): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      if (direction === 'top') await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      else if (direction === 'bottom') await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
      else await page.evaluate(([dir, px]) => window.scrollBy({ top: dir === 'down' ? px : -px, behavior: 'smooth' }), [direction, amount] as const)

      await this.syncPageState(page, 'scroll')
      return {
        success: true,
        action: 'scroll',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        durationMs: Date.now() - startedAt,
        lastAction: `Scrolled ${direction}`
      }
    } catch (error: any) {
      this.errorLog('scroll', error?.message || 'scroll_failed')
      return { success: false, action: 'scroll', error: error?.message || 'Scroll failed.', durationMs: Date.now() - startedAt }
    }
  }

  async back(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined)
      await this.syncPageState(page, 'back')
      return { success: true, action: 'back', currentUrl: page.url(), title: await page.title().catch(() => ''), durationMs: Date.now() - startedAt }
    } catch (error: any) {
      return { success: false, action: 'back', error: error?.message || 'Back action failed.', durationMs: Date.now() - startedAt }
    }
  }

  async forward(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined)
      await this.syncPageState(page, 'forward')
      return { success: true, action: 'forward', currentUrl: page.url(), title: await page.title().catch(() => ''), durationMs: Date.now() - startedAt }
    } catch (error: any) {
      return { success: false, action: 'forward', error: error?.message || 'Forward action failed.', durationMs: Date.now() - startedAt }
    }
  }

  async refresh(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.syncPageState(page, 'refresh')
      return { success: true, action: 'refresh', currentUrl: page.url(), title: await page.title().catch(() => ''), durationMs: Date.now() - startedAt }
    } catch (error: any) {
      return { success: false, action: 'refresh', error: error?.message || 'Refresh failed.', durationMs: Date.now() - startedAt }
    }
  }

  async closeTab(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      await page.close()
      const nextPage = await this.getPage()
      await this.syncPageState(nextPage, 'close-tab')
      return {
        success: true,
        action: 'close_tab',
        currentUrl: nextPage?.url() || '',
        title: nextPage ? await nextPage.title().catch(() => '') : '',
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      return { success: false, action: 'close_tab', error: error?.message || 'Tab close failed.', durationMs: Date.now() - startedAt }
    }
  }

  async readPage(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const visibleTextSnippet = await this.visibleText(page)
      const links = await this.visibleLinks(page)
      await this.syncPageState(page, 'read-page')
      this.log('read_page', `chars=${visibleTextSnippet.length}`)
      return {
        success: true,
        action: 'read_page',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        visibleTextSnippet,
        links,
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      this.errorLog('read_page', error?.message || 'read_failed')
      return { success: false, action: 'read_page', error: error?.message || 'Read page failed.', durationMs: Date.now() - startedAt }
    }
  }

  async screenshot(): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      const dir = defaultScreenshotDir()
      ensureDir(dir)
      const screenshotPath = path.join(dir, `browser-shot-${Date.now()}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await this.syncPageState(page, 'screenshot', screenshotPath)
      return {
        success: true,
        action: 'screenshot',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        screenshotPath,
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      this.errorLog('screenshot', error?.message || 'screenshot_failed')
      return { success: false, action: 'screenshot', error: error?.message || 'Screenshot failed.', durationMs: Date.now() - startedAt }
    }
  }

  async download(url = '', confirmed = false): Promise<BrowserAutomationResult> {
    const startedAt = Date.now()
    if (!confirmed) {
      return {
        success: false,
        action: 'download',
        needsConfirmation: true,
        error: 'Download start karne se pehle confirmation chahiye.',
        durationMs: Date.now() - startedAt
      }
    }

    try {
      const page = await this.getPage()
      if (!page) throw new Error('Browser page unavailable.')
      if (!url.trim()) throw new Error('Download URL missing hai.')
      const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 })
      await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const download = await downloadPromise
      const downloadPath = path.join(defaultDownloadDir(), download.suggestedFilename())
      await download.saveAs(downloadPath)
      await this.syncPageState(page, 'download', downloadPath)
      return {
        success: true,
        action: 'download',
        currentUrl: page.url(),
        title: await page.title().catch(() => ''),
        screenshotPath: downloadPath,
        durationMs: Date.now() - startedAt
      }
    } catch (error: any) {
      this.errorLog('download', error?.message || 'download_failed')
      return { success: false, action: 'download', error: error?.message || 'Download failed.', durationMs: Date.now() - startedAt }
    }
  }

  getState() {
    return {
      success: true,
      state: this.state
    }
  }

  async openSearchResult(payload: { matchText?: string; domainHint?: string; index?: number }) {
    return this.openResultBySearch(payload.matchText, payload.domainHint, payload.index || 0)
  }
}

export default function registerPlaywrightBrowser(options: RegisterPlaywrightBrowserOptions) {
  const controller = new PlaywrightBrowserController(
    options.readSecureVault,
    options.writeSecureVault,
    options.normalizePlaywrightSettings
  )

  const syncSettingsState = () => {
    const secureData = options.readSecureVault()
    const settings = options.normalizePlaywrightSettings(secureData)
    return { secureData, settings }
  }

  ;[
    'playwright-settings-get',
    'playwright-settings-save',
    'playwright-settings-clear-profile',
    'playwright-settings-test-launch',
    'browser:launch',
    'browser:open-url',
    'browser:new-tab',
    'browser:search-google',
    'browser:search-youtube',
    'browser:open-youtube-result',
    'browser:open-search-result',
    'browser:click-text',
    'browser:fill-field',
    'browser:scroll',
    'browser:back',
    'browser:forward',
    'browser:refresh',
    'browser:read-page',
    'browser:screenshot',
    'browser:download',
    'browser:close-tab',
    'browser:close-browser',
    'browser:get-state'
  ].forEach((channel) => options.ipcMain.removeHandler(channel))

  options.ipcMain.handle('playwright-settings-get', async () => {
    const { settings } = syncSettingsState()
    return { success: true, settings }
  })

  options.ipcMain.handle('playwright-settings-save', async (_, settings) => {
    try {
      const { secureData } = syncSettingsState()
      secureData.playwrightSettings = {
        ...options.normalizePlaywrightSettings(secureData),
        enabled: Boolean(settings?.enabled),
        browser: ['chromium', 'chrome', 'edge'].includes(settings?.browser) ? settings.browser : 'chromium',
        profilePath: typeof settings?.profilePath === 'string' ? settings.profilePath : '',
        headless: Boolean(settings?.headless)
      }
      options.writeSecureVault(secureData)
      return { success: true, settings: secureData.playwrightSettings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  options.ipcMain.handle('playwright-settings-clear-profile', async () => {
    try {
      return controller.clearProfile()
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  options.ipcMain.handle('playwright-settings-test-launch', async () => {
    try {
      const { secureData, settings } = syncSettingsState()
      const result = await controller.testLaunch()
      settings.lastTestedAt = new Date().toISOString()
      settings.lastStatus = result.success ? 'ready' : 'error'
      secureData.playwrightSettings = settings
      options.writeSecureVault(secureData)
      return { success: result.success, settings, message: result.success ? result.message : undefined, error: result.error }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  options.ipcMain.handle('browser:launch', async () => controller.launchBrowser())
  options.ipcMain.handle('browser:open-url', async (_, payload) => controller.openUrl(typeof payload === 'string' ? payload : payload?.url || ''))
  options.ipcMain.handle('browser:new-tab', async (_, payload) => {
    const result = await controller.launchBrowser()
    if (!result.success) return result
    if (payload?.url) return controller.openUrl(payload.url)
    return result
  })
  options.ipcMain.handle('browser:search-google', async (_, query: string) => controller.searchGoogle(query))
  options.ipcMain.handle('browser:search-youtube', async (_, query: string) => controller.searchYouTube(query))
  options.ipcMain.handle('browser:open-youtube-result', async (_, payload) => controller.openYouTubeResult(payload || {}))
  options.ipcMain.handle('browser:open-search-result', async (_, payload) => controller.openSearchResult(payload || {}))
  options.ipcMain.handle('browser:click-text', async (_, payload) => controller.clickText(typeof payload === 'string' ? payload : payload?.text || ''))
  options.ipcMain.handle('browser:fill-field', async (_, payload) => controller.fillField(payload?.field || '', payload?.value || ''))
  options.ipcMain.handle('browser:scroll', async (_, payload) => controller.scroll(payload?.direction || 'down', payload?.amount || 900))
  options.ipcMain.handle('browser:back', async () => controller.back())
  options.ipcMain.handle('browser:forward', async () => controller.forward())
  options.ipcMain.handle('browser:refresh', async () => controller.refresh())
  options.ipcMain.handle('browser:read-page', async () => controller.readPage())
  options.ipcMain.handle('browser:screenshot', async () => controller.screenshot())
  options.ipcMain.handle('browser:download', async (_, payload) => controller.download(payload?.url || '', Boolean(payload?.confirmed)))
  options.ipcMain.handle('browser:close-tab', async () => controller.closeTab())
  options.ipcMain.handle('browser:close-browser', async () => controller.closeBrowser())
  options.ipcMain.handle('browser:get-state', async () => controller.getState())
}

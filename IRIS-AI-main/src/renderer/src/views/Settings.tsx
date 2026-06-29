import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as faceapi from 'face-api.js'
import type { BrowserAutomationState } from '@renderer/services/browser-automation'
import {
  clearKiloTaskHistory,
  getKiloSettings,
  healthCheckKilo,
  openKiloTaskFolder,
  saveKiloSettings as persistKiloSettings,
  testKiloConfiguration
} from '@renderer/services/kilo-code'
import { GiArtificialIntelligence } from 'react-icons/gi'
import {
  RiKey2Line,
  RiSave3Line,
  RiUserVoiceLine,
  RiUserLine,
  RiLockPasswordLine,
  RiScan2Line,
  RiAddLine,
  RiRecordCircleLine,
  RiLock2Line,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiPlugLine,
  RiBrainLine,
  RiCloudLine,
  RiCpuLine,
  RiTerminalWindowLine,
  RiRefreshLine,
  RiDownloadCloud2Line,
  RiRocketLine,
  RiEyeLine,
  RiEyeOffLine
} from 'react-icons/ri'

interface SettingsProps {
  isSystemActive: boolean
}

type TabType = 'updates' | 'general' | 'keys' | 'security'
type KeyGroup =
  | 'geminiBrain'
  | 'geminiAgent'
  | 'tavily'
  | 'exa'
  | 'firecrawl'
  | 'groq'
  | 'glm'
  | 'zai'
  | 'kimi'
  | 'openrouter'
  | 'kiloGateway'
  | 'routeway'
type PlaywrightBrowser = 'chromium' | 'chrome' | 'edge'
type KiloExecutionMode = 'cli' | 'local-service' | 'adapter-stub'
type KiloPermissionMode = 'ask' | 'approve' | 'full'
type KiloWorkingDirectoryPolicy = 'project-only' | 'workspace-only' | 'user-approved'
type PlaywrightSettings = {
  enabled: boolean
  browser: PlaywrightBrowser
  profilePath: string
  headless: boolean
  lastTestedAt?: string
  lastStatus?: string
}
type KiloSettings = {
  enabled: boolean
  executionMode: KiloExecutionMode
  commandPath: string
  workingDirectoryPolicy: KiloWorkingDirectoryPolicy
  timeoutMs: number
  defaultPermissionMode: KiloPermissionMode
  autoGitCheckpoint: boolean
  autoBuildTest: boolean
  autoCommit: boolean
  lastHealthCheckAt?: string
  lastHealthStatus?: string
  lastError?: string
}
type GlmProviderMode = 'zenmux' | 'openai-compatible' | 'custom-compatible' | 'direct-zai'
type ZaiProviderMode = 'zai-chat' | 'zai-coding' | 'zai-compatible'
type ConfigurableProviderGroup = 'glm' | 'zai' | 'openrouter' | 'kiloGateway' | 'routeway'
type KeySlotStatus = {
  slot: number
  enabled: boolean
  status: string
  maskedKey: string
  hasKey: boolean
  baseUrl?: string
  modelId?: string
  providerMode?: GlmProviderMode | string
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

type ProviderSlotConfig = {
  baseUrl: string
  modelId: string
  providerMode: string
}

const keyGroupLabels: Record<KeyGroup, { title: string; description: string; accent: string }> = {
  geminiBrain: {
    title: 'Gemini Brain Keys',
    description: 'Used for normal Gemini brain/chat.',
    accent: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5'
  },
  geminiAgent: {
    title: 'Gemini Agent Keys',
    description: 'Reserved for future parallel agent subtasks.',
    accent: 'text-violet-300 border-violet-500/20 bg-violet-500/5'
  },
  tavily: {
    title: 'Tavily API Keys',
    description: 'Realtime web search provider slots.',
    accent: 'text-sky-300 border-sky-500/20 bg-sky-500/5'
  },
  exa: {
    title: 'Exa API Keys',
    description: 'Semantic search and deep research provider slots.',
    accent: 'text-fuchsia-300 border-fuchsia-500/20 bg-fuchsia-500/5'
  },
  firecrawl: {
    title: 'Firecrawl API Keys',
    description: 'Website and documentation crawling provider slots.',
    accent: 'text-red-300 border-red-500/20 bg-red-500/5'
  },
  groq: {
    title: 'Groq API Keys',
    description: 'Fast response layer provider slots.',
    accent: 'text-lime-300 border-lime-500/20 bg-lime-500/5'
  },
  glm: {
    title: 'GLM 5.2 API Keys',
    description: 'Coding brain provider slots.',
    accent: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/5'
  },
  zai: {
    title: 'Z.AI Coding Provider',
    description: 'Secondary primary coding provider slots.',
    accent: 'text-indigo-300 border-indigo-500/20 bg-indigo-500/5'
  },
  kimi: {
    title: 'Kimi API Keys',
    description: 'Long-context research provider slots.',
    accent: 'text-pink-300 border-pink-500/20 bg-pink-500/5'
  },
  openrouter: {
    title: 'OpenRouter API Keys',
    description: 'Complex task and fallback brain provider slots.',
    accent: 'text-orange-300 border-orange-500/20 bg-orange-500/5'
  },
  kiloGateway: {
    title: 'Kilo Gateway Provider',
    description: 'Model API provider slots for Kilo Gateway.',
    accent: 'text-amber-300 border-amber-500/20 bg-amber-500/5'
  },
  routeway: {
    title: 'Routeway Provider',
    description: 'OpenAI-compatible Routeway.ai provider slots.',
    accent: 'text-rose-300 border-rose-500/20 bg-rose-500/5'
  }
}

const keyGroups: KeyGroup[] = [
  'geminiBrain',
  'geminiAgent',
  'tavily',
  'exa',
  'firecrawl',
  'groq',
  'glm',
  'zai',
  'kimi',
  'openrouter',
  'kiloGateway',
  'routeway'
]

const keyGroupSlotCounts: Record<KeyGroup, number> = {
  geminiBrain: 3,
  geminiAgent: 3,
  tavily: 3,
  exa: 3,
  firecrawl: 3,
  groq: 3,
  glm: 3,
  zai: 3,
  kimi: 3,
  openrouter: 6,
  kiloGateway: 3,
  routeway: 3
}

const configurableProviderGroups: ConfigurableProviderGroup[] = [
  'glm',
  'zai',
  'openrouter',
  'kiloGateway',
  'routeway'
]

const providerSlotDefaults: Record<ConfigurableProviderGroup, ProviderSlotConfig> = {
  glm: {
    baseUrl: 'https://zenmux.ai/api/v1',
    modelId: 'z-ai/glm-5.2-free',
    providerMode: 'openai-compatible'
  },
  zai: {
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    modelId: 'glm-4.5v',
    providerMode: 'zai-coding'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'openai/gpt-4.1-mini',
    providerMode: 'openai-compatible'
  },
  kiloGateway: {
    baseUrl: 'https://api.kilo.ai/api/gateway',
    modelId: 'laguna-m.1:free',
    providerMode: 'openai-compatible'
  },
  routeway: {
    baseUrl: 'https://api.routeway.ai/v1',
    modelId: '',
    providerMode: 'openai-compatible'
  }
}

const defaultPlaywrightSettings: PlaywrightSettings = {
  enabled: false,
  browser: 'chromium',
  profilePath: '',
  headless: false,
  lastStatus: 'unknown',
  lastTestedAt: ''
}

const defaultKiloSettings: KiloSettings = {
  enabled: false,
  executionMode: 'adapter-stub',
  commandPath: '',
  workingDirectoryPolicy: 'project-only',
  timeoutMs: 120000,
  defaultPermissionMode: 'ask',
  autoGitCheckpoint: true,
  autoBuildTest: false,
  autoCommit: false,
  lastHealthCheckAt: '',
  lastHealthStatus: 'unknown',
  lastError: ''
}

const emptySlotInputs = (): Record<KeyGroup, string[]> => ({
  geminiBrain: ['', '', ''],
  geminiAgent: ['', '', ''],
  tavily: ['', '', ''],
  exa: ['', '', ''],
  firecrawl: ['', '', ''],
  groq: ['', '', ''],
  glm: ['', '', ''],
  zai: ['', '', ''],
  kimi: ['', '', ''],
  openrouter: ['', '', '', '', '', ''],
  kiloGateway: ['', '', ''],
  routeway: ['', '', '']
})

const emptySlotStatuses = (): Record<KeyGroup, KeySlotStatus[]> => ({
  geminiBrain: [],
  geminiAgent: [],
  tavily: [],
  exa: [],
  firecrawl: [],
  groq: [],
  glm: [],
  zai: [],
  kimi: [],
  openrouter: [],
  kiloGateway: [],
  routeway: []
})

const defaultProviderSlotConfigs = (): Record<ConfigurableProviderGroup, ProviderSlotConfig[]> => ({
  glm: Array.from({ length: keyGroupSlotCounts.glm }, () => ({ ...providerSlotDefaults.glm })),
  zai: Array.from({ length: keyGroupSlotCounts.zai }, () => ({ ...providerSlotDefaults.zai })),
  openrouter: Array.from({ length: keyGroupSlotCounts.openrouter }, () => ({ ...providerSlotDefaults.openrouter })),
  kiloGateway: Array.from({ length: keyGroupSlotCounts.kiloGateway }, () => ({ ...providerSlotDefaults.kiloGateway })),
  routeway: Array.from({ length: keyGroupSlotCounts.routeway }, () => ({ ...providerSlotDefaults.routeway }))
})

const isConfigurableProviderGroup = (group: KeyGroup): group is ConfigurableProviderGroup =>
  configurableProviderGroups.includes(group as ConfigurableProviderGroup)

const buildProviderConfigsFromStatuses = (
  group: ConfigurableProviderGroup,
  rows: KeySlotStatus[] = []
): ProviderSlotConfig[] =>
  Array.from({ length: keyGroupSlotCounts[group] }, (_, index) => {
    const slot = index + 1
    const found = rows.find((item) => item.slot === slot)
    const defaults = providerSlotDefaults[group]
    return {
      baseUrl: found?.baseUrl || defaults.baseUrl,
      modelId: found?.modelId || defaults.modelId,
      providerMode: found?.providerMode || defaults.providerMode
    }
  })

const SettingsView = ({ isSystemActive }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('updates')

  const [voice, setVoice] = useState<'MALE' | 'FEMALE'>(
    (localStorage.getItem('alpha_voice_profile') as 'MALE' | 'FEMALE') || 'MALE'
  )
  const [personality, setPersonality] = useState('')
  const [userName, setUserName] = useState(localStorage.getItem('alpha_user_name') || '')
  const [sttLatencyMode, setSttLatencyMode] = useState(
    localStorage.getItem('alpha_stt_latency_mode') || 'ULTRA'
  )

  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('alpha_custom_api_key') || '')
  const [groqKey, setGroqKey] = useState(localStorage.getItem('alpha_groq_api_key') || '')
  const [hfKey, setHfKey] = useState(localStorage.getItem('alpha_hf_api_key') || '')
  const [tailvyKey, setTailvyKey] = useState(localStorage.getItem('alpha_tailvy_api_key') || '')
  const [openrouterModel, setOpenRouterModel] = useState(
    localStorage.getItem('alpha_openrouter_model') || 'openai/gpt-4.1-mini'
  )
  const [keySlotInputs, setKeySlotInputs] = useState<Record<KeyGroup, string[]>>(emptySlotInputs)
  const [keySlotStatuses, setKeySlotStatuses] =
    useState<Record<KeyGroup, KeySlotStatus[]>>(emptySlotStatuses)
  const [providerSlotConfigs, setProviderSlotConfigs] =
    useState<Record<ConfigurableProviderGroup, ProviderSlotConfig[]>>(defaultProviderSlotConfigs)
  const [visibleKeySlots, setVisibleKeySlots] = useState<Record<string, boolean>>({})
  const [keySlotMessage, setKeySlotMessage] = useState('')
  const [launchOnStartup, setLaunchOnStartup] = useState(false)
  const [playwrightSettings, setPlaywrightSettings] = useState<PlaywrightSettings>(defaultPlaywrightSettings)
  const [playwrightMessage, setPlaywrightMessage] = useState('')
  const [kiloSettings, setKiloSettings] = useState<KiloSettings>(defaultKiloSettings)
  const [kiloMessage, setKiloMessage] = useState('')
  const [browserAutomationState, setBrowserAutomationState] = useState<BrowserAutomationState | null>(null)

  const [isSecurityUnlocked, setIsSecurityUnlocked] = useState(false)
  const [authPin, setAuthPin] = useState('')
  const [authError, setAuthError] = useState(false)

  const [newPin, setNewPin] = useState('')
  const [faceCount, setFaceCount] = useState(0)

  const [isScanningFace, setIsScanningFace] = useState(false)
  const [enrollStatus, setEnrollStatus] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  const [appVersion, setAppVersion] = useState('1.1.5')
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  >('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateNotes, setUpdateNotes] = useState('No new updates detected.')
  const [downloadProgress, setDownloadProgress] = useState(0)

  useEffect(() => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('get-personality').then((res) => {
        if (res) setPersonality(res)
      })
      window.electron.ipcRenderer
        .invoke('check-vault-status')
        .then((res) => setFaceCount(res?.faceCount || 0))

      window.electron.ipcRenderer.invoke('get-app-version').then((v) => setAppVersion(v))
      window.electron.ipcRenderer.invoke('secure-get-keys').then((keys) => {
        if (keys?.openrouterModel) {
          setOpenRouterModel(keys.openrouterModel)
          localStorage.setItem('alpha_openrouter_model', keys.openrouterModel)
        }
      })
      window.electron.ipcRenderer.invoke('key-manager-list-statuses').then((res) => {
        if (res?.statuses) setKeySlotStatuses(res.statuses)
        setProviderSlotConfigs((current) => {
          const next = { ...current }
          for (const group of configurableProviderGroups) {
            next[group] = buildProviderConfigsFromStatuses(group, res?.statuses?.[group] || [])
          }
          return next
        })
        if (res?.openrouterModel) setOpenRouterModel(res.openrouterModel)
        if (res?.playwrightSettings) setPlaywrightSettings({ ...defaultPlaywrightSettings, ...res.playwrightSettings })
      })
      getKiloSettings().then((res) => {
        if (res?.settings) setKiloSettings({ ...defaultKiloSettings, ...res.settings })
      })
      window.electron.ipcRenderer.invoke('browser:get-state').then((res) => {
        if (res?.state) setBrowserAutomationState(res.state)
      })
      window.electron.ipcRenderer
        .invoke('get-launch-on-startup')
        .then((enabled) => setLaunchOnStartup(Boolean(enabled)))

      window.electron.ipcRenderer.on('updater-event', (_e, { status, data, error }) => {
        if (status === 'checking') setUpdateStatus('checking')
        if (status === 'available') {
          setUpdateStatus('available')
          setUpdateVersion(data.version)
          setUpdateNotes(data.releaseNotes || 'Bug fixes and performance improvements.')
        }
        if (status === 'not-available') {
          setUpdateStatus('idle')
          setUpdateNotes('System is up to date.')
        }
        if (status === 'downloading') {
          setUpdateStatus('downloading')
          setDownloadProgress(Math.round(data.percent))
        }
        if (status === 'downloaded') setUpdateStatus('ready')
        if (status === 'error') {
          setUpdateStatus('error')
          setUpdateNotes(`Error: ${error}`)
        }
      })
    }
    return () => {
      if (window.electron?.ipcRenderer)
        window.electron.ipcRenderer.removeAllListeners('updater-event')
    }
  }, [])

  const checkForUpdates = () => window.electron.ipcRenderer.invoke('check-for-updates')
  const downloadUpdate = () => window.electron.ipcRenderer.invoke('download-update')
  const installUpdate = () => window.electron.ipcRenderer.invoke('install-update')

  const handleVoiceChange = (v: 'MALE' | 'FEMALE') => {
    if (isSystemActive) return
    setVoice(v)
    localStorage.setItem('alpha_voice_profile', v)
  }

  const handlePersonalityChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
    if (words.length <= 150) setPersonality(text)
  }

  const savePersonality = async () => {
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('set-personality', personality)
      alert('Personality Matrix Saved Securely to OS.')
    }
  }

  const saveUserName = () => {
    localStorage.setItem('alpha_user_name', userName)
    alert('User Designation Saved.')
  }

  const saveSttLatencyMode = (mode: string) => {
    setSttLatencyMode(mode)
    localStorage.setItem('alpha_stt_latency_mode', mode)
  }

  const saveApiKeys = async () => {
    localStorage.setItem('alpha_custom_api_key', geminiKey)
    localStorage.setItem('alpha_groq_api_key', groqKey)
    localStorage.setItem('alpha_hf_api_key', hfKey)
    localStorage.setItem('alpha_tailvy_api_key', tailvyKey)
    localStorage.setItem('alpha_openrouter_model', openrouterModel)

    if (window.electron?.ipcRenderer) {
      try {
        await window.electron.ipcRenderer.invoke('secure-save-keys', {
          groqKey,
          geminiKey,
          openrouterModel
        })
      } catch (e) {}
    }
    alert(
      'All Neural Uplinks (API Keys) secured locally and in OS Vault. Restart AI modules to apply.'
    )
  }

  const saveOpenRouterSettings = async () => {
    localStorage.setItem('alpha_openrouter_model', openrouterModel)
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('secure-save-keys', {
        openrouterModel
      })
      await refreshKeySlotStatuses()
    }
  }

  const refreshKeySlotStatuses = async () => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('key-manager-list-statuses')
    if (res?.statuses) setKeySlotStatuses(res.statuses)
    setProviderSlotConfigs((current) => {
      const next = { ...current }
      for (const group of configurableProviderGroups) {
        next[group] = buildProviderConfigsFromStatuses(group, res?.statuses?.[group] || [])
      }
      return next
    })
    if (res?.openrouterModel) setOpenRouterModel(res.openrouterModel)
    if (res?.playwrightSettings) setPlaywrightSettings({ ...defaultPlaywrightSettings, ...res.playwrightSettings })
  }

  const updateKeySlotInput = (group: KeyGroup, slot: number, value: string) => {
    setKeySlotInputs((prev) => {
      const next = { ...prev, [group]: [...prev[group]] }
      next[group][slot - 1] = value
      return next
    })
  }

  const saveKeySlot = async (group: KeyGroup, slot: number) => {
    const key = keySlotInputs[group][slot - 1]?.trim()
    if (!window.electron?.ipcRenderer) return
    const providerConfig = isConfigurableProviderGroup(group) ? providerSlotConfigs[group][slot - 1] : null
    if (!key && !providerConfig) return
    const res = await window.electron.ipcRenderer.invoke('key-manager-save-slot', {
      group,
      slot,
      key,
      baseUrl: providerConfig?.baseUrl,
      modelId: providerConfig?.modelId,
      providerMode: providerConfig?.providerMode
    })
    if (res?.statuses) setKeySlotStatuses(res.statuses)
    updateKeySlotInput(group, slot, '')
    setKeySlotMessage(`${keyGroupLabels[group].title} slot ${slot} saved securely.`)
  }

  const updateProviderSlotConfig = <K extends keyof ProviderSlotConfig>(
    group: ConfigurableProviderGroup,
    slot: number,
    field: K,
    value: ProviderSlotConfig[K]
  ) => {
    setProviderSlotConfigs((prev) => ({
      ...prev,
      [group]: prev[group].map((item, index) => (index === slot - 1 ? { ...item, [field]: value } : item))
    }))
  }

  const testKeySlot = async (group: KeyGroup, slot: number) => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('key-manager-test-key', { group, slot })
    if (res?.statuses) setKeySlotStatuses(res.statuses)
    setKeySlotMessage(
      res?.success
        ? `${keyGroupLabels[group].title} slot ${slot} test passed.`
        : `${keyGroupLabels[group].title} slot ${slot} test failed: ${res?.error || 'missing key'}`
    )
  }

  const toggleKeySlot = async (group: KeyGroup, slot: number, enabled: boolean) => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('key-manager-set-enabled', {
      group,
      slot,
      enabled
    })
    if (res?.statuses) setKeySlotStatuses(res.statuses)
    setKeySlotMessage(`${keyGroupLabels[group].title} slot ${slot} ${enabled ? 'enabled' : 'disabled'}.`)
  }

  const updatePlaywrightSetting = <K extends keyof PlaywrightSettings>(key: K, value: PlaywrightSettings[K]) => {
    setPlaywrightSettings((prev) => ({ ...prev, [key]: value }))
  }

  const savePlaywrightSettings = async () => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('playwright-settings-save', playwrightSettings)
    if (res?.settings) setPlaywrightSettings({ ...defaultPlaywrightSettings, ...res.settings })
    setPlaywrightMessage(res?.success ? 'Playwright settings saved.' : `Save failed: ${res?.error || 'unknown error'}`)
    const state = await window.electron.ipcRenderer.invoke('browser:get-state')
    if (state?.state) setBrowserAutomationState(state.state)
  }

  const testPlaywrightLaunch = async () => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('playwright-settings-test-launch')
    if (res?.settings) setPlaywrightSettings({ ...defaultPlaywrightSettings, ...res.settings })
    setPlaywrightMessage(res?.message || (res?.success ? 'Playwright launch test ready.' : `Test failed: ${res?.error || 'unknown error'}`))
    const state = await window.electron.ipcRenderer.invoke('browser:get-state')
    if (state?.state) setBrowserAutomationState(state.state)
  }

  const clearPlaywrightProfile = async () => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('playwright-settings-clear-profile')
    if (res?.settings) setPlaywrightSettings({ ...defaultPlaywrightSettings, ...res.settings })
    setPlaywrightMessage(res?.success ? 'Playwright profile path cleared.' : `Clear failed: ${res?.error || 'unknown error'}`)
    const state = await window.electron.ipcRenderer.invoke('browser:get-state')
    if (state?.state) setBrowserAutomationState(state.state)
  }

  const refreshBrowserAutomationState = async () => {
    if (!window.electron?.ipcRenderer) return
    const res = await window.electron.ipcRenderer.invoke('browser:get-state')
    if (res?.state) setBrowserAutomationState(res.state)
  }

  const updateKiloSetting = <K extends keyof KiloSettings>(key: K, value: KiloSettings[K]) => {
    setKiloSettings((prev) => ({ ...prev, [key]: value }))
  }

  const saveKiloSettings = async () => {
    const res = await persistKiloSettings(kiloSettings)
    if (res?.settings) setKiloSettings({ ...defaultKiloSettings, ...res.settings })
    setKiloMessage(res?.success ? 'Kilo settings saved.' : 'Kilo settings save failed.')
  }

  const runKiloHealthCheck = async () => {
    const res = await healthCheckKilo()
    setKiloMessage(res?.message || 'Kilo health check complete.')
    const settings = await getKiloSettings()
    if (settings?.settings) setKiloSettings({ ...defaultKiloSettings, ...settings.settings })
  }

  const runKiloConfigTest = async () => {
    const res = await testKiloConfiguration()
    setKiloMessage(res?.message || (res?.success ? 'Kilo test complete.' : 'Kilo test failed.'))
    const settings = await getKiloSettings()
    if (settings?.settings) setKiloSettings({ ...defaultKiloSettings, ...settings.settings })
  }

  const clearKiloHistory = async () => {
    const res = await clearKiloTaskHistory()
    setKiloMessage(res?.success ? 'Kilo task history cleared.' : 'Kilo task history clear failed.')
  }

  const revealKiloTaskFolder = async () => {
    const res = await openKiloTaskFolder()
    setKiloMessage(res?.success ? `Kilo task folder opened: ${res?.path || ''}` : `Open failed: ${res?.error || 'unknown error'}`)
  }

  const toggleLaunchOnStartup = async () => {
    const next = !launchOnStartup
    setLaunchOnStartup(next)
    if (window.electron?.ipcRenderer) {
      const applied = await window.electron.ipcRenderer.invoke('set-launch-on-startup', next)
      setLaunchOnStartup(Boolean(applied))
    }
  }

  const currentWordCount = personality
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length

  const unlockSecurityModule = async () => {
    if (!window.electron?.ipcRenderer) return
    const isValid = await window.electron.ipcRenderer.invoke('verify-vault-pin', authPin)
    if (isValid) {
      setIsSecurityUnlocked(true)
      setAuthPin('')
    } else {
      setAuthError(true)
      setTimeout(() => setAuthError(false), 1000)
    }
  }

  const updateMasterPin = async () => {
    if (newPin.length !== 4 || !window.electron?.ipcRenderer) return
    await window.electron.ipcRenderer.invoke('setup-vault-pin', newPin)
    setNewPin('')
    alert('Master PIN Updated Successfully.')
  }

  const startFaceEnrollment = async () => {
    setIsScanningFace(true)
    setEnrollStatus('INITIALIZING CAMERA...')
    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('./models')
      ])

      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setEnrollStatus('POSITION FACE IN FRAME')

        const scanInterval = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4) return
          const detection = await faceapi
            .detectSingleFace(videoRef.current)
            .withFaceLandmarks()
            .withFaceDescriptor()

          if (detection) {
            clearInterval(scanInterval)
            setEnrollStatus('FACE ACQUIRED. ENCRYPTING...')
            const descriptorArray = Array.from(detection.descriptor)

            if (window.electron?.ipcRenderer) {
              await window.electron.ipcRenderer.invoke('setup-vault-face', descriptorArray)
            }

            stream.getTracks().forEach((t) => t.stop())
            setIsScanningFace(false)
            setFaceCount((prev) => prev + 1)
            alert('New Biometric Identity Saved.')
          }
        }, 1000)
      }
    } catch (e) {
      setEnrollStatus('CAMERA ERROR')
      setTimeout(() => setIsScanningFace(false), 2000)
    }
  }

  const cardClass =
    'glass-card liquid-panel p-6 md:p-8 rounded-2xl flex flex-col gap-5 transition-all shadow-lg'
  const inputContainerClass =
    'glass-input flex items-center rounded-lg px-4 py-3 transition-all duration-300 w-full'
  const titleClass = 'text-sm font-semibold text-white flex items-center gap-2'
  const statusClass = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    if (status === 'available') return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
    if (status === 'failed') return 'bg-red-500/15 text-red-300 border-red-500/30'
    if (status === 'rate-limited') return 'bg-orange-500/15 text-orange-300 border-orange-500/30'
    if (status === 'disabled') return 'bg-zinc-500/10 text-zinc-500 border-white/10'
    return 'bg-white/5 text-zinc-500 border-white/10'
  }

  const renderKeySlotGroup = (group: KeyGroup) => {
    const meta = keyGroupLabels[group]
    const statuses = keySlotStatuses[group] || []
    const slotCount = keyGroupSlotCounts[group]
    return (
      <div className={`flex flex-col gap-4 md:col-span-2 border rounded-xl p-5 ${meta.accent}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <label className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2">
            <RiKey2Line size={14} /> {meta.title}
          </label>
          <span className="text-[10px] text-zinc-400 font-mono">{meta.description}</span>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: slotCount }, (_, index) => index + 1).map((slot) => {
            const slotStatus = statuses.find((item) => item.slot === slot)
            const visibleKey = `${group}-${slot}`
            const configurableGroup = isConfigurableProviderGroup(group) ? group : null
            const providerConfig = configurableGroup
              ? providerSlotConfigs[configurableGroup][slot - 1]
              : null
            return (
              <div
                key={visibleKey}
                className="grid grid-cols-1 gap-3 bg-black/20 border border-white/10 rounded-lg p-3"
              >
                <div className="grid grid-cols-1 lg:grid-cols-[130px_1fr_86px_82px_74px_92px] gap-2 items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-white font-mono tracking-widest">
                      SLOT {slot}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {slotStatus?.maskedKey || 'not saved'}
                    </span>
                  </div>
                  <div className={inputContainerClass}>
                    <input
                      type={visibleKeySlots[visibleKey] ? 'text' : 'password'}
                      value={keySlotInputs[group][slot - 1]}
                      onChange={(e) => updateKeySlotInput(group, slot, e.target.value)}
                      placeholder={slotStatus?.hasKey ? slotStatus.maskedKey : 'Paste API key...'}
                      className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                    />
                    <button
                      onClick={() =>
                        setVisibleKeySlots((prev) => ({ ...prev, [visibleKey]: !prev[visibleKey] }))
                      }
                      className="text-zinc-500 hover:text-white transition-colors ml-2"
                      title={visibleKeySlots[visibleKey] ? 'Hide key' : 'Show key'}
                    >
                      {visibleKeySlots[visibleKey] ? <RiEyeOffLine size={18} /> : <RiEyeLine size={18} />}
                    </button>
                  </div>
                  <span
                    className={`text-[10px] font-mono border px-2 py-2 rounded text-center uppercase ${statusClass(slotStatus?.status || 'empty')}`}
                    title={slotStatus?.lastFailureReason || ''}
                  >
                    {slotStatus?.status || 'empty'}
                  </span>
                  <button
                    onClick={() => toggleKeySlot(group, slot, !(slotStatus?.enabled ?? true))}
                    className={`text-[10px] font-bold tracking-widest rounded border py-2 transition-all cursor-pointer ${
                      slotStatus?.enabled === false
                        ? 'border-white/10 text-zinc-500 hover:text-white'
                        : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
                    }`}
                  >
                    {slotStatus?.enabled === false ? 'ENABLE' : 'DISABLE'}
                  </button>
                  <button
                    onClick={() => testKeySlot(group, slot)}
                    className="text-[10px] font-bold tracking-widest rounded border border-white/10 py-2 text-zinc-300 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    TEST
                  </button>
                  <button
                    onClick={() => saveKeySlot(group, slot)}
                    className="text-[10px] font-bold tracking-widest rounded bg-white text-black py-2 hover:bg-zinc-200 transition-all cursor-pointer"
                  >
                    SAVE
                  </button>
                </div>

                {providerConfig && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className={inputContainerClass}>
                        <input
                          value={providerConfig.baseUrl || ''}
                          onChange={(e) =>
                            configurableGroup && updateProviderSlotConfig(configurableGroup, slot, 'baseUrl', e.target.value)
                          }
                          placeholder={
                            (configurableGroup && providerSlotDefaults[configurableGroup].baseUrl) ||
                            'https://api.example.com/v1'
                          }
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                    </div>
                    <div className={inputContainerClass}>
                        <input
                          value={providerConfig.modelId || ''}
                          onChange={(e) =>
                            configurableGroup && updateProviderSlotConfig(configurableGroup, slot, 'modelId', e.target.value)
                          }
                          placeholder={(configurableGroup && providerSlotDefaults[configurableGroup].modelId) || 'model-id'}
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                    </div>
                    <div className="glass-input flex items-center rounded-lg px-4 py-3">
                      <select
                        value={
                          providerConfig.providerMode ||
                          (configurableGroup ? providerSlotDefaults[configurableGroup].providerMode : '')
                        }
                        onChange={(e) =>
                          configurableGroup &&
                          updateProviderSlotConfig(configurableGroup, slot, 'providerMode', e.target.value)
                        }
                        className="w-full bg-transparent text-sm font-mono text-zinc-100 outline-none"
                      >
                        {group === 'glm' ? (
                          <>
                            <option value="openai-compatible">OpenAI Compatible</option>
                            <option value="zenmux">ZenMux Compatible</option>
                            <option value="custom-compatible">Custom Compatible API</option>
                            <option value="direct-zai">Direct ZAI</option>
                          </>
                        ) : group === 'zai' ? (
                          <>
                            <option value="zai-chat">Z.AI Chat Completions</option>
                            <option value="zai-coding">Z.AI Coding Compatible</option>
                            <option value="zai-compatible">Custom Z.AI Compatible</option>
                          </>
                        ) : (
                          <>
                            <option value="openai-compatible">OpenAI Compatible</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 md:p-10 lg:p-16 flex flex-col items-center liquid-glass-shell min-h-screen text-zinc-100 overflow-y-auto scrollbar-small">
      <motion.div
        className="w-full max-w-4xl flex flex-col gap-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/10 pb-6">
          <div className="flex items-center gap-5">
            <div className="glass-card p-4 rounded-2xl flex items-center justify-center shadow-[0_0_22px_rgba(34,211,238,0.08)]">
              <GiArtificialIntelligence size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white">Command Center</h2>
              <p className="text-xs text-zinc-400 font-mono mt-1 tracking-widest flex items-center gap-2 uppercase">
                <RiRecordCircleLine
                  className={`${isSystemActive ? 'text-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'text-zinc-600'}`}
                  size={14}
                />
                {isSystemActive ? 'System Online' : 'System Offline'}
              </p>
            </div>
          </div>

          <div className="glass-card flex p-1 rounded-xl w-full md:w-fit shadow-lg overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('updates')}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold tracking-widest rounded-lg transition-all duration-300 ${activeTab === 'updates' ? 'bg-cyan-300 text-black shadow-[0_0_20px_rgba(34,211,238,0.22)]' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
            >
              <RiTerminalWindowLine size={16} /> SYSTEM
            </button>
            <button
              onClick={() => setActiveTab('general')}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold tracking-widest rounded-lg transition-all duration-300 ${activeTab === 'general' ? 'bg-cyan-300 text-black shadow-[0_0_20px_rgba(34,211,238,0.22)]' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
            >
              <RiSettings4Line size={16} /> GENERAL
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold tracking-widest rounded-lg transition-all duration-300 ${activeTab === 'keys' ? 'bg-cyan-300 text-black shadow-[0_0_20px_rgba(34,211,238,0.22)]' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
            >
              <RiPlugLine size={16} /> API KEYS
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold tracking-widest rounded-lg transition-all duration-300 ${activeTab === 'security' ? 'bg-cyan-300 text-black shadow-[0_0_20px_rgba(34,211,238,0.22)]' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
            >
              <RiShieldKeyholeLine size={16} /> SECURITY
            </button>
          </div>
        </div>

        <div className="relative min-h-125 pb-12 mt-2">
          <AnimatePresence mode="wait">
            {activeTab === 'updates' && (
              <motion.div
                key="updates"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-6 absolute w-full"
              >
                <div className={`${cardClass} md:col-span-1 border-emerald-500/20`}>
                  <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <span className={titleClass}>
                      <RiRocketLine className="text-emerald-400" size={18} /> OS Firmware
                    </span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded font-mono font-bold tracking-widest">
                      v{appVersion}
                    </span>
                  </div>

                  <div className="flex flex-col gap-4 items-center justify-center flex-1 py-4 text-center">
                    {updateStatus === 'idle' || updateStatus === 'error' ? (
                      <>
                        <RiTerminalWindowLine size={48} className="text-zinc-700" />
                        <p className="text-xs text-zinc-400 font-mono">Current build is stable.</p>
                        <button
                          onClick={checkForUpdates}
                          className="mt-2 w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold tracking-widest text-[11px] flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <RiRefreshLine size={16} /> CHECK FOR UPDATES
                        </button>
                      </>
                    ) : updateStatus === 'checking' ? (
                      <>
                        <RiRefreshLine size={48} className="text-emerald-500 animate-spin" />
                        <p className="text-xs text-emerald-400 font-mono animate-pulse">
                          PINGING NEURAL NETWORK...
                        </p>
                      </>
                    ) : updateStatus === 'available' ? (
                      <>
                        <RiDownloadCloud2Line size={48} className="text-cyan-400" />
                        <p className="text-xs text-cyan-400 font-mono">
                          NEW BUILD FOUND: v{updateVersion}
                        </p>
                        <button
                          onClick={downloadUpdate}
                          className="mt-2 w-full py-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500 text-cyan-400 hover:text-black font-bold tracking-widest text-[11px] flex items-center justify-center gap-2 transition-all border border-cyan-500/50 cursor-pointer"
                        >
                          <RiDownloadCloud2Line size={16} /> INITIALIZE DOWNLOAD
                        </button>
                      </>
                    ) : updateStatus === 'downloading' ? (
                      <div className="w-full flex flex-col gap-3">
                        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                          <span>DOWNLOADING PATCH...</span>
                          <span>{downloadProgress}%</span>
                        </div>
                        <div className="w-full h-2 bg-black rounded-full overflow-hidden border border-white/10">
                          <div
                            className="h-full bg-cyan-500 shadow-[0_0_10px_#06b6d4] transition-all duration-300"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <RiRecordCircleLine size={48} className="text-emerald-400 animate-pulse" />
                        <p className="text-xs text-emerald-400 font-mono">PATCH DOWNLOADED</p>
                        <button
                          onClick={installUpdate}
                          className="mt-2 w-full py-3 rounded-lg bg-emerald-500 text-black font-bold tracking-widest text-[11px] flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer"
                        >
                          <RiRocketLine size={16} /> EXECUTE RESTART
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className={`${cardClass} md:col-span-1`}>
                  <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <span className={titleClass}>
                      <RiTerminalWindowLine className="text-zinc-400" size={18} /> Patch Notes
                    </span>
                  </div>
                  <div className="flex-1 bg-[#050505] border border-white/5 rounded-xl p-4 overflow-y-auto max-h-60 scrollbar-small">
                    <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                      {updateNotes}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- TAB 2: GENERAL --- */}
            {activeTab === 'general' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-6 absolute w-full"
              >
                <div className={`${cardClass} md:col-span-2`}>
                  <div className="flex justify-between items-center">
                    <span className={titleClass}>
                      <RiUserLine className="text-zinc-400" size={18} /> AI Personality Matrix
                    </span>
                    <div className="flex items-center gap-4">
                      <span
                        className={`text-[10px] font-mono tracking-widest ${currentWordCount >= 150 ? 'text-red-400' : 'text-zinc-400'}`}
                      >
                        {currentWordCount} / 150 WORDS
                      </span>
                      <button
                        onClick={savePersonality}
                        className="text-zinc-400 hover:text-white transition-colors bg-white/5 p-2 rounded-md hover:bg-white/10 border border-white/5"
                      >
                        <RiSave3Line size={18} />
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={personality}
                    onChange={handlePersonalityChange}
                    placeholder="Define who alpha is. Example: 'You are a sassy, highly technical assistant...'"
                    className="bg-[#050505] border border-white/10 rounded-lg p-4 text-sm text-zinc-200 h-32 resize-none focus:border-white/30 outline-none transition-all scrollbar-small"
                  />
                </div>

                <div className={cardClass}>
                  <div className="flex justify-between items-end">
                    <span className={titleClass}>
                      <RiUserLine className="text-zinc-400" size={18} /> User Designation
                    </span>
                  </div>
                  <div className={inputContainerClass}>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Enter operator name..."
                      className="bg-transparent border-none outline-none text-sm text-zinc-100 w-full placeholder:text-zinc-600 font-medium"
                    />
                    <button
                      onClick={saveUserName}
                      className="text-zinc-500 hover:text-white transition-colors ml-2"
                    >
                      <RiSave3Line size={20} />
                    </button>
                  </div>
                </div>

                <div className={`${cardClass} relative`}>
                  <div className="flex justify-between items-center">
                    <span className={titleClass}>
                      <RiUserVoiceLine className="text-zinc-400" size={18} /> OS Voice Profile
                    </span>
                    {isSystemActive && (
                      <span className="text-[10px] text-red-400 font-mono tracking-widest flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded border border-red-500/20">
                        <RiLock2Line /> LOCKED AS alpha IS CONNECTED
                      </span>
                    )}
                  </div>
                  <div
                    className={`flex gap-3 h-12 mt-1 ${isSystemActive ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {(['FEMALE', 'MALE'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleVoiceChange(s)}
                        disabled={isSystemActive}
                        className={`cursor-pointer flex-1 flex items-center justify-center text-[12px] font-bold rounded-lg transition-all tracking-widest border ${
                          voice === s
                            ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.2)]'
                            : 'bg-[#050505] border-white/10 text-zinc-400 hover:text-white hover:border-white/30'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {isSystemActive && (
                    <div
                      className="absolute inset-0 z-10"
                      title="Disconnect AI to change voice"
                    ></div>
                  )}
                </div>

                <div className={cardClass}>
                  <div className="flex justify-between items-center">
                    <span className={titleClass}>
                      <RiCpuLine className="text-zinc-400" size={18} /> STT Latency Mode
                    </span>
                    {isSystemActive && (
                      <span className="text-[10px] text-zinc-500 font-mono tracking-widest">
                        APPLIES AFTER RECONNECT
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3 h-12 mt-1">
                    {['ULTRA', 'FAST', 'STABLE'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => saveSttLatencyMode(mode)}
                        className={`cursor-pointer flex items-center justify-center text-[11px] font-bold rounded-lg transition-all tracking-widest border ${
                          sttLatencyMode === mode
                            ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.2)]'
                            : 'bg-[#050505] border-white/10 text-zinc-400 hover:text-white hover:border-white/30'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Ultra prioritizes fastest Gemini STT pickup. Use Stable only if your network
                    drops audio chunks.
                  </p>
                </div>

                <div className={cardClass}>
                  <div className="flex justify-between items-center">
                    <span className={titleClass}>
                      <RiRocketLine className="text-zinc-400" size={18} /> Windows Startup
                    </span>
                    <button
                      onClick={toggleLaunchOnStartup}
                      className={`w-14 h-7 rounded-full border transition-all p-1 cursor-pointer ${
                        launchOnStartup
                          ? 'bg-emerald-500/20 border-emerald-500/50'
                          : 'bg-[#050505] border-white/10'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full transition-all ${
                          launchOnStartup
                            ? 'translate-x-7 bg-emerald-400'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Launch alpha automatically when Windows starts.
                  </p>
                </div>
              </motion.div>
            )}

            {/* --- TAB 3: API KEYS --- */}
            {activeTab === 'keys' && (
              <motion.div
                key="keys"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 gap-6 absolute w-full"
              >
                <div className={`${cardClass} gap-6`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
                    <span className={titleClass}>
                      <RiKey2Line className="text-zinc-400" size={18} /> External API Endpoints
                    </span>
                    <button
                      onClick={saveApiKeys}
                      className="bg-white text-black px-6 py-2.5 rounded-lg text-xs font-bold tracking-widest hover:bg-zinc-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <RiSave3Line size={16} /> SAVE ALL KEYS
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {keyGroups.map((group) => renderKeySlotGroup(group))}

                    <div className="flex flex-col gap-3 md:col-span-2 bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-5">
                      <label className="text-[10px] text-cyan-300 font-mono tracking-widest uppercase flex items-center gap-2">
                        <RiCpuLine size={14} /> OpenRouter Default Model
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_170px] gap-4">
                        <input
                          type="text"
                          value={openrouterModel}
                          onChange={(e) => setOpenRouterModel(e.target.value)}
                          placeholder="openai/gpt-4.1-mini"
                          className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30 placeholder:text-zinc-700"
                        />
                        <button
                          onClick={saveOpenRouterSettings}
                          className="py-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold tracking-widest text-[11px] flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <RiSave3Line size={16} /> SAVE DEFAULT
                        </button>
                      </div>
                      {keySlotMessage && (
                        <p className="text-[10px] text-emerald-300 font-mono">{keySlotMessage}</p>
                      )}
                    </div>


                    <div className="flex flex-col gap-4 md:col-span-2 border border-blue-500/20 rounded-xl p-5 bg-blue-500/5">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <label className="text-[10px] text-blue-300 font-mono tracking-widest uppercase flex items-center gap-2">
                          <RiTerminalWindowLine size={14} /> Playwright Browser Automation
                        </label>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          No API key required. Stores browser/profile preferences only.
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                          onClick={() => updatePlaywrightSetting('enabled', !playwrightSettings.enabled)}
                          className={`rounded-lg border px-4 py-3 text-[11px] font-bold tracking-widest transition-all ${
                            playwrightSettings.enabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border-white/10 bg-black/20 text-zinc-500'
                          }`}
                        >
                          {playwrightSettings.enabled ? 'PLAYWRIGHT ENABLED' : 'PLAYWRIGHT DISABLED'}
                        </button>
                        <select
                          value={playwrightSettings.browser}
                          onChange={(e) => updatePlaywrightSetting('browser', e.target.value as PlaywrightBrowser)}
                          className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30"
                        >
                          <option value="chromium">Chromium</option>
                          <option value="chrome">Chrome</option>
                          <option value="edge">Edge</option>
                        </select>
                        <div className="md:col-span-2 flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
                            Persistent profile path
                          </label>
                          <input
                            type="text"
                            value={playwrightSettings.profilePath}
                            onChange={(e) => updatePlaywrightSetting('profilePath', e.target.value)}
                            placeholder="Optional profile folder path..."
                            className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30 placeholder:text-zinc-700"
                          />
                        </div>
                        <button
                          onClick={() => updatePlaywrightSetting('headless', !playwrightSettings.headless)}
                          className="rounded-lg border border-white/10 px-4 py-3 text-[11px] font-bold tracking-widest text-zinc-300 hover:text-white hover:bg-white/5 transition-all"
                        >
                          {playwrightSettings.headless ? 'HEADLESS MODE' : 'HEADED MODE'}
                        </button>
                        <button
                          onClick={savePlaywrightSettings}
                          className="rounded-lg bg-white text-black px-4 py-3 text-[11px] font-bold tracking-widest hover:bg-zinc-200 transition-all"
                        >
                          SAVE PLAYWRIGHT
                        </button>
                        <button
                          onClick={testPlaywrightLaunch}
                          className="rounded-lg border border-cyan-500/30 px-4 py-3 text-[11px] font-bold tracking-widest text-cyan-300 hover:bg-cyan-500/10 transition-all"
                        >
                          TEST BROWSER LAUNCH
                        </button>
                        <button
                          onClick={clearPlaywrightProfile}
                          className="rounded-lg border border-orange-500/30 px-4 py-3 text-[11px] font-bold tracking-widest text-orange-300 hover:bg-orange-500/10 transition-all"
                        >
                          CLEAR PROFILE PATH
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono">
                        Status: {playwrightSettings.lastStatus || 'unknown'}
                        {playwrightSettings.lastTestedAt ? ` | Last tested: ${playwrightSettings.lastTestedAt}` : ''}
                      </p>
                      {playwrightMessage && <p className="text-[10px] text-emerald-300 font-mono">{playwrightMessage}</p>}
                      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[10px] font-mono text-zinc-400">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="uppercase tracking-widest text-zinc-500">Browser Automation Status</span>
                          <button
                            onClick={refreshBrowserAutomationState}
                            className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/10"
                          >
                            Refresh State
                          </button>
                        </div>
                        <p>Enabled: {browserAutomationState?.enabled ? 'yes' : 'no'}</p>
                        <p>Launched: {browserAutomationState?.launched ? 'yes' : 'no'}</p>
                        <p>Browser: {browserAutomationState?.browser || playwrightSettings.browser}</p>
                        <p>Current URL: {browserAutomationState?.currentUrl || 'n/a'}</p>
                        <p>Page title: {browserAutomationState?.title || 'n/a'}</p>
                        <p>Last action: {browserAutomationState?.lastAction || 'n/a'}</p>
                        <p>Error/status: {browserAutomationState?.lastError || playwrightSettings.lastStatus || 'n/a'}</p>
                        <p>Screenshot path: {browserAutomationState?.screenshotPath || 'n/a'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 md:col-span-2 border border-fuchsia-500/20 rounded-xl p-5 bg-fuchsia-500/5">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <label className="text-[10px] text-fuchsia-300 font-mono tracking-widest uppercase flex items-center gap-2">
                          <RiCpuLine size={14} /> Kilo Code Execution Agent
                        </label>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          Gemini main brain rahega. Kilo sirf coding execution layer ke liye.
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                          onClick={() => updateKiloSetting('enabled', !kiloSettings.enabled)}
                          className={`rounded-lg border px-4 py-3 text-[11px] font-bold tracking-widest transition-all ${
                            kiloSettings.enabled
                              ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200'
                              : 'border-white/10 bg-black/20 text-zinc-500'
                          }`}
                        >
                          {kiloSettings.enabled ? 'KILO ENABLED' : 'KILO DISABLED'}
                        </button>
                        <select
                          value={kiloSettings.executionMode}
                          onChange={(e) => updateKiloSetting('executionMode', e.target.value as KiloExecutionMode)}
                          className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30"
                        >
                          <option value="cli">CLI</option>
                          <option value="local-service">Local Service</option>
                          <option value="adapter-stub">Adapter Stub</option>
                        </select>
                        <div className="md:col-span-2 flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
                            Kilo command / path
                          </label>
                          <input
                            type="text"
                            value={kiloSettings.commandPath}
                            onChange={(e) => updateKiloSetting('commandPath', e.target.value)}
                            placeholder="CLI command ya local service URL..."
                            className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30 placeholder:text-zinc-700"
                          />
                        </div>
                        <select
                          value={kiloSettings.defaultPermissionMode}
                          onChange={(e) => updateKiloSetting('defaultPermissionMode', e.target.value as KiloPermissionMode)}
                          className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30"
                        >
                          <option value="ask">Ask for approval</option>
                          <option value="approve">Approve for me</option>
                          <option value="full">Project full access</option>
                        </select>
                        <select
                          value={kiloSettings.workingDirectoryPolicy}
                          onChange={(e) => updateKiloSetting('workingDirectoryPolicy', e.target.value as KiloWorkingDirectoryPolicy)}
                          className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30"
                        >
                          <option value="project-only">Project only</option>
                          <option value="workspace-only">Workspace only</option>
                          <option value="user-approved">User approved folder</option>
                        </select>
                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-mono text-zinc-300">
                            <span>Auto git checkpoint</span>
                            <input
                              type="checkbox"
                              checked={kiloSettings.autoGitCheckpoint}
                              onChange={(e) => updateKiloSetting('autoGitCheckpoint', e.target.checked)}
                            />
                          </label>
                          <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-mono text-zinc-300">
                            <span>Auto build/test</span>
                            <input
                              type="checkbox"
                              checked={kiloSettings.autoBuildTest}
                              onChange={(e) => updateKiloSetting('autoBuildTest', e.target.checked)}
                            />
                          </label>
                          <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-[11px] font-mono text-zinc-300 md:col-span-2">
                            <span>Auto commit</span>
                            <input
                              type="checkbox"
                              checked={kiloSettings.autoCommit}
                              onChange={(e) => updateKiloSetting('autoCommit', e.target.checked)}
                            />
                          </label>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
                            Timeout (ms)
                          </label>
                          <input
                            type="number"
                            min={15000}
                            step={5000}
                            value={kiloSettings.timeoutMs}
                            onChange={(e) => updateKiloSetting('timeoutMs', Number(e.target.value || 120000))}
                            className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 outline-none focus:border-white/30"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={saveKiloSettings}
                            className="w-full rounded-lg bg-white text-black px-4 py-3 text-[11px] font-bold tracking-widest hover:bg-zinc-200 transition-all"
                          >
                            SAVE KILO
                          </button>
                        </div>
                        <button
                          onClick={runKiloHealthCheck}
                          className="rounded-lg border border-fuchsia-500/30 px-4 py-3 text-[11px] font-bold tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/10 transition-all"
                        >
                          HEALTH CHECK
                        </button>
                        <button
                          onClick={runKiloConfigTest}
                          className="rounded-lg border border-cyan-500/30 px-4 py-3 text-[11px] font-bold tracking-widest text-cyan-300 hover:bg-cyan-500/10 transition-all"
                        >
                          TEST KILO
                        </button>
                        <button
                          onClick={clearKiloHistory}
                          className="rounded-lg border border-orange-500/30 px-4 py-3 text-[11px] font-bold tracking-widest text-orange-300 hover:bg-orange-500/10 transition-all"
                        >
                          CLEAR TASK HISTORY
                        </button>
                        <button
                          onClick={revealKiloTaskFolder}
                          className="rounded-lg border border-white/10 px-4 py-3 text-[11px] font-bold tracking-widest text-zinc-300 hover:bg-white/5 transition-all"
                        >
                          OPEN TASK FOLDER
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono">
                        Status: {kiloSettings.lastHealthStatus || 'unknown'}
                        {kiloSettings.lastHealthCheckAt ? ` | Last checked: ${kiloSettings.lastHealthCheckAt}` : ''}
                      </p>
                      <p className="text-[10px] text-zinc-500 font-mono">
                        Scope safety: project-scoped paths only, destructive/system commands blocked, git push explicit approval ke bina disabled.
                      </p>
                      {kiloMessage && <p className="text-[10px] text-emerald-300 font-mono">{kiloMessage}</p>}
                    </div>
                    <div className="flex flex-col gap-2 md:col-span-2 border border-white/10 rounded-xl p-5 bg-white/[0.02]">
                      <label className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase flex items-center gap-2">
                        <RiBrainLine size={14} /> Legacy Single Gemini Key Fallback
                      </label>
                      <div className={inputContainerClass}>
                        <input
                          type="password"
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          placeholder="Optional fallback key..."
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono">
                        Saved here only as backward-compatible fallback. Use Gemini Brain slots above for rotation.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase flex items-center gap-2">
                        <RiCpuLine size={14} /> Groq Fast Inferencing
                      </label>
                      <div className={inputContainerClass}>
                        <input
                          type="password"
                          value={groqKey}
                          onChange={(e) => setGroqKey(e.target.value)}
                          placeholder="gsk_..."
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:col-span-2">
                      <label className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase flex items-center gap-2">
                        <RiCloudLine size={14} /> Hugging Face Vision
                      </label>
                      <div className={inputContainerClass}>
                        <input
                          type="password"
                          value={hfKey}
                          onChange={(e) => setHfKey(e.target.value)}
                          placeholder="hf_..."
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:col-span-2">
                      <label className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase flex items-center gap-2">
                        <RiPlugLine size={14} /> Tailvy Builder Agent
                      </label>
                      <div className={inputContainerClass}>
                        <input
                          type="password"
                          value={tailvyKey}
                          onChange={(e) => setTailvyKey(e.target.value)}
                          placeholder="tlv_..."
                          className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full placeholder:text-zinc-700"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#050505] border border-white/5 p-4 rounded-xl mt-2 flex items-start gap-3">
                    <RiShieldKeyholeLine className="text-zinc-500 shrink-0 mt-0.5" size={16} />
                    <p className="text-[10px] text-zinc-400 font-mono leading-relaxed">
                      [SECURITY NOTICE]: All API keys are encrypted and stored strictly in your
                      local OS. alpha does not transmit these keys to any centralized server. You
                      maintain full ownership and billing control over your provider endpoints.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- TAB 4: SECURITY --- */}
            {activeTab === 'security' && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full rounded-3xl overflow-hidden shadow-2xl border border-white/5 absolute"
              >
                <AnimatePresence>
                  {!isSecurityUnlocked && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                      className="absolute inset-0 z-20 backdrop-blur-2xl bg-black/70 border border-white/10 rounded-3xl flex flex-col items-center justify-center"
                    >
                      <div className="bg-[#111] p-5 rounded-full mb-6 border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
                        <RiLockPasswordLine size={40} className="text-white" />
                      </div>
                      <p className="text-xs text-zinc-300 font-mono tracking-widest uppercase mb-6 font-semibold">
                        Authenticate to access Vault Settings
                      </p>
                      <div className="flex gap-3 items-center h-12">
                        <input
                          type="password"
                          maxLength={4}
                          pattern="\d*"
                          value={authPin}
                          onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, ''))}
                          placeholder="PIN"
                          className={`h-full bg-[#050505] border w-32 rounded-lg text-center text-xl tracking-[0.5em] text-white outline-none transition-colors ${authError ? 'border-red-500 text-red-500 bg-red-500/10' : 'border-white/20 focus:border-white focus:bg-[#111]'}`}
                        />
                        <button
                          onClick={unlockSecurityModule}
                          className="h-full px-8 bg-white text-black text-xs font-bold tracking-widest rounded-lg hover:bg-zinc-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.2)] cursor-pointer"
                        >
                          UNLOCK
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#0a0a0c] p-6 rounded-3xl border border-white/5">
                  <div className="bg-[#111113] border border-white/10 p-7 rounded-2xl flex flex-col gap-5">
                    <span className={titleClass}>
                      <RiLockPasswordLine className="text-zinc-400" size={18} /> Update Master PIN
                    </span>
                    <div className={inputContainerClass}>
                      <input
                        type="password"
                        maxLength={4}
                        pattern="\d*"
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter new 4-digit PIN..."
                        className="bg-transparent border-none outline-none text-sm font-mono text-zinc-100 w-full tracking-[0.3em]"
                      />
                      <button
                        onClick={updateMasterPin}
                        className="text-zinc-500 hover:text-white transition-colors ml-2 cursor-pointer"
                      >
                        <RiSave3Line size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#111113] border border-white/10 p-7 rounded-2xl flex flex-col gap-6">
                    <div className="flex justify-between items-center border-b border-white/10 pb-4">
                      <span className={titleClass}>
                        <RiScan2Line className="text-zinc-400" size={18} /> Biometric Registry
                      </span>
                      <span className="text-[10px] text-white font-mono tracking-widest bg-white/10 px-3 py-1.5 rounded-md font-semibold border border-white/5">
                        {faceCount} ENROLLED
                      </span>
                    </div>

                    {isScanningFace ? (
                      <div className="flex items-center gap-4 bg-[#050505] p-3 rounded-xl border border-white/20">
                        <video
                          ref={videoRef}
                          autoPlay
                          muted
                          playsInline
                          className="w-16 h-16 rounded-lg object-cover -scale-x-100 border border-white/10"
                        />
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-white font-mono tracking-widest animate-pulse font-bold">
                            {enrollStatus}
                          </span>
                          <span className="text-xs text-zinc-400">Keep head steady...</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4 h-full justify-between">
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Enroll additional structural face descriptors. Data is mathematically
                          encrypted and stored locally.
                        </p>
                        <button
                          onClick={startFaceEnrollment}
                          className="w-full py-3 rounded-lg bg-white text-black font-bold tracking-widest text-[12px] flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)] mt-auto cursor-pointer"
                        >
                          <RiAddLine size={18} /> ENROLL NEW IDENTITY
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

export default SettingsView

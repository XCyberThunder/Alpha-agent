import { useState, useEffect, useRef } from 'react'
import MiniOverlay from './components/MiniOverlay'
import { alphaService } from './services/alpha-voice-ai'
import { getScreenSourceId } from './hooks/CaptureDesktop'
import Alpha from './UI/alpha'
import TerminalOverlay from './components/TerminalOverlay'
import LeafletMapWidget from './Widgets/MapView'
import ImageWidget from './Widgets/ImageWidget'
import EmailWidget from './Widgets/EmailWidget'
import WeatherWidget from './Widgets/WeatherWidget'
import StockWidget from './Widgets/StockWidget'
import LiveCodingWidget from './Widgets/LiveCodingWidget'
import WormholeWidget from './Widgets/WormholeWidget'
import OracleWidget from './Widgets/RagOrcaleWidget'
import ResearchWidget from './Widgets/DeepResearch'
import SemanticWidget from './Widgets/SematicSearch'
import SmartDropZonesWidget from './Widgets/SmartZoneWidget'
import TitleBar from './components/Titlebar'

export type VisionMode = 'camera' | 'screen' | 'none'

const IndexRoot = () => {
  const [isOverlay, setIsOverlay] = useState(false)

  const [isSystemActive, setIsSystemActive] = useState(false)
  const [isMicMuted, setIsMicMuted] = useState(true)
  const reconnectingRef = useRef(false)
  const desiredMicMutedRef = useRef(true)

  const [isVideoOn, setIsVideoOn] = useState(false)
  const [visionMode, setVisionMode] = useState<VisionMode>('none')

  const processingVideoRef = useRef<HTMLVideoElement>(document.createElement('video'))
  const activeStreamRef = useRef<MediaStream | null>(null)
  const aiIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    window.electron.ipcRenderer.on('overlay-mode', (_e, mode) => setIsOverlay(mode))
    return () => {
      window.electron.ipcRenderer.removeAllListeners('overlay-mode')
    }
  }, [])

  useEffect(() => {
    window.electron.ipcRenderer.on('tray-mute-voice', () => {
      desiredMicMutedRef.current = true
      setIsMicMuted(true)
      alphaService.setMute(true)
      alphaService.stopCurrentSpeech()
    })

    window.electron.ipcRenderer.on('tray-restart-ai', async () => {
      if (!isSystemActive || reconnectingRef.current) return
      reconnectingRef.current = true
      try {
        alphaService.disconnect()
        await alphaService.connect()
        alphaService.setMute(desiredMicMutedRef.current)
      } catch {
        setIsSystemActive(false)
        setIsMicMuted(true)
        desiredMicMutedRef.current = true
        stopVision()
      } finally {
        reconnectingRef.current = false
      }
    })

    return () => {
      window.electron.ipcRenderer.removeAllListeners('tray-mute-voice')
      window.electron.ipcRenderer.removeAllListeners('tray-restart-ai')
    }
  }, [isSystemActive])

  useEffect(() => {
    const watchdog = setInterval(async () => {
      if (isSystemActive && !alphaService.isConnected && !reconnectingRef.current) {
        reconnectingRef.current = true
        try {
          await alphaService.connect()
          alphaService.setMute(desiredMicMutedRef.current)
          setIsMicMuted(desiredMicMutedRef.current)
        } catch {
          setIsSystemActive(false)
          setIsMicMuted(true)
          desiredMicMutedRef.current = true
          stopVision()
        } finally {
          reconnectingRef.current = false
        }
      }
    }, 1500)
    return () => clearInterval(watchdog)
  }, [isSystemActive])

  useEffect(() => {
    window.electron.ipcRenderer.send('activate-background-mode')
  }, [])

  const toggleSystem = async () => {
    if (!isSystemActive) {
      try {
        await alphaService.connect()
        setIsSystemActive(true)
        setIsMicMuted(false)
        desiredMicMutedRef.current = false
        alphaService.setMute(false)
      } catch (err: any) {
        if (err.message === 'NO_API_KEY') {
          alert(
            '⚠️ CRITICAL ERROR: Gemini API Key is missing. Please enter it in the Command Center Vault (Settings Tab).'
          )
        } else {
          alert(`Connection failed: ${err.message}`)
        }
        setIsSystemActive(false)
      }
    } else {
      alphaService.disconnect()
      setIsSystemActive(false)
      setIsMicMuted(true)
      desiredMicMutedRef.current = true
      alphaService.setMute(true)
      stopVision()
    }
  }

  const toggleMic = () => {
    const s = !isMicMuted
    setIsMicMuted(s)
    desiredMicMutedRef.current = s
    alphaService.setMute(s)
  }

  const startVision = async (mode: 'camera' | 'screen') => {
    if (!isSystemActive) return

    try {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop())
      }

      let stream: MediaStream

      if (mode === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 }
        })
      } else {
        const sourceId = await getScreenSourceId()
        if (!sourceId) return
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-ignore
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1280,
              maxHeight: 720
            }
          }
        })
      }

      activeStreamRef.current = stream

      processingVideoRef.current.srcObject = stream
      await processingVideoRef.current.play()

      setVisionMode(mode)
      setIsVideoOn(true)

      startAIProcessing()

      stream.getVideoTracks()[0].onended = () => stopVision()
    } catch (e) {
      stopVision()
    }
  }

  const stopVision = () => {
    setIsVideoOn(false)
    setVisionMode('none')

    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((t) => t.stop())
      activeStreamRef.current = null
    }

    if (processingVideoRef.current) {
      processingVideoRef.current.srcObject = null
    }

    if (aiIntervalRef.current) {
      clearInterval(aiIntervalRef.current)
      aiIntervalRef.current = null
    }
  }

  const startAIProcessing = () => {
    if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)

    aiIntervalRef.current = setInterval(() => {
      const vid = processingVideoRef.current
      if (vid && vid.readyState === 4 && alphaService.socket?.readyState === WebSocket.OPEN) {
        const canvas = document.createElement('canvas')
        canvas.width = 800
        canvas.height = 450
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
          const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1]
          alphaService.sendVideoFrame(base64)
        }
      }
    }, 1000)
  }

  if (isOverlay) {
    return (
      <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-transparent">
        <MiniOverlay
          isSystemActive={isSystemActive}
          toggleSystem={toggleSystem}
          isMicMuted={isMicMuted}
          toggleMic={toggleMic}
          isVideoOn={isVideoOn}
          visionMode={visionMode}
          startVision={startVision}
          stopVision={stopVision}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-transparent overflow-hidden relative border border-cyan-300/15 rounded-xl">
      <TitleBar />
      <div className="flex-1 relative">
        <Alpha
          isSystemActive={isSystemActive}
          toggleSystem={toggleSystem}
          isMicMuted={isMicMuted}
          toggleMic={toggleMic}
          isVideoOn={isVideoOn}
          visionMode={visionMode}
          startVision={startVision}
          stopVision={stopVision}
          activeStream={activeStreamRef.current}
        />
      </div>
      <SmartDropZonesWidget />
      <SemanticWidget />
      <OracleWidget />
      <WormholeWidget />
      <LeafletMapWidget />
      <StockWidget />
      <WeatherWidget />
      <ImageWidget />
      <EmailWidget />
      <TerminalOverlay />
      <LiveCodingWidget />
      <ResearchWidget />
    </div>
  )
}

export default IndexRoot

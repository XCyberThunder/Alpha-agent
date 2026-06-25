import { useState, useEffect, useRef } from 'react'
import {
  RiMicLine,
  RiMicOffLine,
  RiComputerLine,
  RiCameraLine,
  RiFullscreenLine,
  RiDragMove2Fill,
  RiMessage3Line,
  RiSendPlane2Line,
  RiCloseLine
} from 'react-icons/ri'
import { GiPowerButton } from 'react-icons/gi'
import { alphaService } from '@renderer/services/alpha-voice-ai'
import { getHistory } from '@renderer/services/alpha-ai-brain'
import { VisionMode } from '@renderer/IndexRoot'

interface OverlayProps {
  isSystemActive: boolean
  toggleSystem: () => void
  isMicMuted: boolean
  toggleMic: () => void
  isVideoOn: boolean
  visionMode: VisionMode
  startVision: (mode: 'camera' | 'screen') => void
  stopVision: () => void
}

const MiniOverlay = ({
  isSystemActive,
  toggleSystem,
  isMicMuted,
  toggleMic,
  isVideoOn,
  visionMode,
  startVision,
  stopVision
}: OverlayProps) => {
  const [isTalking, setIsTalking] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isAiTyping, setIsAiTyping] = useState(false)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Uint8Array | any | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSystemActive && alphaService.analyser) {
      analyzerRef.current = alphaService.analyser
      dataArrayRef.current = new Uint8Array(alphaService.analyser.frequencyBinCount)
      const checkAudio = () => {
        if (analyzerRef.current && dataArrayRef.current) {
          analyzerRef.current.getByteFrequencyData(dataArrayRef.current)
          const avg = dataArrayRef.current.reduce((a, b) => a + b) / dataArrayRef.current.length
          setIsTalking(avg > 10)
        }
        if (isSystemActive) requestAnimationFrame(checkAudio)
      }
      checkAudio()
    } else {
      setIsTalking(false)
    }
  }, [isSystemActive])

  useEffect(() => {
    window.electron.ipcRenderer.send('set-overlay-chat-mode', isChatOpen)
  }, [isChatOpen])

  useEffect(() => {
    const fetchHistory = async () => {
      const nextHistory = await getHistory()
      setHistory(Array.isArray(nextHistory) ? nextHistory.slice(-6) : [])
    }
    fetchHistory()
    const interval = setInterval(fetchHistory, 700)
    const typingHandler = (event: Event) => {
      setIsAiTyping(Boolean((event as CustomEvent).detail?.active))
    }
    window.addEventListener('alpha-chat-typing', typingHandler)
    return () => {
      clearInterval(interval)
      window.removeEventListener('alpha-chat-typing', typingHandler)
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, isAiTyping, isChatOpen])

  const handleVisionClick = (mode: 'camera' | 'screen') => {
    if (isVideoOn && visionMode === mode) {
      stopVision()
    } else {
      startVision(mode)
    }
  }

  const expand = () => {
    window.electron.ipcRenderer.send('set-overlay-chat-mode', false)
    window.electron.ipcRenderer.send('toggle-overlay')
  }

  const submitChat = async () => {
    const text = chatInput.trim()
    if (!text || isSending || !isSystemActive) return
    setIsSending(true)
    setIsAiTyping(true)
    const sent = await alphaService.sendTextMessage(text)
    if (sent) setChatInput('')
    setIsSending(false)
    if (!sent) setIsAiTyping(false)
  }

  return (
    <div
      className={`glass-card liquid-panel w-full h-full border-cyan-300/25 drag-region overflow-hidden shadow-[0_0_36px_rgba(34,211,238,0.14)] ${
        isChatOpen ? 'rounded-2xl flex flex-col' : 'rounded-full flex items-center justify-between px-3'
      }`}
    >
      {isChatOpen && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-300/20">
          <span className="text-[10px] font-mono font-bold tracking-widest text-cyan-300 no-drag">
            alpha FLOAT CHAT
          </span>
          <button
            onClick={() => setIsChatOpen(false)}
            className="glass-button no-drag p-1.5 rounded-full text-zinc-400 hover:text-white"
          >
            <RiCloseLine size={14} />
          </button>
        </div>
      )}

      {!isChatOpen ? (
        <>
          <div className="flex items-center gap-3 no-drag">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 ${isSystemActive ? (isTalking ? 'border-white/30 bg-white/10 shadow-[0_0_18px_rgba(34,211,238,0.35)] orb-state-speaking' : 'border-cyan-400/40 bg-cyan-900/20 shadow-[0_0_14px_rgba(34,211,238,0.12)]') : 'border-zinc-700 bg-zinc-900'}`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors duration-300 ${isSystemActive ? (isTalking ? 'bg-cyan-200' : 'bg-cyan-500') : 'bg-red-900'}`}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 no-drag">
            <button
              onClick={() => setIsChatOpen(true)}
              className="glass-button p-2.5 rounded-full text-cyan-300 transition-all"
              title="Open Mini Chat"
            >
              <RiMessage3Line size={18} />
            </button>
            <button
              onClick={toggleMic}
              disabled={!isSystemActive}
              className={`glass-button p-2.5 rounded-full transition-all ml-1 ${!isSystemActive ? 'opacity-30' : isMicMuted ? 'text-red-400 bg-red-500/10' : 'text-cyan-300 bg-cyan-500/10'}`}
            >
              {isMicMuted ? <RiMicOffLine size={18} /> : <RiMicLine size={18} />}
            </button>

            <button
              onClick={toggleSystem}
              className={`p-3 rounded-full border transition-all duration-500 shadow-lg mx-1 ${isSystemActive ? 'bg-cyan-500/20 border-cyan-300/50 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.25)]' : 'bg-zinc-800 border-zinc-600 text-zinc-500 hover:text-red-400'}`}
            >
              <GiPowerButton size={20} className={isSystemActive ? 'animate-pulse' : ''} />
            </button>

            <button
              onClick={() => handleVisionClick('camera')}
              disabled={!isSystemActive}
              className={`glass-button p-2.5 rounded-full transition-all ${!isSystemActive ? 'opacity-30' : isVideoOn && visionMode === 'camera' ? 'text-red-400 bg-red-500/10 animate-pulse border border-red-500/30' : 'text-zinc-300'}`}
              title="Toggle Camera"
            >
              <RiCameraLine size={18} />
            </button>

            <button
              onClick={() => handleVisionClick('screen')}
              disabled={!isSystemActive}
              className={`glass-button p-2.5 rounded-full transition-all ${!isSystemActive ? 'opacity-30' : isVideoOn && visionMode === 'screen' ? 'text-red-400 bg-red-500/10 animate-pulse border border-red-500/30' : 'text-zinc-300'}`}
              title="Toggle Screen"
            >
              <RiComputerLine size={18} />
            </button>
          </div>

          <div className="pl-4 border-l border-cyan-300/20 no-drag flex items-center gap-2">
            <button
              onClick={expand}
              className="glass-button p-2 rounded-full text-zinc-400 hover:text-cyan-300 transition-all"
            >
              <RiFullscreenLine size={16} />
            </button>
            <div className="drag-region cursor-move text-cyan-400/40">
              <RiDragMove2Fill size={14} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div ref={scrollRef} className="no-drag flex-1 overflow-y-auto px-3 py-2 space-y-2 scrollbar-small">
            {history.map((msg, index) => {
              const isUser = msg.role === 'user'
              const text = msg.parts?.[0]?.text || msg.content
              return (
                <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`chat-bubble-glass max-w-[88%] rounded-lg px-3 py-2 text-[10px] font-mono leading-relaxed border ${
                      isUser
                        ? 'bg-cyan-500/10 border-cyan-400/20 text-cyan-50'
                        : 'bg-white/5 border-white/10 text-zinc-300'
                    }`}
                  >
                    {text}
                  </div>
                </div>
              )
            })}
            {isAiTyping && (
              <div className="text-[9px] font-mono tracking-widest text-cyan-300/80 animate-pulse">
                alpha STREAMING...
              </div>
            )}
          </div>
          <div className="no-drag flex items-end gap-2 p-3 border-t border-cyan-300/20">
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submitChat()
                }
              }}
              rows={2}
              disabled={!isSystemActive}
              placeholder={isSystemActive ? 'Quick message...' : 'Activate alpha...'}
              className="glass-input flex-1 resize-none rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-40 scrollbar-small"
            />
            <button
              onClick={submitChat}
              disabled={!isSystemActive || !chatInput.trim() || isSending}
              className="glass-button h-10 w-10 shrink-0 rounded-lg text-cyan-300 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              <RiSendPlane2Line size={17} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default MiniOverlay

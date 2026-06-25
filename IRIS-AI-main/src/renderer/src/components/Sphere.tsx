import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { alphaService } from '@renderer/services/alpha-voice-ai'

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

const CustomParticleSphere = ({
  count = 1800,
  orbState,
  onVolume
}: {
  count?: number
  orbState: OrbState
  onVolume: (volume: number) => void
}) => {
  const mesh = useRef<THREE.Points>(null)
  const lastVolumeNotifyAt = useRef(0)

  const dataArray = useMemo(() => new Uint8Array(128), [])

  const idleColor = useMemo(() => new THREE.Color('#38bdf8'), [])
  const listeningColor = useMemo(() => new THREE.Color('#22d3ee'), [])
  const thinkingColor = useMemo(() => new THREE.Color('#8b5cf6'), [])
  const errorColor = useMemo(() => new THREE.Color('#fb7185'), [])
  const colorTarget = useMemo(() => new THREE.Color(), [])
  const rainbowColor = useMemo(() => new THREE.Color(), [])

  const { positions, originalPositions, spreadFactors, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const orig = new Float32Array(count * 3)
    const spread = new Float32Array(count)
    const col = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const x = Math.random() * 2 - 1
      const y = Math.random() * 2 - 1
      const z = Math.random() * 2 - 1

      const vector = new THREE.Vector3(x, y, z)
      vector.normalize().multiplyScalar(2)

      pos[i * 3] = vector.x
      pos[i * 3 + 1] = vector.y
      pos[i * 3 + 2] = vector.z

      orig[i * 3] = vector.x
      orig[i * 3 + 1] = vector.y
      orig[i * 3 + 2] = vector.z

      spread[i] = Math.random()
      col[i * 3] = 0.2
      col[i * 3 + 1] = 0.9
      col[i * 3 + 2] = 1
    }
    return { positions: pos, originalPositions: orig, spreadFactors: spread, colors: col }
  }, [count])

  useFrame((state, delta) => {
    if (!state.clock.running || !mesh.current) return

    const elapsed = state.clock.elapsedTime
    const speed =
      orbState === 'speaking'
        ? 0.18
        : orbState === 'thinking'
          ? 0.12
          : orbState === 'listening'
            ? 0.08
            : 0.035

    mesh.current.rotation.y += delta * speed
    mesh.current.rotation.z += delta * speed * 0.82

    let volume = 0
    if (alphaService.analyser) {
      alphaService.analyser.getByteFrequencyData(dataArray)

      let sum = 0
      const len = dataArray.length
      for (let i = 0; i < len; i++) {
        sum += dataArray[i]
      }
      volume = sum / len / 128
    }

    const smoothVolume =
      orbState === 'speaking' ? Math.max(volume, 0.14 + Math.sin(elapsed * 3.8) * 0.035) : volume
    if (elapsed - lastVolumeNotifyAt.current > 0.08) {
      lastVolumeNotifyAt.current = elapsed
      onVolume(volume)
    }

    if (orbState === 'speaking') {
      ;(mesh.current.material as THREE.PointsMaterial).color.set('#ffffff')
    } else {
      const base =
        orbState === 'thinking'
          ? thinkingColor
          : orbState === 'listening'
            ? listeningColor
            : orbState === 'error'
              ? errorColor
              : idleColor
      colorTarget.copy(base).lerp(new THREE.Color('#f8fafc'), Math.min(volume * 0.45, 0.35))
      ;(mesh.current.material as THREE.PointsMaterial).color.copy(colorTarget)
    }

    const currentPos = mesh.current.geometry.attributes.position.array as Float32Array
    const currentColors = mesh.current.geometry.attributes.color.array as Float32Array

    for (let i = 0; i < count; i++) {
      const ix = i * 3
      const iy = i * 3 + 1
      const iz = i * 3 + 2

      const breathing =
        orbState === 'speaking'
          ? Math.sin(elapsed * 3.3 + spreadFactors[i] * 7) * 0.026
          : orbState === 'listening'
            ? Math.sin(elapsed * 2.2 + spreadFactors[i] * 3) * 0.018
            : orbState === 'thinking'
              ? Math.sin(elapsed * 3 + spreadFactors[i] * 5) * 0.026
              : 0

      const expansion = 1 + smoothVolume * spreadFactors[i] * 0.42 + breathing

      currentPos[ix] = originalPositions[ix] * expansion
      currentPos[iy] = originalPositions[iy] * expansion
      currentPos[iz] = originalPositions[iz] * expansion

      if (orbState === 'speaking') {
        rainbowColor.setHSL((elapsed * 0.085 + spreadFactors[i] * 0.72) % 1, 0.76, 0.56)
        currentColors[ix] = rainbowColor.r
        currentColors[iy] = rainbowColor.g
        currentColors[iz] = rainbowColor.b
      } else {
        currentColors[ix] = colorTarget.r
        currentColors[iy] = colorTarget.g
        currentColors[iz] = colorTarget.b
      }
    }

    mesh.current.geometry.attributes.position.needsUpdate = true
    mesh.current.geometry.attributes.color.needsUpdate = true
  })

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#00F0FF"
        size={0.012}
        transparent={true}
        opacity={orbState === 'error' ? 0.58 : orbState === 'idle' ? 0.7 : orbState === 'speaking' ? 0.86 : 0.82}
        sizeAttenuation={true}
        vertexColors={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

const Sphere = () => {
  const [isThinking, setIsThinking] = useState(false)
  const [volume, setVolume] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)

  useEffect(() => {
    const handler = (event: Event) => {
      setIsThinking(Boolean((event as CustomEvent).detail?.active))
    }
    window.addEventListener('alpha-chat-typing', handler)
    return () => window.removeEventListener('alpha-chat-typing', handler)
  }, [])

  useEffect(() => {
    if (volume > 0.11) {
      setIsSpeaking(true)
      return
    }
    if (volume < 0.055) {
      const timeout = window.setTimeout(() => setIsSpeaking(false), 120)
      return () => window.clearTimeout(timeout)
    }
    return undefined
  }, [volume])

  const orbState: OrbState = !alphaService.isConnected
    ? 'idle'
    : isSpeaking
      ? 'speaking'
      : isThinking
        ? 'thinking'
        : 'listening'

  return (
    <div className={`orb-frame orb-state-${orbState}`}>
      <Canvas
        camera={{ position: [0, 0, 4.5] }}
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: true }}
        style={{ background: 'transparent' }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.7} />
        <CustomParticleSphere orbState={orbState} onVolume={setVolume} />
      </Canvas>
    </div>
  )
}

export default Sphere

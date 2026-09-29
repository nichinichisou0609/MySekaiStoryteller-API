export interface LipSyncEnvelope {
  values: Float32Array
  frameMs: number
  durationMs: number
}

export function buildLipSyncEnvelope(
  channels: readonly Float32Array[],
  sampleRate: number,
  frameMs = 20
): LipSyncEnvelope {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { values: new Float32Array(0), frameMs: 20, durationMs: 0 }
  }
  frameMs = Number.isFinite(frameMs) ? Math.max(5, frameMs) : 20
  const samples = Math.min(...channels.map((channel) => channel.length))
  const windowSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const rms = new Float32Array(Math.ceil(samples / windowSize))
  for (let frame = 0; frame < rms.length; frame++) {
    const start = frame * windowSize
    const end = Math.min(start + windowSize, samples)
    let energy = 0
    for (const channel of channels) {
      for (let i = start; i < end; i++) energy += channel[i] * channel[i]
    }
    rms[frame] = Math.sqrt(energy / Math.max(1, (end - start) * channels.length))
  }
  const voiced = Array.from(rms).filter((value) => value > 0.008).sort((a, b) => a - b)
  const reference = Math.max(0.06, voiced[Math.floor(voiced.length * 0.9)] ?? 0.06)
  const gate = Math.max(0.008, reference * 0.12)
  const values = new Float32Array(rms.length)
  const smoothWindow = Math.max(1, Math.round(40 / frameMs))
  const levelAt = (index: number): number => {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, index - smoothWindow + 1); j <= index; j++) {
      sum += rms[j]
      count++
    }
    return sum / count
  }
  // 跟随音节强弱但保留起落：40ms 轻微平滑 + 开 90ms / 合 130ms 非对称包络。
  // 连续说话时每秒可见 2~4 次开合，停顿和句读快速闭嘴（静音 60ms）。
  let previous = 0
  let silentFrames = 0
  for (let i = 0; i < rms.length; i++) {
    const level = levelAt(i)
    const quiet = rms[i] <= gate
    silentFrames = quiet ? silentFrames + 1 : 0
    // 短暂能量低谷仍让嘴巴往下走一点；连续静音超过约 80ms 就彻底闭嘴。
    const target = quiet ? 0 : Math.min(0.55, Math.pow((rms[i] - gate) / reference, 0.65) * 0.5)
    const closing = quiet && silentFrames * frameMs >= 80
    const tau = target > previous ? 90 : closing ? 45 : 130
    previous += (target - previous) * (1 - Math.exp(-frameMs / tau))
    if (previous < 0.015) previous = 0
    values[i] = previous
  }
  return { values, frameMs, durationMs: (samples / sampleRate) * 1000 }
}

export function sampleLipSync(envelope: LipSyncEnvelope, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= envelope.durationMs) return 0
  const frame = elapsedMs / envelope.frameMs
  const index = Math.floor(frame)
  const current = envelope.values[index] ?? 0
  const next = envelope.values[index + 1] ?? 0
  return current + (next - current) * (frame - index)
}

export function sampleTextMouth(text: string, elapsedMs: number, durationMs: number): number {
  if (!text || !Number.isFinite(elapsedMs) || elapsedMs < 0 || durationMs <= 0) return 0
  const speechMs = Math.max(1, durationMs - Math.min(800, durationMs * 0.2))
  if (elapsedMs >= speechMs) return 0
  const characters = Array.from(text)
  // 每个音节至少约 170ms：字符映射到慢音节序列，避免逐字快速开合
  const syllableCount = Math.max(2, Math.ceil(speechMs / 170))
  const phase = (elapsedMs / speechMs) * syllableCount
  const syllable = phase - Math.floor(phase)
  const index = Math.min(characters.length - 1, Math.floor((phase / syllableCount) * characters.length))
  const character = characters[index]
  if (/[\s，。！？、；：,.!?;:…—「」『』“”"'（）()]/u.test(character)) return 0
  const attack = Math.min(1, syllable / 0.3)
  const release = Math.max(0, Math.min(1, (0.85 - syllable) / 0.3))
  const intensity = 0.2 + ((character.codePointAt(0) ?? 0) % 7) * 0.016
  return intensity * Math.min(attack, release)
}

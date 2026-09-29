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
  const gate = Math.max(0.008, reference * 0.055)
  const values = new Float32Array(rms.length)
  let previous = 0
  // 先用 ~100ms 滑动平均抹掉音节级能量峰，包络只保留"说话活动度"：
  // 配合慢时间常数（开 200ms / 语中收 260ms），连续说话时每秒至多
  // 1~2 次可见开合；静音仍用 60ms 快收，句读和语音结束及时闭嘴。
  const smoothWindow = Math.max(1, Math.round(100 / frameMs))
  for (let i = 0; i < rms.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - smoothWindow + 1); j <= i; j++) {
      sum += rms[j]
      count++
    }
    const level = sum / count
    const target = level <= gate ? 0 : Math.min(0.55, Math.pow((level - gate) / reference, 0.7) * 0.5)
    const tau = target > previous ? 200 : target === 0 ? 60 : 260
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

import {
  Cubism2InternalModel,
  Cubism4InternalModel,
  Live2DModel,
  MotionPriority
} from 'pixi-live2d-display-advanced'
import AnimationManager from '../managers/AnimationManager'
import PositionRel from '../types/PositionRel'
import { getRandomNumber } from '../utils/HelperUtils'
import { CharacterAction, ModelData } from '../../../common/types/Story'
import { VisualEffectManager } from '../managers/VisualEffectManager'
import { AlphaFilter } from 'pixi.js'
import { ILogObj, Logger } from 'tslog'
import getSubLogger from '../utils/Logger'

/**
 * 素材库里混有两种 Cubism 参数 ID 命名：Cubism2 风格全大写下划线（PARAM_ARM_R_1）
 * 与 Cubism4 驼峰（ParamArmR1）。ID 与模型对不上的动作会正常"启动"（startMotion
 * 返回 true），但写不进任何模型参数——表现为动作完全无响应。同一别名组内的 ID
 * 指同一逻辑参数；加载动作时按模型实际 ID 集合归一化。
 */
const MOTION_ID_ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ['PARAM_ANGLE_X', 'ParamAngleX'],
  ['PARAM_ANGLE_Y', 'ParamAngleY'],
  ['PARAM_ANGLE_Z', 'ParamAngleZ'],
  ['PARAM_EYE_L_OPEN', 'ParamEyeLOpen'],
  ['PARAM_EYE_R_OPEN', 'ParamEyeROpen'],
  ['PARAM_EYE_BALL_X', 'ParamEyeBallX', 'ParamEyeballX'],
  ['PARAM_EYE_BALL_Y', 'ParamEyeBallY', 'ParamEyeballY'],
  ['PARAM_EYE_L_SMILE', 'ParamEyeLSmile'],
  ['PARAM_EYE_R_SMILE', 'ParamEyeRSmile'],
  ['PARAM_BROW_L_X', 'ParamBrowLX'],
  ['PARAM_BROW_R_X', 'ParamBrowRX'],
  ['PARAM_BROW_L_Y', 'ParamBrowLY'],
  ['PARAM_BROW_R_Y', 'ParamBrowRY'],
  ['PARAM_BROW_L_FORM', 'ParamBrowLForm'],
  ['PARAM_BROW_R_FORM', 'ParamBrowRForm'],
  ['PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY'],
  ['PARAM_MOUTH_FORM', 'ParamMouthForm'],
  ['PARAM_BODY_ANGLE_X', 'ParamBodyAngleX'],
  ['PARAM_BODY_ANGLE_Y', 'ParamBodyAngleY'],
  ['PARAM_BODY_ANGLE_Z', 'ParamBodyAngleZ'],
  ['PARAM_BREATH', 'ParamBreath'],
  ['PARAM_POSITION_X', 'ParamPositionX'],
  ['PARAM_POSITION_Y', 'ParamPositionY'],
  ['PARAM_ROTATION_Z', 'ParamRotationZ'],
  ['PARAM_UPPER_BODY', 'ParamUpperBody'],
  ['PARAM_UPPER_BODY_Z', 'ParamUpperBodyZ'],
  ['PARAM_SHOULDER_L', 'ParamShoulderL'],
  ['PARAM_SHOULDER_R', 'ParamShoulderR'],
  ['PARAM_LEG_L_Z', 'ParamLegLZ'],
  ['PARAM_LEG_R_Z', 'ParamLegRZ'],
  ['PARAM_FINGER_L', 'ParamFingerL'],
  ['PARAM_FINGER_R', 'ParamFingerR']
]

const MOTION_PARAMETER_ID_ALIASES: Map<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>()
  const add = (group: readonly string[]): void => {
    for (const id of group) map.set(id, group.filter((candidate) => candidate !== id))
  }
  for (const group of MOTION_ID_ALIAS_GROUPS) add(group)
  for (let i = 1; i <= 9; i++) {
    add([`PARAM_ARM_L_${i}`, `ParamArmL${i}`])
    add([`PARAM_ARM_R_${i}`, `ParamArmR${i}`])
  }
  for (const suffix of 'ABCDEFGHIJK') {
    add([`PARAM_HAND_L_${suffix}`, `ParamHandL${suffix}`])
    add([`PARAM_HAND_R_${suffix}`, `ParamHandR${suffix}`])
  }
  return map
})()

export default class AdvancedModel extends Live2DModel {
  public autoBlink: boolean = true
  public lastChangeBlinkTime: number | null = null
  public readonly visualEffectManager: VisualEffectManager = new VisualEffectManager(this)
  private blinkTimerId: ReturnType<typeof setTimeout> | null = null
  private blinkGeneration = 0
  private readonly channelGeneration = [0, 0]
  private bodyIgnoredParamIds: string[] = []
  private restoreBodyUpdate: (() => void) | null = null
  private readonly actionController = new AbortController()
  private defaultMotionName: string | null = null
  private bodyIdleFallbackArmed = false
  private bodyIdleFallbackGeneration = -1

  /** Aborted when this model is destroyed; suitable for a snippet action scope. */
  public get actionSignal(): AbortSignal {
    return this.actionController.signal
  }

  private _metadata: ModelData | null = null

  private inHologram: boolean = false

  private logger: Logger<ILogObj> = getSubLogger('AdvancedModel[Uninitialized]')

  get metadata(): ModelData {
    return this._metadata!
  }

  public initialize(metadata: ModelData): void {
    if (!this._metadata) {
      this._metadata = metadata
    } else {
      throw new Error('Initialize model metadata more than once.')
    }
    this.visible = true
    this.internalModel.extendParallelMotionManager(2)
    this.installMotionIdNormalization()
    this.installBodyParameterIsolation()

    this.internalModel.parallelMotionManager[0].stopAllMotions()
    this.internalModel.parallelMotionManager[1].stopAllMotions()

    const motionManager = this.internalModel.motionManager
    const groups = motionManager.motionGroups
    const defaultMotion = groups && groups['w-normal-default01'] ? 'w-normal-default01' : null
    const defaultFacial = groups && groups['face_normal_01'] ? 'face_normal_01' : null
    this.defaultMotionName = defaultMotion

    if (defaultMotion) {
      this.internalModel.parallelMotionManager[0].startMotion(
        defaultMotion,
        0,
        MotionPriority.FORCE
      )
    }
    if (defaultFacial) {
      this.internalModel.parallelMotionManager[1].startMotion(
        defaultFacial,
        0,
        MotionPriority.FORCE
      )
    }

    const alpha_filter = new AlphaFilter(0)
    alpha_filter.resolution = 2

    this.filters = [alpha_filter]

    this.anchor.x = 0.5
    this.anchor.y = this.metadata.anchor

    this.visualEffectManager.createAll()

    this.logger = getSubLogger(`AdvancedModel(${this._metadata.id})`)
  }

  /**
   * Wrap loadMotion so every loaded clip gets its curve ids normalized to the
   * model's actual parameter ids. Runs once per cached motion object (loadMotion
   * memoizes), before the clip is ever started.
   */
  private installMotionIdNormalization(): void {
    const internal = this.internalModel
    if (!(internal instanceof Cubism4InternalModel)) return
    const core = internal.coreModel as unknown as {
      _parameterIds?: string[]
      parameters?: { ids?: string[] }
    }
    const modelIds = core._parameterIds ?? core.parameters?.ids
    if (!modelIds?.length) return
    const idSet = new Set(modelIds)
    const motionManager = internal.motionManager
    const originalLoad = motionManager.loadMotion.bind(motionManager)
    motionManager.loadMotion = (group: string, index: number) =>
      Promise.resolve(originalLoad(group, index)).then((motion) => {
        if (motion) this.normalizeMotionParameterIds(motion, idSet)
        return motion
      })
  }

  private normalizeMotionParameterIds(motion: unknown, modelIds: Set<string>): void {
    const data = (motion as { _motionData?: { curves?: Array<{ id: string }> } })._motionData
    if (!data?.curves) return
    for (const curve of data.curves) {
      const id = curve.id
      if (!id || modelIds.has(id)) continue
      for (const candidate of MOTION_PARAMETER_ID_ALIASES.get(id) ?? []) {
        if (modelIds.has(candidate)) {
          curve.id = candidate
          break
        }
      }
    }
  }

  /**
   * The dependency implements ignoreParamIds by deleting cached motion curves.
   * Preserve parameters around body updates instead, leaving every clip reusable.
   */
  private installBodyParameterIsolation(): void {    const manager = this.internalModel.parallelMotionManager[0]
    const originalUpdate = manager.update
    manager.update = (core, now): boolean => {
      const internal = this.internalModel
      const values = this.bodyIgnoredParamIds.map((id) => ({
        id,
        value:
          internal instanceof Cubism4InternalModel
            ? internal.coreModel.getParameterValueById(id)
            : internal instanceof Cubism2InternalModel
              ? internal.coreModel.getParamFloat(id)
              : 0
      }))
      let updated: boolean
      try {
        updated = originalUpdate.call(manager, core, now)
      } finally {
        for (const { id, value } of values) {
          if (internal instanceof Cubism4InternalModel) {
            internal.coreModel.setParameterValueById(id, value)
          } else if (internal instanceof Cubism2InternalModel) {
            internal.coreModel.setParamFloat(id, value)
          }
        }
      }
      this.maybeStartBodyIdleFallback()
      return updated
    }
    this.restoreBodyUpdate = () => {
      manager.update = originalUpdate
    }
  }

  /**
   * PJSK 的动作素材是一次性播放：播完 Duration 秒后队列判结束、参数停更，
   * 角色会一直僵在最后一帧（观感即"动一下就站桩"）。武装标志由动作 cue 与
   * 入场结束设置；body 通道一旦空闲就重启默认待机动作（入场/退场同款的自然
   * 站立循环），直到下一个 cue 或退场接管。代数检查保证回落永不覆盖新 cue，
   * legacy 的 waitForMotionsFinished 路径通过 applyMotion 的 disarm 保持原语义。
   */
  private maybeStartBodyIdleFallback(): void {
    if (!this.bodyIdleFallbackArmed) return
    const internal = this.internalModel
    const manager = internal?.parallelMotionManager[0]
    if (!internal || !manager || this.destroyed) return
    if (!manager.isFinished() || manager.playing) return
    this.bodyIdleFallbackArmed = false
    if (this.bodyIdleFallbackGeneration !== this.channelGeneration[0]) return
    if (!this.defaultMotionName) return
    const alpha = (this.filters?.[0] as AlphaFilter | undefined)?.alpha ?? 0
    if (alpha <= 0.01) return
    queueMicrotask(() => {
      void this.startCharacterChannel(0, this.defaultMotionName as string, [], undefined, undefined, true)
    })
  }

  /** 动作 cue 开始时调用：该动作播完后回落到默认待机，而不是僵住。 */
  private armBodyIdleFallback(generation: number): void {
    this.bodyIdleFallbackArmed = true
    this.bodyIdleFallbackGeneration = generation
  }

  /** 入场动作播完后调用：body 通道进入默认待机循环，角色在台词间保持自然站立。 */
  public startBodyIdleLoop(): void {
    this.bodyIdleFallbackGeneration = this.channelGeneration[0]
    this.bodyIdleFallbackArmed = true
  }

  private eyeParameterIds(): string[] {
    return this.internalModel instanceof Cubism2InternalModel
      ? ['PARAM_EYE_R_OPEN', 'PARAM_EYE_L_OPEN', 'PARAM_EYE_BALL_X', 'PARAM_EYE_BALL_Y']
      : ['ParamEyeROpen', 'ParamEyeLOpen', 'ParamEyeBallX', 'ParamEyeBallY']
  }

  private async startCharacterChannel(
    channel: 0 | 1,
    name: string,
    ignoredParamIds: string[] = [],
    signal?: AbortSignal,
    canApply?: () => boolean,
    armIdleFallback = false
  ): Promise<void> {
    const generation = ++this.channelGeneration[channel]
    if (channel === 0) {
      // legacy 入场/退场/标量 Motion 播完需要"等播完"的原语义，必须解除回落武装；
      // 只有动作 cue（armIdleFallback=true）才在播完后回落待机。
      this.bodyIdleFallbackArmed = armIdleFallback
      if (armIdleFallback) this.bodyIdleFallbackGeneration = generation
    }
    const internal = this.internalModel
    if (!internal || this.destroyed || signal?.aborted || this.actionSignal.aborted) return
    const manager = internal.parallelMotionManager[channel]
    // Invalidate older asynchronous reservations without stopping the currently playing clip.
    manager.state.setReserved(undefined, undefined, 0)
    const motion = await internal.motionManager.loadMotion(name, 0)
    if (
      !motion ||
      this.destroyed ||
      this.actionSignal.aborted ||
      signal?.aborted ||
      generation !== this.channelGeneration[channel] ||
      (canApply && !canApply())
    ) {
      return
    }
    if (channel === 0) this.bodyIgnoredParamIds = ignoredParamIds
    // Restarting the same named clip is intentional for consecutive cues. Only reset
    // this channel: a body cue must never clear a listener's facial expression.
    manager.stopAllMotions()
    const invalidateReservation = (): void => {
      if (generation === this.channelGeneration[channel] && !this.destroyed) {
        manager.state.setReserved(undefined, undefined, 0)
      }
    }
    signal?.addEventListener('abort', invalidateReservation, { once: true })
    try {
      await manager.startMotion(name, 0, MotionPriority.FORCE)
    } finally {
      signal?.removeEventListener('abort', invalidateReservation)
    }
  }

  public async applyMotion(
    motion: string,
    ignoreParams: boolean = false,
    extraIgnoreParamIds: string[] = []
  ): Promise<void> {
    await this.startCharacterChannel(0, motion, [
      ...(ignoreParams ? this.eyeParameterIds() : []),
      ...extraIgnoreParamIds
    ])
  }

  public async applyFacial(facial: string): Promise<void> {
    await this.startCharacterChannel(1, facial)
  }

  /** Start independent channels, preserving any omitted channel. Never changes visibility. */
  public async applyCharacterAction(
    action: Pick<CharacterAction, 'motion' | 'facial'>,
    signal?: AbortSignal,
    canApply?: () => boolean
  ): Promise<void> {
    const tasks: Promise<void>[] = []
    if (action.motion) {
      tasks.push(
        this.startCharacterChannel(
          0,
          action.motion,
          [
            ...this.eyeParameterIds(),
            this.internalModel instanceof Cubism2InternalModel ? 'PARAM_MOUTH_OPEN_Y' : 'ParamMouthOpenY'
          ],
          signal,
          canApply,
          // 该手势播完后回落默认待机：连续 cue 之间角色保持自然站立，不再僵在最后一帧。
          true
        )
      )
    }
    if (action.facial) tasks.push(this.startCharacterChannel(1, action.facial, [], signal, canApply))
    await Promise.all(tasks)
  }

  /** Cancel only queued loads/reservations, retaining the current visible pose. */
  public cancelPendingActions(): void {
    this.bodyIdleFallbackArmed = false
    for (const channel of [0, 1] as const) {
      this.channelGeneration[channel]++
      this.internalModel?.parallelMotionManager[channel]?.state.setReserved(undefined, undefined, 0)
    }
  }

  public async show(time: number, hologram: boolean): Promise<void> {
    this.autoBlink = true

    if (hologram) {
      this.inHologram = true
      this.visualEffectManager.applyEffect('hologram')
      this.visualEffectManager.applyEffect('triangles')
    }

    await AnimationManager.linear((progress) => {
      const alpha_filter: AlphaFilter = this.filters![0] as AlphaFilter
      alpha_filter.alpha = progress
    }, time)

    this.lastChangeBlinkTime = Date.now()
    const generation = ++this.blinkGeneration
    if (this.blinkTimerId !== null) clearTimeout(this.blinkTimerId)
    this.blinkTimerId = setTimeout(() => this.updateAutoBlink(generation), getRandomNumber(4000, 6500))
  }

  public async hide(time: number): Promise<void> {
    await AnimationManager.linear((progress) => {
      const alpha_filter: AlphaFilter = this.filters![0] as AlphaFilter
      alpha_filter.alpha = 1 - progress
    }, time)

    if (this.inHologram) {
      this.inHologram = false
      this.visualEffectManager.disableAll()
    }

    this.lastChangeBlinkTime = Date.now()
    this.autoBlink = false
    this.blinkGeneration++
    this.cancelPendingActions()
    if (this.blinkTimerId !== null) {
      clearTimeout(this.blinkTimerId)
      this.blinkTimerId = null
    }
  }

  /**
   * 仅启动动作/表情：返回时动作文件已加载并开始播放（尚未播完）。
   * 供"动作必须与移动同时进行"的场景先启动动作、再启动移动，杜绝滑入滑出时的站桩空窗。
   */
  public async startMotions(motion?: string, facial?: string, facialFirst?: boolean): Promise<void> {
    // 确保模型已完全加载
    if (!this.internalModel) {
      this.logger.warn('Model not fully loaded, waiting...')
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const waits: Promise<void>[] = []
    if (motion) {
      waits.push(this.applyMotion(motion, facialFirst))
    }
    if (facial) {
      waits.push(this.applyFacial(facial))
    }

    this.lastChangeBlinkTime = Date.now()

    await Promise.all(waits)
  }

  /** 等待当前身体动作与表情全部播完（导出模式 15s 超时兜底） */
  public async waitForMotionsFinished(): Promise<void> {
    const motion_manager = this.internalModel.parallelMotionManager[0]
    const facial_manager = this.internalModel.parallelMotionManager[1]

    const isExport = AnimationManager.isExporting()
    const timeoutMs = isExport ? 15000 : 0

    if (isExport && timeoutMs > 0) {
      const startTime = performance.now()
      let timedOut = false
      await AnimationManager.in_ticker(
        () => {},
        () => {
          if (timedOut) return true
          if (performance.now() - startTime > timeoutMs) {
            this.logger.warn('waitForMotionsFinished timed out, forcing continue')
            timedOut = true
            try {
              motion_manager.stopAllMotions()
              facial_manager.stopAllMotions()
            } catch (e) {
              this.logger.warn('Failed to stop motions after timeout', e)
            }
            return true
          }
          return motion_manager.isFinished() && facial_manager.isFinished()
        }
      )
    } else {
      await AnimationManager.in_ticker(
        () => {},
        () => motion_manager.isFinished() && facial_manager.isFinished()
      )
    }

    this.lastChangeBlinkTime = Date.now()
  }

  public async applyAndWait(
    motion?: string,
    facial?: string,
    facialFirst?: boolean
  ): Promise<void> {
    await this.startMotions(motion, facial, facialFirst)
    await this.waitForMotionsFinished()
  }

  public setPositionRel(stage_size: [number, number], position: PositionRel): void {
    this.position.set(stage_size[0] * position.x, stage_size[1] * (position.y + 0.3))
  }

  public async move(
    stage_size: [number, number],
    from: PositionRel,
    to: PositionRel,
    time_ms: number
  ): Promise<void> {
    if (from.x === to.x && from.y === to.y) return

    const abs_from: [number, number] = [stage_size[0] * from.x, stage_size[1] * (from.y + 0.3)]
    const abs_to: [number, number] = [stage_size[0] * to.x, stage_size[1] * (to.y + 0.3)]

    await AnimationManager.linear((progress) => {
      this.position.x = (abs_to[0] - abs_from[0]) * progress + abs_from[0]
      this.position.y = (abs_to[1] - abs_from[1]) * progress + abs_from[1]
    }, time_ms)
  }

  public async playMotionLastFrame(motion?: string, facial?: string): Promise<void> {
    const motion_manager = this.internalModel.parallelMotionManager[0]
    const facial_manager = this.internalModel.parallelMotionManager[1]

    const waits: Promise<unknown>[] = []

    if (motion) {
      waits.push(motion_manager.playMotionLastFrame(motion, 0))
    }

    if (facial) {
      waits.push(facial_manager.playMotionLastFrame(facial, 0))
    }

    const results = (await Promise.all(waits)) as boolean[]

    if (results.includes(false)) {
      await this.applyAndWait(motion, facial)
    } else {
      const isExport = AnimationManager.isExporting()
      const timeoutMs = isExport ? 15000 : 0

      if (isExport && timeoutMs > 0) {
        const startTime = performance.now()
        let timedOut = false
        await AnimationManager.in_ticker(
          () => {},
          () => {
            if (timedOut) return true
            if (performance.now() - startTime > timeoutMs) {
              this.logger.warn(
                `playMotionLastFrame timed out after ${timeoutMs}ms, forcing continue`
              )
              timedOut = true
              try {
                motion_manager.stopAllMotions()
                facial_manager.stopAllMotions()
              } catch (e) {
                this.logger.warn('Failed to stop motions after timeout', e)
              }
              return true
            }
            return motion_manager.isFinished() && facial_manager.isFinished()
          }
        )
      } else {
        await AnimationManager.in_ticker(
          () => {},
          () => motion_manager.isFinished() && facial_manager.isFinished()
        )
      }
    }
  }

  public async closeEyes(time_ms: number): Promise<void> {
    await AnimationManager.linear((progress) => {
      if (this.internalModel instanceof Cubism2InternalModel) {
        this.internalModel.eyeBlink?.setEyeParams(1 - progress)
      } else if (this.internalModel instanceof Cubism4InternalModel) {
        this.internalModel.coreModel?.setParameterValueById('ParamEyeLOpen', 1 - progress)
        this.internalModel.coreModel?.setParameterValueById('ParamEyeROpen', 1 - progress)
      } else {
        throw new Error('Not implement.')
      }
    }, time_ms)
  }

  public async openEyes(time_ms: number, max_value: number = 1): Promise<void> {
    await AnimationManager.linear((progress) => {
      if (this.internalModel instanceof Cubism2InternalModel) {
        this.internalModel.eyeBlink?.setEyeParams(progress * max_value)
      } else if (this.internalModel instanceof Cubism4InternalModel) {
        this.internalModel.coreModel?.setParameterValueById('ParamEyeLOpen', progress * max_value)
        this.internalModel.coreModel?.setParameterValueById('ParamEyeROpen', progress * max_value)
      } else {
        throw new Error('Not implement.')
      }
    }, time_ms)
  }

  public override destroy(options?: Parameters<Live2DModel['destroy']>[0]): void {
    if (this.destroyed) return
    this.actionController.abort()
    this.cancelPendingActions()
    this.autoBlink = false
    this.blinkGeneration++
    if (this.blinkTimerId !== null) clearTimeout(this.blinkTimerId)
    this.blinkTimerId = null
    this.restoreBodyUpdate?.()
    this.restoreBodyUpdate = null
    this.visualEffectManager.disableAll()
    super.destroy(options)
  }

  private async updateAutoBlink(generation: number): Promise<void> {
    while (this.autoBlink && generation === this.blinkGeneration && !this.destroyed) {
      const now = Date.now()
      if (this.lastChangeBlinkTime && now - this.lastChangeBlinkTime < 2500) {
        await AnimationManager.delay(500)
        continue
      }

      if (this.internalModel instanceof Cubism2InternalModel) {
        if (!this.internalModel.coreModel) {
          this.logger.warn('coreModel is undefined, stopping auto blink')
          this.autoBlink = false
          return
        }
        if (
          this.internalModel.coreModel.getParamFloat('PARAM_EYE_L_OPEN') < 1 ||
          this.internalModel.coreModel.getParamFloat('PARAM_EYE_R_OPEN') < 1
        ) {
          this.logger.info('Blink has been blocked by eye param')
          await AnimationManager.delay(getRandomNumber(4000, 6500))
          continue
        }
      } else if (this.internalModel instanceof Cubism4InternalModel) {
        if (!this.internalModel.coreModel) {
          this.logger.warn('coreModel is undefined, stopping auto blink')
          this.autoBlink = false
          return
        }
        if (
          this.internalModel.coreModel.getParameterValueById('ParamEyeLOpen') < 1 ||
          this.internalModel.coreModel.getParameterValueById('ParamEyeROpen') < 1
        ) {
          this.logger.info('Blink has been blocked by eye param')
          await AnimationManager.delay(getRandomNumber(4000, 6500))
          continue
        }
      } else {
        throw new Error('Not implement.')
      }

      await this.closeEyes(200)
      await this.openEyes(250)

      this.lastChangeBlinkTime = Date.now()

      await AnimationManager.delay(getRandomNumber(4000, 6500))
    }
  }
}

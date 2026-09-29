import BaseLayer from './BaseLayer'
import { Application } from 'pixi.js'
import { LayoutModes } from '../../../common/types/Story'
import AdvancedModel from '../model/AdvancedModel'

export default class ModelLayer extends BaseLayer {
  public layoutMode: LayoutModes = LayoutModes.Normal

  constructor(app: Application) {
    super(app, 1)
  }

  public addModelToLayer(model: AdvancedModel): void {
    if (this.layerContainer.children.includes(model)) return

    const scale = this.app.screen.height / model.internalModel.originalHeight
    model.scale.set(
      scale *
        (this.layoutMode === LayoutModes.Normal
          ? model.metadata.normal_scale
          : model.metadata.small_scale)
    )

    this.layerContainer.addChild(model)
  }

  public removeModel(model: AdvancedModel): void {
    this.layerContainer.removeChild(model)
  }

  /** Read-only membership/opacity query for timed character cues. */
  public isModelVisible(modelId: number): boolean {
    const model = this.layerContainer.children.find((child) => {
      const candidate = child as AdvancedModel
      return candidate.metadata?.id === modelId
    }) as AdvancedModel | undefined
    if (!model || !model.visible) return false
    const alpha = (model.filters?.[0] as { alpha?: number } | undefined)?.alpha
    return alpha === undefined || alpha > 0.01
  }
}

/**
 * Live2D manager using PixiJS + pixi-live2d-display.
 *
 * Loads Cubism 2/3/4 models from .model3.json files.
 * Falls back to the OrbAnimator when no model is available.
 *
 * Usage:
 *   const mgr = new Live2DManager(canvasElement);
 *   await mgr.loadModel('path/to/model.model3.json');
 *   mgr.setMotion('idle');
 */
class Live2DManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.app = null;
    this.model = null;
    this.loaded = false;
    this.currentMotion = 'idle';

    // Motion group mapping: state -> motion group name
    // These are conventional names; users can configure per-model
    // Motion group mapping: app state -> model motion group
    // Hiyori only has Idle and TapBody, so map states to what's available
    this.motionMap = {
      idle: 'Idle',
      listening: 'TapBody',   // Use TapBody for active states
      thinking: 'Idle',
      speaking: 'TapBody',
      followup: 'Idle',
    };
  }

  /** Initialize PixiJS application on the canvas. */
  init() {
    if (this.app) return;

    // Check if PIXI is available
    if (typeof PIXI === 'undefined') {
      console.warn('[Live2D] PixiJS not loaded, skipping init');
      return;
    }

    // Ensure canvas has pixel dimensions
    if (!this.canvas.width || this.canvas.width < 10) {
      const parent = this.canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        this.canvas.width = Math.round(rect.width) || 330;
        this.canvas.height = Math.round(rect.height) || 400;
      }
    }

    this.app = new PIXI.Application({
      view: this.canvas,
      transparent: true,
      autoStart: true,
      width: this.canvas.width,
      height: this.canvas.height,
      antialias: true,
    });

    console.log('[Live2D] PixiJS initialized');
  }

  /**
   * Load a Live2D model from a .model3.json path.
   * @param {string} modelPath - Path to the model JSON file
   */
  async loadModel(modelPath) {
    if (!this.app) this.init();
    if (!this.app) return false;

    // Check if pixi-live2d-display is available
    if (typeof PIXI.live2d === 'undefined' && typeof PIXI.Live2DModel === 'undefined') {
      console.warn('[Live2D] pixi-live2d-display not loaded');
      return false;
    }

    try {
      // Remove previous model
      if (this.model) {
        this.app.stage.removeChild(this.model);
        this.model.destroy();
        this.model = null;
      }

      const Live2DModel = PIXI.live2d?.Live2DModel || PIXI.Live2DModel;
      this.model = await Live2DModel.from(modelPath);

      // Scale to fit canvas
      const scale = Math.min(
        this.canvas.width / this.model.width,
        this.canvas.height / this.model.height
      ) * 0.8;

      this.model.scale.set(scale);
      this.model.anchor.set(0.5, 0.5);
      this.model.x = this.canvas.width / 2;
      this.model.y = this.canvas.height / 2;

      this.app.stage.addChild(this.model);
      this.loaded = true;

      console.log('[Live2D] Model loaded:', modelPath);

      // Start idle motion
      this.setMotion('idle');
      return true;
    } catch (error) {
      console.error('[Live2D] Failed to load model:', error);
      this.loaded = false;
      return false;
    }
  }

  /** Switch motion/animation state. */
  setMotion(state) {
    this.currentMotion = state;

    if (!this.model || !this.loaded) return;

    const motionGroup = this.motionMap[state] || this.motionMap.idle;

    try {
      // Try to play the motion group
      if (this.model.internalModel?.motionManager) {
        this.model.internalModel.motionManager.startMotion(motionGroup, 0);
      } else if (this.model.motion) {
        this.model.motion(motionGroup, 0);
      }
    } catch (_) {
      // Motion not found — silently ignore
    }
  }

  /**
   * Update lip sync based on audio amplitude (0-1).
   * @param {number} value - Amplitude value 0..1
   */
  setLipSync(value) {
    if (!this.model || !this.loaded) return;

    try {
      const coreModel = this.model.internalModel?.coreModel;
      if (coreModel) {
        // ParamMouthOpenY is the standard Cubism parameter for mouth open
        coreModel.setParameterValueById('ParamMouthOpenY', value);
      }
    } catch (_) {
      // Parameter not found
    }
  }

  /** Check if a model is loaded and rendering. */
  get isLoaded() {
    return this.loaded && this.model !== null;
  }

  /** Destroy the PixiJS app and free resources. */
  destroy() {
    if (this.model) {
      this.app?.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }
    if (this.app) {
      this.app.destroy();
      this.app = null;
    }
    this.loaded = false;
  }
}

window.Live2DManager = Live2DManager;

/**
 * Live2D Manager v2 — Full interactive character system
 *
 * Features:
 * - Loads Cubism 4 models via pixi-live2d-display (bundled in cubism4.min.js)
 * - Mouse/cursor tracking (eyes follow pointer)
 * - Lip sync from TTS audio amplitude
 * - State-driven motion system (idle, thinking, speaking, listening)
 * - Click/tap interactions with hit area detection
 * - Auto-breathing, eye blink (built into Cubism runtime)
 * - Expression support
 * - Idle motion loop with random selection
 */
class Live2DManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.app = null;
    this.model = null;
    this.loaded = false;
    this.currentState = 'idle';
    this._destroyed = false;

    // Motion group mapping: app state → model motion group
    this.motionMap = {
      idle: 'Idle',
      listening: 'Idle',
      thinking: 'Idle',
      speaking: 'TapBody',
    };

    // Lip sync state
    this._lipSyncValue = 0;
    this._lipSyncTarget = 0;
    this._lipSyncSmoothing = 0.3; // smoothing factor

    // Mouse tracking state
    this._mouseX = 0;
    this._mouseY = 0;
    this._trackingEnabled = true;

    // Idle motion timer
    this._idleTimer = null;
    this._idleIntervalMs = 8000; // random idle motion every ~8s

    // Parameter IDs (Cubism standard)
    this.PARAM = {
      ANGLE_X: 'ParamAngleX',
      ANGLE_Y: 'ParamAngleY',
      ANGLE_Z: 'ParamAngleZ',
      EYE_BALL_X: 'ParamEyeBallX',
      EYE_BALL_Y: 'ParamEyeBallY',
      BODY_ANGLE_X: 'ParamBodyAngleX',
      MOUTH_OPEN_Y: 'ParamMouthOpenY',
      MOUTH_FORM: 'ParamMouthForm',
    };

    // Bind handlers
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onCanvasClick = this._handleCanvasClick.bind(this);
    this._onUpdate = this._handleUpdate.bind(this);
  }

  /** Initialize PixiJS application on the canvas. */
  init() {
    if (this.app || this._destroyed) return;

    if (typeof PIXI === 'undefined') {
      console.warn('[Live2D] PixiJS not loaded, skipping init');
      return;
    }

    // Ensure canvas has dimensions
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

    // Add update loop for lip sync + custom tracking
    this.app.ticker.add(this._onUpdate);

    // Mouse tracking
    document.addEventListener('mousemove', this._onMouseMove);

    // Click interaction
    this.canvas.addEventListener('click', this._onCanvasClick);

    console.log('[Live2D v2] PixiJS initialized');
  }

  /**
   * Load a Live2D model from a .model3.json path.
   * @param {string} modelPath - Path to the model JSON file
   */
  async loadModel(modelPath) {
    if (!this.app) this.init();
    if (!this.app) return false;

    const Live2DModel = PIXI.live2d?.Live2DModel || PIXI.Live2DModel;
    if (!Live2DModel) {
      console.warn('[Live2D] pixi-live2d-display not available');
      return false;
    }

    try {
      // Remove previous model
      if (this.model) {
        this.app.stage.removeChild(this.model);
        this.model.destroy();
        this.model = null;
      }

      this.model = await Live2DModel.from(modelPath, {
        autoInteract: false, // we handle interaction ourselves
      });

      // Scale to fit canvas with some padding
      const scale = Math.min(
        this.canvas.width / this.model.width,
        this.canvas.height / this.model.height
      ) * 0.85;

      this.model.scale.set(scale);
      this.model.anchor.set(0.5, 0.5);
      this.model.x = this.canvas.width / 2;
      this.model.y = this.canvas.height / 2;

      // Enable interaction on the model
      this.model.interactive = true;
      this.model.buttonMode = true;

      // Hit area click handler
      this.model.on('hit', (hitAreas) => {
        console.log('[Live2D] Hit areas:', hitAreas);
        if (hitAreas.includes('Body') || hitAreas.includes('body')) {
          this._playMotion('TapBody', 0);
        }
        if (hitAreas.includes('Head') || hitAreas.includes('head')) {
          this._playRandomExpression();
        }
      });

      this.app.stage.addChild(this.model);
      this.loaded = true;

      // Log available motions and expressions
      this._logModelInfo();

      // Start idle motion loop
      this._startIdleLoop();

      console.log('[Live2D v2] Model loaded:', modelPath);
      return true;
    } catch (error) {
      console.error('[Live2D] Failed to load model:', error);
      this.loaded = false;
      return false;
    }
  }

  /** Log model info for debugging */
  _logModelInfo() {
    if (!this.model?.internalModel) return;
    const settings = this.model.internalModel.settings;
    console.log('[Live2D] Motions:', settings.motions ? Object.keys(settings.motions) : 'none');
    console.log('[Live2D] Expressions:', settings.expressions?.length || 0);
    console.log('[Live2D] Hit areas:', settings.hitAreas?.map(h => h.Name) || 'none');
  }

  // ===== State Management =====

  /**
   * Set app state (idle, listening, thinking, speaking).
   * Triggers appropriate motion/expression.
   */
  setState(state) {
    if (this.currentState === state) return;
    const prevState = this.currentState;
    this.currentState = state;

    if (!this.model || !this.loaded) return;

    switch (state) {
      case 'speaking':
        // Play a lively motion for speaking
        this._playMotion(this.motionMap.speaking);
        // Smile while talking
        this._setParam(this.PARAM.MOUTH_FORM, 0.8);
        break;

      case 'thinking':
        // Subtle motion
        this._playMotion(this.motionMap.thinking);
        // Neutral mouth
        this._setParam(this.PARAM.MOUTH_FORM, 0);
        break;

      case 'listening':
        this._playMotion(this.motionMap.listening);
        break;

      case 'idle':
      default:
        // Return to idle
        if (prevState === 'speaking') {
          // Close mouth
          this._lipSyncTarget = 0;
        }
        this._setParam(this.PARAM.MOUTH_FORM, 0.3); // slight smile
        this._playMotion(this.motionMap.idle);
        break;
    }
  }

  // Alias for app.js compatibility
  setMotion(state) {
    this.setState(state);
  }

  // ===== Lip Sync =====

  /**
   * Update lip sync based on audio amplitude (0-1).
   * Call this continuously during TTS playback.
   * @param {number} value - Amplitude value 0..1
   */
  setLipSync(value) {
    this._lipSyncTarget = Math.min(1, Math.max(0, value));
  }

  /**
   * Set lip sync from audio analyser data.
   * @param {Uint8Array} frequencyData - from AnalyserNode.getByteFrequencyData
   */
  setLipSyncFromAnalyser(frequencyData) {
    if (!frequencyData || frequencyData.length === 0) return;
    // Average the lower frequencies (voice range ~85-300Hz)
    const voiceRange = Math.min(frequencyData.length, 10);
    let sum = 0;
    for (let i = 0; i < voiceRange; i++) {
      sum += frequencyData[i];
    }
    const avg = sum / voiceRange / 255;
    this.setLipSync(avg);
  }

  // ===== Mouse Tracking =====

  _handleMouseMove(e) {
    if (!this._trackingEnabled || !this.model || !this.loaded) return;
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;

    // Use pixi-live2d-display's built-in focus system
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    this.model.focus(x, y);
  }

  // ===== Click Interaction =====

  _handleCanvasClick(e) {
    if (!this.model || !this.loaded) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.model.tap(x, y);
  }

  // ===== Update Loop =====

  _handleUpdate(deltaTime) {
    if (!this.model || !this.loaded) return;

    // Smooth lip sync
    this._lipSyncValue += (this._lipSyncTarget - this._lipSyncValue) * this._lipSyncSmoothing;

    // Apply lip sync to mouth parameter
    if (this.currentState === 'speaking' && this._lipSyncValue > 0.01) {
      this._setParam(this.PARAM.MOUTH_OPEN_Y, this._lipSyncValue);
    } else if (this.currentState !== 'speaking') {
      // Gradually close mouth when not speaking
      this._lipSyncValue *= 0.9;
      if (this._lipSyncValue < 0.01) this._lipSyncValue = 0;
      this._setParam(this.PARAM.MOUTH_OPEN_Y, this._lipSyncValue);
    }

    // Decay lip sync target when not actively being set
    this._lipSyncTarget *= 0.85;
  }

  // ===== Idle Motion Loop =====

  _startIdleLoop() {
    this._stopIdleLoop();
    this._idleTimer = setInterval(() => {
      if (this.currentState === 'idle' && this.loaded) {
        this._playRandomIdleMotion();
      }
    }, this._idleIntervalMs + Math.random() * 4000);
  }

  _stopIdleLoop() {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  _playRandomIdleMotion() {
    if (!this.model?.internalModel) return;
    try {
      this.model.motion('Idle');
    } catch (_) {}
  }

  // ===== Motion & Expression Helpers =====

  _playMotion(group, index) {
    if (!this.model) return;
    try {
      if (typeof index === 'number') {
        this.model.motion(group, index);
      } else {
        this.model.motion(group);
      }
    } catch (_) {}
  }

  _playRandomExpression() {
    if (!this.model) return;
    try {
      this.model.expression();
    } catch (_) {}
  }

  _setParam(paramId, value) {
    if (!this.model?.internalModel) return;
    try {
      const coreModel = this.model.internalModel.coreModel;
      if (coreModel) {
        coreModel.setParameterValueById(paramId, value);
      }
    } catch (_) {}
  }

  // ===== Public API =====

  /** Check if a model is loaded and rendering. */
  get isLoaded() {
    return this.loaded && this.model !== null;
  }

  /** Set mouse tracking enabled/disabled */
  setTracking(enabled) {
    this._trackingEnabled = enabled;
  }

  /**
   * Trigger a bounce/attention animation.
   */
  bounce() {
    if (!this.model) return;
    // Play TapBody motion for attention
    this._playMotion('TapBody', 0);
  }

  /**
   * Update motion map for a specific model.
   * @param {Object} map - e.g. { idle: 'Idle', speaking: 'Flick' }
   */
  setMotionMap(map) {
    Object.assign(this.motionMap, map);
  }

  /** Destroy the PixiJS app and free resources. */
  destroy() {
    this._destroyed = true;
    this._stopIdleLoop();

    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('click', this._onCanvasClick);

    if (this.app) {
      this.app.ticker.remove(this._onUpdate);
    }

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
    console.log('[Live2D v2] Destroyed');
  }
}

window.Live2DManager = Live2DManager;

/**
 * Character Animator — CSS-based character animation using sprite images.
 *
 * Uses multiple expression images + CSS transforms for lifelike animation:
 * - Idle breathing (gentle scale oscillation)
 * - Random blinking (eye-closed sprite swap)
 * - Expression changes (idle, speaking, happy)
 * - Subtle head sway
 */
class CharacterAnimator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentState = 'idle';
    this.blinkTimer = null;
    this.breathPhase = 0;
    this.swayPhase = 0;
    this.animationFrame = null;
    this.isBlinking = false;

    // Display mode: 'portrait' (static images + CSS anim) or 'pixel' (animated GIFs)
    this.mode = 'portrait';

    // Portrait mode: static expression images
    this.expressions = {
      idle: '../../assets/character/wanwan/idle.png',
      speaking: '../../assets/character/wanwan/speaking.png',
      blink: '../../assets/character/wanwan/blink.png',
    };

    // Pixel mode: animated GIFs per state
    this.pixelAnims = {
      idle: '../../assets/character/wanwan/idle-anim.gif',
      listening: '../../assets/character/wanwan/wave-anim.gif',
      thinking: '../../assets/character/wanwan/bounce-anim.gif',
      speaking: '../../assets/character/wanwan/dance-anim.gif',
    };

    // Create DOM structure
    this.imgElement = null;
    this.blinkOverlay = null;
    this._buildDOM();
  }

  _buildDOM() {
    // Clear container
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    // Main character image
    this.imgElement = document.createElement('img');
    this.imgElement.id = 'character-sprite';
    this.imgElement.src = this.expressions.idle;
    this.imgElement.style.cssText = `
      width: auto;
      height: 90%;
      max-width: 100%;
      object-fit: contain;
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      transition: opacity 0.15s ease;
      image-rendering: auto;
      filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15));
    `;
    this.container.appendChild(this.imgElement);

    // Preload all expression images
    Object.values(this.expressions).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }

  /**
   * Start the animation loop.
   */
  start() {
    this._scheduleNextBlink();
    this._animate();
    console.log('[CharacterAnimator] Started');
  }

  /**
   * Stop all animations.
   */
  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  /**
   * Set character state (idle, listening, speaking, thinking).
   */
  setState(state) {
    if (this.currentState === state) return;
    this.currentState = state;

    if (this.mode === 'pixel') {
      // Pixel mode: switch GIF, add cache buster to restart animation
      const gifSrc = this.pixelAnims[state] || this.pixelAnims.idle;
      this.imgElement.src = gifSrc + '?t=' + Date.now();
      return;
    }

    // Portrait mode
    switch (state) {
      case 'speaking':
        this.imgElement.src = this.expressions.speaking;
        break;
      case 'idle':
      case 'listening':
      case 'thinking':
      default:
        if (!this.isBlinking) {
          this.imgElement.src = this.expressions.idle;
        }
        break;
    }
  }

  /**
   * Toggle between portrait and pixel display modes.
   */
  toggleMode() {
    this.mode = this.mode === 'portrait' ? 'pixel' : 'portrait';
    console.log(`[CharacterAnimator] Mode: ${this.mode}`);

    if (this.mode === 'pixel') {
      // Stop CSS animations, use GIF
      this.stop();
      this.imgElement.style.transform = 'translateX(-50%)';
      this.imgElement.style.imageRendering = 'pixelated';
      this.imgElement.src = this.pixelAnims[this.currentState] || this.pixelAnims.idle;
    } else {
      // Resume CSS animations
      this.imgElement.style.imageRendering = 'auto';
      this.imgElement.src = this.expressions.idle;
      this.start();
    }
    return this.mode;
  }

  /**
   * Main animation loop — breathing + head sway.
   */
  _animate() {
    if (this.mode === 'pixel') return; // GIFs handle their own animation
    const now = performance.now();

    // Breathing: gentle vertical scale (1.0 to 1.008, ~4 second cycle)
    this.breathPhase = (now / 4000) * Math.PI * 2;
    const breathScale = 1.0 + Math.sin(this.breathPhase) * 0.008;

    // Head sway: subtle horizontal drift (~7 second cycle)
    this.swayPhase = (now / 7000) * Math.PI * 2;
    const swayX = Math.sin(this.swayPhase) * 2; // ±2px

    // Subtle vertical bob (~5 second cycle, very slight)
    const bobY = Math.sin((now / 5000) * Math.PI * 2) * 1.5;

    // Apply transforms
    this.imgElement.style.transform = `translateX(calc(-50% + ${swayX}px)) translateY(${bobY}px) scaleY(${breathScale})`;

    this.animationFrame = requestAnimationFrame(() => this._animate());
  }

  /**
   * Blink: briefly swap to blink sprite then back.
   */
  _doBlink() {
    if (this.mode === 'pixel') return; // No blinking in pixel mode
    if (this.currentState === 'speaking') return;

    this.isBlinking = true;
    const prevSrc = this.imgElement.src;
    this.imgElement.src = this.expressions.blink;

    // Blink duration: 100-200ms
    const blinkDuration = 100 + Math.random() * 100;

    setTimeout(() => {
      this.isBlinking = false;
      // Restore to current state expression
      if (this.currentState === 'speaking') {
        this.imgElement.src = this.expressions.speaking;
      } else {
        this.imgElement.src = this.expressions.idle;
      }
      this._scheduleNextBlink();
    }, blinkDuration);
  }

  /**
   * Schedule the next blink at a random interval (2-6 seconds).
   */
  _scheduleNextBlink() {
    const delay = 2000 + Math.random() * 4000;
    this.blinkTimer = setTimeout(() => this._doBlink(), delay);
  }
}

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.CharacterAnimator = CharacterAnimator;
}

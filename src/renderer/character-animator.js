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
    // idle=呼吸眨眼, listening=专注听(脉冲), thinking=思考(弹跳), speaking=开心说话(跳舞)
    this.pixelAnims = {
      idle: '../../assets/character/wanwan/idle-anim.gif',
      listening: '../../assets/character/wanwan/idle-anim.gif',  // + CSS pulse
      thinking: '../../assets/character/wanwan/idle-anim.gif',   // + CSS bounce
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

    // Ambient glow behind character
    this._glowEl = document.createElement('div');
    this._glowEl.style.cssText = `
      position: absolute; bottom: 10%; left: 50%; transform: translateX(-50%);
      width: 70%; height: 60%; border-radius: 50%; pointer-events: none; z-index: 0;
      background: radial-gradient(ellipse at center, rgba(139,92,246,0.12), transparent 70%);
      filter: blur(20px); transition: background 1.5s ease, opacity 1s ease;
      animation: sprite-glow-pulse 4s ease-in-out infinite;
    `;
    this.container.appendChild(this._glowEl);

    // Floating decoration particles
    this._decoParticles = document.createElement('div');
    this._decoParticles.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:hidden;';
    this._sparkles = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      const sz = 2 + Math.random() * 3;
      s.style.cssText = `
        position: absolute; width: ${sz}px; height: ${sz}px;
        border-radius: 50%; pointer-events: none;
        background: rgba(255,255,255,0.8);
        box-shadow: 0 0 ${sz * 2}px rgba(139,92,246,0.4), 0 0 ${sz}px rgba(255,255,255,0.6);
        opacity: 0;
      `;
      this._decoParticles.appendChild(s);
      this._sparkles.push({
        el: s, delay: Math.random() * 8000,
        x: 15 + Math.random() * 70, y: 10 + Math.random() * 70,
      });
    }
    this.container.appendChild(this._decoParticles);

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
      transition: opacity 0.15s ease, filter 0.5s ease;
      image-rendering: auto;
      filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15));
      z-index: 5;
    `;
    this.container.appendChild(this.imgElement);

    // Preload all expression images
    Object.values(this.expressions).forEach((src) => {
      const img = new Image();
      img.src = src;
    });

    // Inject sprite-specific styles
    this._injectSpriteStyles();
  }

  _injectSpriteStyles() {
    if (document.getElementById('sprite-anim-styles')) return;
    const style = document.createElement('style');
    style.id = 'sprite-anim-styles';
    style.textContent = `
      @keyframes sprite-glow-pulse {
        0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
        50% { opacity: 1; transform: translateX(-50%) scale(1.05); }
      }
      @keyframes sprite-sparkle {
        0% { opacity: 0; transform: scale(0.3) translateY(0); }
        15% { opacity: 0.8; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.8) translateY(-15px); }
        100% { opacity: 0; transform: scale(0.2) translateY(-30px); }
      }
      @keyframes sprite-state-flash {
        0% { filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15)) brightness(1); }
        50% { filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15)) brightness(1.15); }
        100% { filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15)) brightness(1); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Start the animation loop.
   */
  start() {
    this._scheduleNextBlink();
    this._animate();
    this._startSparkles();
    console.log('[CharacterAnimator] Started');
  }

  _startSparkles() {
    if (this._sparkleInterval) return;
    this._sparkleInterval = setInterval(() => {
      if (this.mode === 'pixel') return;
      // Pick a random sparkle to animate
      const s = this._sparkles[Math.floor(Math.random() * this._sparkles.length)];
      if (!s) return;
      s.el.style.left = (15 + Math.random() * 70) + '%';
      s.el.style.top = (10 + Math.random() * 70) + '%';
      s.el.style.animation = 'none';
      void s.el.offsetWidth; // force reflow
      s.el.style.animation = `sprite-sparkle ${2 + Math.random() * 2}s ease-out forwards`;
    }, 2000);
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
    if (this._sparkleInterval) {
      clearInterval(this._sparkleInterval);
      this._sparkleInterval = null;
    }
  }

  /**
   * Set character state (idle, listening, speaking, thinking).
   */
  setState(state) {
    if (this.currentState === state) return;
    this.currentState = state;

    // Update glow based on state
    if (this._glowEl) {
      const glowMap = {
        idle: 'rgba(139,92,246,0.12)',
        listening: 'rgba(239,68,68,0.18)',
        thinking: 'rgba(245,158,11,0.18)',
        speaking: 'rgba(139,92,246,0.22)',
      };
      this._glowEl.style.background = `radial-gradient(ellipse at center, ${glowMap[state] || glowMap.idle}, transparent 70%)`;
    }

    // Flash effect on state change
    if (this.imgElement && state !== 'idle') {
      this.imgElement.style.animation = 'sprite-state-flash 0.4s ease-out';
      setTimeout(() => { if (this.imgElement) this.imgElement.style.animation = ''; }, 400);
    }

    if (this.mode === 'pixel') {
      // Pixel mode: use GIF + CSS for bounce/thinking (AI GIFs inconsistent)
      const gifSrc = this.pixelAnims[state] || this.pixelAnims.idle;

      // Remove previous CSS animation classes
      this.imgElement.classList.remove('pixel-bounce', 'pixel-pulse');

      if (state === 'thinking') {
        // Use idle GIF + CSS bounce instead of broken bounce GIF
        this.imgElement.src = this.pixelAnims.idle;
        this.imgElement.classList.add('pixel-bounce');
      } else if (state === 'listening') {
        // Pulse effect for listening
        this.imgElement.src = this.pixelAnims.idle;
        this.imgElement.classList.add('pixel-pulse');
      } else {
        this.imgElement.src = gifSrc + '?t=' + Date.now();
      }
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

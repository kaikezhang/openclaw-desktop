/**
 * LayeredSpriteEngine — PNGTuber-style character with spring physics.
 *
 * Uses full character sprites (idle/speaking/blink) with:
 * - Spring-damped physics for all motion (bounce, breathing, sway)
 * - Squash & stretch on state transitions
 * - Random blinking with configurable timing
 * - Mouse tracking (subtle head follow)
 * - TTS volume reactivity (mouth bounce)
 * - Ambient particles & glow effects
 * - Smooth expression crossfade
 */
class LayeredSpriteEngine {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = 'idle'; // idle | thinking | speaking
    this.running = false;
    this.lastTime = 0;

    // Spring physics state
    this.springs = {
      // Vertical bounce (y offset)
      bounceY:   { pos: 0, vel: 0, target: 0, stiffness: 280, damping: 12 },
      // Breathing (scaleY oscillation)
      breathe:   { pos: 0, vel: 0, target: 0, stiffness: 40, damping: 8 },
      // Horizontal sway
      swayX:     { pos: 0, vel: 0, target: 0, stiffness: 30, damping: 6 },
      // Squash/stretch (scaleX/scaleY modifier)
      squashX:   { pos: 1, vel: 0, target: 1, stiffness: 350, damping: 14 },
      squashY:   { pos: 1, vel: 0, target: 1, stiffness: 350, damping: 14 },
      // Mouse follow (rotation in degrees)
      tiltX:     { pos: 0, vel: 0, target: 0, stiffness: 60, damping: 10 },
      // Speaking volume reactivity
      speakBounce: { pos: 0, vel: 0, target: 0, stiffness: 400, damping: 16 },
    };

    // Breathing oscillator
    this._breathPhase = 0;
    this._swayPhase = Math.random() * Math.PI * 2;

    // Blink state
    this._blinkTimer = null;
    this._isBlinking = false;

    // Speaking wobble
    this._speakWobblePhase = 0;

    // Mouse position (normalized -1 to 1)
    this._mouseX = 0;

    // DOM refs
    this._spriteA = null; // current visible sprite
    this._spriteB = null; // crossfade target
    this._glowEl = null;
    this._particleContainer = null;
    this._particles = [];

    // Asset paths
    this._basePath = '';
    this._assets = {
      idle: 'char-idle.png',
      speaking: 'char-speaking.png',
      blink: 'char-blink.png',
    };
    this._loaded = false;
  }

  /**
   * Load character layer assets from a directory.
   */
  async loadLayers(basePath) {
    this._basePath = basePath;
    // Preload all images
    const promises = Object.values(this._assets).map(file => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = `${basePath}/${file}`;
      });
    });
    await Promise.all(promises);
    this._loaded = true;
    this._buildDOM();
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'visible';
    this.container.style.width = '100%';
    this.container.style.height = '100%';

    // Ambient glow beneath character
    this._glowEl = document.createElement('div');
    this._glowEl.style.cssText = `
      position: absolute; bottom: 2%; left: 50%; transform: translateX(-50%);
      width: 55%; height: 30%; border-radius: 50%; pointer-events: none; z-index: 0;
      background: radial-gradient(ellipse at center, rgba(139,92,246,0.18), transparent 70%);
      filter: blur(18px); transition: background 1.2s ease;
    `;
    this.container.appendChild(this._glowEl);

    // Particle container
    this._particleContainer = document.createElement('div');
    this._particleContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20;overflow:hidden;';
    this.container.appendChild(this._particleContainer);
    this._initParticles();

    // Sprite wrapper (transform anchor at bottom-center)
    this._wrapper = document.createElement('div');
    this._wrapper.style.cssText = `
      position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%);
      transform-origin: bottom center;
      z-index: 10; width: auto; height: 92%;
    `;
    this.container.appendChild(this._wrapper);

    // Two image elements for crossfade
    const spriteCSS = `
      display: block; height: 100%; width: auto;
      object-fit: contain; position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%);
      filter: drop-shadow(0 6px 24px rgba(0,0,0,0.18));
      transition: opacity 0.12s ease;
    `;
    this._spriteA = document.createElement('img');
    this._spriteA.style.cssText = spriteCSS;
    this._spriteA.src = `${this._basePath}/${this._assets.idle}`;
    this._spriteA.style.opacity = '1';
    this._wrapper.appendChild(this._spriteA);

    this._spriteB = document.createElement('img');
    this._spriteB.style.cssText = spriteCSS;
    this._spriteB.src = `${this._basePath}/${this._assets.idle}`;
    this._spriteB.style.opacity = '0';
    this._wrapper.appendChild(this._spriteB);

    this._currentSprite = 'A'; // which one is visible

    // Mouse tracking
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.container.getBoundingClientRect();
      this._mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2; // -1 to 1
    });
    this.container.addEventListener('mouseleave', () => {
      this._mouseX = 0;
    });

    this._injectStyles();
  }

  _initParticles() {
    this._particles = [];
    for (let i = 0; i < 6; i++) {
      const p = document.createElement('div');
      const size = 2 + Math.random() * 3;
      p.style.cssText = `
        position: absolute; width: ${size}px; height: ${size}px;
        border-radius: 50%; pointer-events: none; opacity: 0;
        background: rgba(255,255,255,0.85);
        box-shadow: 0 0 ${size*2}px rgba(139,92,246,0.5), 0 0 ${size}px white;
      `;
      this._particleContainer.appendChild(p);
      this._particles.push({
        el: p, phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.5,
        x: 20 + Math.random() * 60,
        y: 20 + Math.random() * 60,
        size,
      });
    }
  }

  _injectStyles() {
    if (document.getElementById('layered-sprite-styles')) return;
    const style = document.createElement('style');
    style.id = 'layered-sprite-styles';
    style.textContent = `
      @keyframes ls-particle-float {
        0% { opacity: 0; transform: translateY(0) scale(0.3); }
        20% { opacity: 0.7; transform: translateY(-8px) scale(1); }
        80% { opacity: 0.4; transform: translateY(-25px) scale(0.7); }
        100% { opacity: 0; transform: translateY(-35px) scale(0.2); }
      }
    `;
    document.head.appendChild(style);
  }

  // ===== Spring Physics =====
  _stepSpring(spring, dt) {
    const force = -spring.stiffness * (spring.pos - spring.target);
    const dampForce = -spring.damping * spring.vel;
    spring.vel += (force + dampForce) * dt;
    spring.pos += spring.vel * dt;
  }

  _stepAllSprings(dt) {
    // Clamp dt to prevent explosion on tab-switch
    dt = Math.min(dt, 0.05);
    for (const s of Object.values(this.springs)) {
      this._stepSpring(s, dt);
    }
  }

  // ===== Public API =====

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this._scheduleNextBlink();
    this._animate();
    console.log('[LayeredSpriteEngine] Started');
  }

  stop() {
    this.running = false;
    if (this._blinkTimer) { clearTimeout(this._blinkTimer); this._blinkTimer = null; }
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  setState(state) {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;

    // Squash & stretch impulse on state change
    if (state === 'speaking') {
      this.springs.squashX.pos = 1.06;
      this.springs.squashY.pos = 0.94;
      this._setExpression('speaking');
    } else if (state === 'thinking') {
      this.springs.squashX.pos = 0.97;
      this.springs.squashY.pos = 1.03;
      this._setExpression('idle');
    } else {
      // idle
      if (prev === 'speaking') {
        this.springs.squashX.pos = 0.96;
        this.springs.squashY.pos = 1.04;
      }
      this._setExpression('idle');
    }

    // Bounce impulse
    this.springs.bounceY.vel = -120;

    // Update glow color
    const glowColors = {
      idle: 'rgba(139,92,246,0.18)',
      thinking: 'rgba(245,158,11,0.22)',
      speaking: 'rgba(139,92,246,0.28)',
    };
    if (this._glowEl) {
      this._glowEl.style.background = `radial-gradient(ellipse at center, ${glowColors[state] || glowColors.idle}, transparent 70%)`;
    }
  }

  /** Trigger a bounce (e.g. on tap) */
  bounce() {
    this.springs.bounceY.vel = -180;
    this.springs.squashX.pos = 1.08;
    this.springs.squashY.pos = 0.92;
  }

  /** Update with audio volume (0-1) for lip sync reactivity */
  updateVisualizer(volume) {
    if (this.state === 'speaking' && volume > 0.05) {
      this.springs.speakBounce.target = -volume * 8;
      // Micro-squash on loud syllables
      if (volume > 0.3) {
        this.springs.squashX.pos = 1 + volume * 0.03;
        this.springs.squashY.pos = 1 - volume * 0.02;
      }
    } else {
      this.springs.speakBounce.target = 0;
    }
  }

  // ===== Internal =====

  _setExpression(expr) {
    const src = `${this._basePath}/${this._assets[expr] || this._assets.idle}`;
    // Crossfade: set the hidden sprite to new src, then swap opacity
    if (this._currentSprite === 'A') {
      this._spriteB.src = src;
      this._spriteB.style.opacity = '1';
      this._spriteA.style.opacity = '0';
      this._currentSprite = 'B';
    } else {
      this._spriteA.src = src;
      this._spriteA.style.opacity = '1';
      this._spriteB.style.opacity = '0';
      this._currentSprite = 'A';
    }
  }

  _doBlink() {
    if (this.state === 'speaking' || this._isBlinking) return;
    this._isBlinking = true;
    this._setExpression('blink');
    const dur = 80 + Math.random() * 100;
    setTimeout(() => {
      this._isBlinking = false;
      if (this.state !== 'speaking') {
        this._setExpression('idle');
      }
      if (this.running) this._scheduleNextBlink();
    }, dur);
  }

  _scheduleNextBlink() {
    if (this._blinkTimer) clearTimeout(this._blinkTimer);
    // Natural blink: 2-5s intervals, occasionally double-blink
    const delay = 2000 + Math.random() * 3000;
    this._blinkTimer = setTimeout(() => {
      this._doBlink();
      // 20% chance of double blink
      if (Math.random() < 0.2) {
        setTimeout(() => this._doBlink(), 200 + Math.random() * 100);
      }
    }, delay);
  }

  _animate() {
    if (!this.running) return;
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Drive breathing oscillator → spring target
    this._breathPhase += dt * 1.2; // ~0.19 Hz
    this.springs.breathe.target = Math.sin(this._breathPhase) * 0.006;

    // Drive sway oscillator
    this._swayPhase += dt * 0.7; // ~0.11 Hz
    this.springs.swayX.target = Math.sin(this._swayPhase) * 2.5;

    // Mouse follow → tilt target
    this.springs.tiltX.target = this._mouseX * 3; // ±3 degrees

    // Speaking wobble
    if (this.state === 'speaking') {
      this._speakWobblePhase += dt * 8;
      this.springs.swayX.target += Math.sin(this._speakWobblePhase) * 1.2;
    }

    // Step all springs
    this._stepAllSprings(dt);

    // Compose transform
    const s = this.springs;
    const totalY = s.bounceY.pos + s.speakBounce.pos;
    const scaleX = s.squashX.pos;
    const scaleY = s.squashY.pos * (1 + s.breathe.pos);
    const translateX = s.swayX.pos;
    const rotate = s.tiltX.pos;

    this._wrapper.style.transform = `
      translateX(calc(-50% + ${translateX}px))
      translateY(${totalY}px)
      scaleX(${scaleX.toFixed(4)})
      scaleY(${scaleY.toFixed(4)})
      rotate(${rotate.toFixed(2)}deg)
    `;

    // Animate particles
    this._updateParticles(now);

    this._raf = requestAnimationFrame(() => this._animate());
  }

  _updateParticles(now) {
    for (const p of this._particles) {
      const t = (now / 1000) * p.speed + p.phase;
      const cycle = t % 6; // 6 second cycle
      if (cycle < 3) {
        const progress = cycle / 3;
        p.el.style.opacity = progress < 0.15 ? progress / 0.15 * 0.6 :
                             progress > 0.7 ? (1 - progress) / 0.3 * 0.6 : 0.6;
        p.el.style.left = p.x + Math.sin(t * 1.5) * 5 + '%';
        p.el.style.top = (p.y - progress * 20) + '%';
        p.el.style.transform = `scale(${0.5 + Math.sin(t * 2) * 0.3})`;
      } else {
        p.el.style.opacity = '0';
      }
    }
  }
}

// Export
if (typeof window !== 'undefined') {
  window.LayeredSpriteEngine = LayeredSpriteEngine;
}

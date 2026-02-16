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
    this._sprites = {}; // expression -> img element
    this._currentExpression = 'idle';
    this._glowEl = null;
    this._particleContainer = null;
    this._particles = [];

    // Asset paths
    this._basePath = '';
    this._assets = {
      idle: 'char-idle.png',
      speaking: 'char-speaking.png',
      'speaking-1': 'char-speaking-1.png',
      'speaking-2': 'char-speaking-2.png',
      blink: 'char-blink.png',
    };
    this._loaded = false;
    this._speakFrameIndex = 0;
    this._speakFrameTimer = null;
    this._hasSpeakFrames = false;
  }

  /**
   * Load character layer assets from a directory.
   */
  async loadLayers(basePath) {
    this._basePath = basePath;
    // Preload all images (speaking-1/speaking-2 are optional)
    const required = ['idle', 'speaking', 'blink'];
    const optional = ['speaking-1', 'speaking-2'];
    const promises = required.map(key => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = `${basePath}/${this._assets[key]}`;
      });
    });
    // Optional: try to load speaking frames, don't fail if missing
    const optPromises = optional.map(key => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { this._hasSpeakFrames = true; resolve(); };
        img.onerror = () => resolve(); // silently skip
        img.src = `${basePath}/${this._assets[key]}`;
      });
    });
    await Promise.all([...promises, ...optPromises]);
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
      position: absolute; bottom: 0; left: 0; right: 0;
      transform-origin: bottom center;
      z-index: 10; height: 92%;
    `;
    this.container.appendChild(this._wrapper);

    // One img element per expression — no src swapping, just toggle visibility
    const spriteCSS = `
      display: block; width: 100%; height: 100%;
      object-fit: cover; object-position: center bottom;
      position: absolute; bottom: 0; left: 0;
      filter: drop-shadow(0 6px 24px rgba(0,0,0,0.18));
    `;
    this._sprites = {};
    const optionalKeys = ['speaking-1', 'speaking-2'];
    Object.entries(this._assets).forEach(([key, file]) => {
      const img = document.createElement('img');
      img.style.cssText = spriteCSS;
      img.src = `${this._basePath}/${file}`;
      img.style.opacity = key === 'idle' ? '1' : '0';
      img.style.transition = 'opacity 0.15s ease';
      // For optional speaking frames, hide on error
      if (optionalKeys.includes(key)) {
        img.onerror = () => { img.style.display = 'none'; };
      }
      this._wrapper.appendChild(img);
      this._sprites[key] = img;
    });
    this._currentExpression = 'idle';
    // Keep references for animation code that uses _spriteA
    this._spriteA = this._sprites.idle;

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
      this._startSpeakAnimation();
    } else if (state === 'thinking') {
      this.springs.squashX.pos = 0.97;
      this.springs.squashY.pos = 1.03;
      this._setExpression('idle');
    } else {
      // idle
      this._stopSpeakAnimation();
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

  /**
   * Hot-swap outfit sprites with particle burst transition.
   * @param {Object} sprites - { idle: base64, blink: base64, speaking: base64 }
   */
  async swapOutfit(sprites) {
    if (!sprites || !sprites.idle || !sprites.blink || !sprites.speaking) {
      console.warn('[LayeredSpriteEngine] swapOutfit: missing sprites');
      return;
    }

    // 1. Preload all new images and wait for decode
    const newImages = {};
    const loadPromises = Object.entries(sprites).map(([key, b64]) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // Use decode() for guaranteed render-ready state
          if (img.decode) {
            img.decode().then(() => {
              newImages[key] = img;
              resolve();
            }).catch(() => {
              newImages[key] = img;
              resolve();
            });
          } else {
            newImages[key] = img;
            resolve();
          }
        };
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
    });

    try {
      await Promise.all(loadPromises);
    } catch (e) {
      console.error('[LayeredSpriteEngine] Failed to preload outfit sprites:', e);
      return;
    }

    // 2. Use CSS transition for shrink (not springs — springs can't guarantee timing)
    this._outfitTransition = true;
    if (this._wrapper) {
      this._wrapper.style.transition = 'transform 0.3s ease-in, opacity 0.15s ease';
      this._wrapper.style.transform = 'scale(0.75) translateY(20px)';
    }

    await new Promise(r => setTimeout(r, 300));

    // 3. Trigger particle burst + hide
    this._spawnOutfitParticles();
    if (this._wrapper) this._wrapper.style.opacity = '0';

    await new Promise(r => setTimeout(r, 150));

    // 4. Swap all sprite sources atomically + fix optional frame visibility
    for (const [key, img] of Object.entries(newImages)) {
      if (this._sprites[key]) {
        this._sprites[key].src = img.src;
        // Unhide optional speaking frames that may have been hidden by onerror
        if (this._sprites[key].style.display === 'none') {
          this._sprites[key].style.display = 'block';
        }
      }
    }
    // Hide optional speaking frames that are NOT in the new outfit
    const optionalKeys = ['speaking-1', 'speaking-2'];
    for (const key of optionalKeys) {
      if (this._sprites[key] && !newImages[key]) {
        this._sprites[key].style.display = 'none';
      }
    }

    // 5. Reveal with bounce-back
    if (this._wrapper) {
      this._wrapper.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
      this._wrapper.style.opacity = '1';
      this._wrapper.style.transform = 'scale(1) translateY(0)';
    }

    await new Promise(r => setTimeout(r, 600));

    // 6. Clean up — remove CSS transition, let springs take over again
    this._outfitTransition = false;
    if (this._wrapper) {
      this._wrapper.style.transition = '';
      this._wrapper.style.transform = '';
    }
    // Reset all springs to neutral
    this.springs.squashX.pos = 1;
    this.springs.squashX.vel = 0;
    this.springs.squashY.pos = 1;
    this.springs.squashY.vel = 0;
    this.springs.bounceY.pos = 0;
    this.springs.bounceY.vel = 0;

    // Reset expression to idle and restart blink cycle
    this._currentExpression = null; // force re-apply
    this._setExpression('idle');
    this._scheduleNextBlink();

    // Gentle entrance bounce
    this.springs.squashX.pos = 1.06;
    this.springs.squashY.pos = 0.94;

    // 5. Stretch bounce-back after swap
    requestAnimationFrame(() => {
      this.springs.squashX.pos = 1.06;
      this.springs.squashY.pos = 0.94;
    });

    console.log('[LayeredSpriteEngine] Outfit swapped');
  }

  /**
   * Reset to default sprites (from original basePath).
   */
  resetToDefault() {
    if (!this._basePath) return;
    this._spawnOutfitParticles();
    this.springs.squashX.pos = 0.92;
    this.springs.squashY.pos = 1.08;
    this.springs.bounceY.vel = -150;
    for (const [key, file] of Object.entries(this._assets)) {
      if (this._sprites[key]) {
        this._sprites[key].src = `${this._basePath}/${file}`;
      }
    }
    this._currentExpression = null;
    this._setExpression('idle');
    this._scheduleNextBlink();
    console.log('[LayeredSpriteEngine] Reset to default outfit');
  }

  /**
   * Spawn a burst of particles for outfit change effect.
   */
  _spawnOutfitParticles() {
    if (!this._particleContainer) return;

    // ── 1. White flash overlay ──
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: absolute; inset: 0; z-index: 50;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.95) 0%, rgba(255,200,255,0.6) 40%, transparent 70%);
      pointer-events: none; opacity: 1;
      transition: opacity 0.5s ease-out;
    `;
    this._particleContainer.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 600);

    // ── 2. Sparkle burst (30 particles) ──
    const colors = [
      'rgba(255,215,0,1)',     // gold
      'rgba(255,105,180,1)',   // pink
      'rgba(139,92,246,1)',    // purple
      'rgba(59,130,246,1)',    // blue
      'rgba(255,255,255,1)',   // white
      'rgba(255,170,220,1)',   // light pink
    ];

    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      const size = 3 + Math.random() * 6;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const angle = (Math.PI * 2 / 30) * i + Math.random() * 0.4;
      const speed = 60 + Math.random() * 120;
      const dx = Math.cos(angle) * speed;
      const dy = Math.sin(angle) * speed - 20; // bias upward
      const delay = Math.random() * 100;

      p.style.cssText = `
        position: absolute; width: ${size}px; height: ${size}px;
        border-radius: 50%; pointer-events: none; z-index: 40;
        background: ${color};
        box-shadow: 0 0 ${size * 4}px ${color}, 0 0 ${size * 8}px ${color.replace(',1)', ',0.4)')};
        left: 50%; top: 45%;
        transform: scale(1.5);
        transition: none;
      `;
      this._particleContainer.appendChild(p);

      setTimeout(() => {
        requestAnimationFrame(() => {
          p.style.transition = 'all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          p.style.left = `calc(50% + ${dx}px)`;
          p.style.top = `calc(45% + ${dy}px)`;
          p.style.opacity = '0';
          p.style.transform = `scale(0) rotate(${180 + Math.random() * 360}deg)`;
        });
      }, delay);

      setTimeout(() => p.remove(), 1000);
    }

    // ── 3. Spinning stars (6 larger star shapes) ──
    for (let i = 0; i < 6; i++) {
      const star = document.createElement('div');
      const size = 10 + Math.random() * 14;
      const angle = (Math.PI * 2 / 6) * i;
      const dist = 30 + Math.random() * 80;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 10;
      const color = colors[Math.floor(Math.random() * colors.length)];

      star.textContent = '✦';
      star.style.cssText = `
        position: absolute; pointer-events: none; z-index: 45;
        font-size: ${size}px; color: ${color};
        text-shadow: 0 0 ${size}px ${color};
        left: 50%; top: 40%;
        transform: scale(0) rotate(0deg);
        transition: none;
      `;
      this._particleContainer.appendChild(star);

      const delay = 50 + i * 40;
      setTimeout(() => {
        requestAnimationFrame(() => {
          star.style.transition = 'all 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)';
          star.style.left = `calc(50% + ${dx}px)`;
          star.style.top = `calc(40% + ${dy}px)`;
          star.style.transform = `scale(1.2) rotate(${360 + Math.random() * 180}deg)`;
        });
        setTimeout(() => {
          star.style.transition = 'opacity 0.4s ease-out';
          star.style.opacity = '0';
        }, 500);
      }, delay);

      setTimeout(() => star.remove(), 1200);
    }

    // ── 4. Rising shimmer ring ──
    const ring = document.createElement('div');
    ring.style.cssText = `
      position: absolute; left: 50%; top: 60%;
      width: 20px; height: 20px;
      border: 2px solid rgba(255,200,255,0.8);
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.5);
      pointer-events: none; z-index: 35;
      box-shadow: 0 0 20px rgba(255,200,255,0.5), inset 0 0 20px rgba(255,200,255,0.3);
      transition: all 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    `;
    this._particleContainer.appendChild(ring);
    requestAnimationFrame(() => {
      ring.style.width = '200px';
      ring.style.height = '200px';
      ring.style.top = '30%';
      ring.style.opacity = '0';
      ring.style.borderColor = 'rgba(255,200,255,0)';
    });
    setTimeout(() => ring.remove(), 800);
  }

  /** Start speaking mouth animation — volume-driven with timer fallback */
  _startSpeakAnimation() {
    this._stopSpeakAnimation();
    const frames = ['speaking', 'speaking-1', 'speaking-2'].filter(k => {
      const el = this._sprites[k];
      return el && el.style.display !== 'none' && el.naturalWidth > 0;
    });
    if (frames.length <= 1) {
      this._setExpression('speaking');
      this._speakFrames = frames.length ? frames : ['speaking'];
      return;
    }
    this._speakFrameIndex = 0;
    this._speakFrames = frames;
    this._speakVolumeActive = false;
    this._setExpression(frames[0]);
    // Fallback timer: gentle mouth animation when no volume data is driving frames
    this._speakFrameTimer = setInterval(() => {
      if (this.state !== 'speaking' || this._speakVolumeActive) return;
      // Smooth open-close cycle: 0 → 1 → 2 → 1 → 0 → ...
      const cycle = [0, 1, 2, 1];
      this._speakFallbackIdx = ((this._speakFallbackIdx || 0) + 1) % cycle.length;
      const idx = cycle[this._speakFallbackIdx];
      if (idx < this._speakFrames.length && idx !== this._speakFrameIndex) {
        this._speakFrameIndex = idx;
        this._setExpression(this._speakFrames[idx]);
      }
      // Drive speakBounce spring for scaleY pulse (simulate volume)
      const fakeBounce = [0, -3, -6, -3];
      this.springs.speakBounce.target = fakeBounce[this._speakFallbackIdx] || 0;
      // Also drive subtle squash
      const fakeSquash = [0, 0.01, 0.025, 0.01];
      const sq = fakeSquash[this._speakFallbackIdx] || 0;
      this.springs.squashX.pos = 1 + sq;
      this.springs.squashY.pos = 1 - sq * 0.7;
    }, 250);
  }

  _stopSpeakAnimation() {
    if (this._speakFrameTimer) {
      clearInterval(this._speakFrameTimer);
      this._speakFrameTimer = null;
    }
  }

  /** Update with audio volume (0-1) for lip sync reactivity */
  updateVisualizer(volume) {
    if (this.state === 'speaking') {
      if (volume > 0.05) {
        this._speakVolumeActive = true;
        // Reset fallback flag after silence
        clearTimeout(this._speakVolumeFadeTimer);
        this._speakVolumeFadeTimer = setTimeout(() => { this._speakVolumeActive = false; }, 500);
        this.springs.speakBounce.target = -volume * 8;
        // Micro-squash on loud syllables
        if (volume > 0.3) {
          this.springs.squashX.pos = 1 + volume * 0.03;
          this.springs.squashY.pos = 1 - volume * 0.02;
        }
        // Volume-driven frame selection for natural lip sync
        if (this._speakFrames && this._speakFrames.length > 1) {
          // frame 0 = closed/rest, frame 1 = slightly open, frame 2 = wide open
          const frameIdx = volume > 0.4 ? this._speakFrames.length - 1 :
                           volume > 0.15 ? 1 : 0;
          if (frameIdx !== this._speakFrameIndex) {
            this._speakFrameIndex = frameIdx;
            this._setExpression(this._speakFrames[frameIdx]);
          }
        }
      } else {
        // Quiet moment — close mouth (frame 0)
        this.springs.speakBounce.target = 0;
        if (this._speakFrames && this._speakFrames.length > 1 && this._speakFrameIndex !== 0) {
          this._speakFrameIndex = 0;
          this._setExpression(this._speakFrames[0]);
        }
      }
    } else {
      this.springs.speakBounce.target = 0;
    }
  }

  // ===== Internal =====

  _setExpression(expr) {
    if (!this._sprites[expr]) expr = 'idle';
    if (this._currentExpression === 'blink') {
      this._blinkSquash = false;
    }
    if (expr === 'blink') {
      this._blinkSquash = true;
    }
    if (expr === this._currentExpression) return;
    // Show the target expression sprite, hide all others
    // Skip sprites that failed to load (display: none) to prevent blank flashes
    Object.entries(this._sprites).forEach(([key, img]) => {
      if (img.style.display === 'none') return;
      img.style.transition = expr === 'blink' ? 'opacity 0.08s ease' : 'opacity 0.3s ease';
      img.style.opacity = key === expr ? '1' : '0';
    });
    this._currentExpression = expr;
  }

  _doBlink() {
    if (this.state === 'speaking' || this._isBlinking) return;
    this._isBlinking = true;
    this._setExpression('blink');
    const dur = 150 + Math.random() * 150;
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

    // During outfit transition, only apply scale (let springs drive the effect)
    if (this._outfitTransition) {
      this._wrapper.style.transform = `
        scaleX(${scaleX.toFixed(4)})
        scaleY(${scaleY.toFixed(4)})
      `;
      return;
    }

    this._wrapper.style.transform = `
      translateX(${translateX}px)
      translateY(${totalY}px)
      scaleX(${scaleX.toFixed(4)})
      scaleY(${scaleY.toFixed(4)})
      rotate(${rotate.toFixed(2)}deg)
    `;

    // Speaking mouth animation — subtle scaleY pulsation on ALL speaking sprites
    const speakingKeys = ['speaking', 'speaking-1', 'speaking-2'];
    if (this.state === 'speaking') {
      const mouthPulse = 1.0 + Math.abs(s.speakBounce.pos) * 0.018;
      for (const key of speakingKeys) {
        if (this._sprites[key] && this._sprites[key].style.display !== 'none') {
          this._sprites[key].style.transformOrigin = 'center 75%';
          this._sprites[key].style.transform = `scaleY(${mouthPulse.toFixed(4)})`;
        }
      }
    } else {
      for (const key of speakingKeys) {
        if (this._sprites[key]) this._sprites[key].style.transform = '';
      }
    }

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

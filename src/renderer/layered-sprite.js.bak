/**
 * LayeredSpriteEngine — PNGTuber-style layered character animation
 *
 * Composites multiple PNG layers on a canvas with per-layer spring physics,
 * follow-delay, sine-wave motion, and state-based expression switching.
 *
 * Architecture:
 *   body (z:0)     — breathing scale, subtle sway
 *   head-idle (z:1) — bounce on speak, tilt on think, mouse tracking
 *   head-speak (z:1, alt) — swapped in during speaking state
 *   hair (z:2)     — follows head with spring delay + jiggle
 *   cat-ears (z:3) — follows head with more delay + independent bounce
 *
 * Each layer has:
 *   - anchor point (pivot for transforms)
 *   - spring physics (position follows parent with damping)
 *   - sine-wave ambient motion (breathing, sway)
 *   - state-driven visibility/switching
 */
class LayeredSpriteEngine {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.currentState = 'idle';
    this.t = 0;
    this._animFrame = null;
    this._images = {};
    this._loaded = false;

    // Mouse tracking
    this._mouseX = 0;
    this._mouseY = 0;
    this._targetLookX = 0;
    this._targetLookY = 0;
    this._lookX = 0;
    this._lookY = 0;

    // Blink state
    this._blinkTimer = null;
    this._isBlinking = false;
    this._blinkPhase = 0; // 0=open, 1=closing, 2=closed, 3=opening

    // Head spring physics
    this._headSpring = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0 };
    // Hair spring (follows head with delay)
    this._hairSpring = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0 };
    // Ear spring (follows head with more delay)
    this._earSpring = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0 };

    // Speaking bounce
    this._speakBounce = 0;
    this._speakBounceV = 0;

    // Layer definitions
    this._layers = [
      {
        id: 'body', z: 0,
        anchorX: 0.5, anchorY: 0.85, // pivot near neck
        breathAmp: 0.008, breathFreq: 2.0,
        swayAmp: 0, swayFreq: 0,
      },
      {
        id: 'head', z: 1, // uses head-idle or head-speaking image
        anchorX: 0.5, anchorY: 0.75, // pivot at neck
        breathAmp: 0, breathFreq: 0,
        swayAmp: 1.5, swayFreq: 0.7,
        bounceOnSpeak: true,
        mouseTrack: true,
      },
      {
        id: 'hair', z: 2,
        anchorX: 0.5, anchorY: 0.15, // pivot at top of head
        breathAmp: 0, breathFreq: 0,
        swayAmp: 0.8, swayFreq: 0.5,
        followDelay: 0.12, // spring following head
        jiggleAmp: 0.5,
      },
      {
        id: 'ears', z: 3,
        anchorX: 0.5, anchorY: 0.5,
        breathAmp: 0, breathFreq: 0,
        swayAmp: 0.4, swayFreq: 0.9,
        followDelay: 0.18,
        jiggleAmp: 0.8,
        independentBounce: true,
      },
    ];

    this._buildDOM();
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;';
    this.container.appendChild(this.canvas);

    // Ambient glow
    this._glow = document.createElement('div');
    this._glow.style.cssText = `
      position:absolute;bottom:5%;left:50%;transform:translateX(-50%);
      width:60%;height:40%;border-radius:50%;pointer-events:none;z-index:0;
      background:radial-gradient(ellipse at center,rgba(139,92,246,0.1),transparent 70%);
      filter:blur(20px);transition:background 1.5s ease;
    `;
    this.container.appendChild(this._glow);

    // Floating sparkles
    this._sparkleContainer = document.createElement('div');
    this._sparkleContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:hidden;';
    this.container.appendChild(this._sparkleContainer);

    // Mouse tracking
    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      this._targetLookX = (e.clientX - cx) / rect.width * 2; // -1 to 1
      this._targetLookY = (e.clientY - cy) / rect.height * 2;
    });

    this.container.addEventListener('click', () => this._onClick());
  }

  async loadLayers(basePath) {
    const imageMap = {
      'char-idle': basePath + '/char-idle.png',
      'char-speaking': basePath + '/char-speaking.png',
      'char-blink': basePath + '/char-blink.png',
    };

    const promises = Object.entries(imageMap).map(([key, src]) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { this._images[key] = img; resolve(); };
        img.onerror = () => { console.warn(`[LayeredSprite] Failed to load: ${src}`); resolve(); };
        img.src = src;
      });
    });

    await Promise.all(promises);
    this._loaded = true;
    console.log('[LayeredSprite] Loaded:', Object.keys(this._images).join(', '));
  }

  start() {
    if (!this._loaded) {
      console.warn('[LayeredSprite] Not loaded yet');
      return;
    }
    this._resizeCanvas();
    this._scheduleBlink();
    this._startSparkles();
    this._animate();
    console.log('[LayeredSprite] Started');
  }

  stop() {
    if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
    if (this._blinkTimer) { clearTimeout(this._blinkTimer); this._blinkTimer = null; }
    if (this._sparkleInterval) { clearInterval(this._sparkleInterval); this._sparkleInterval = null; }
  }

  setState(state) {
    const prev = this.currentState;
    this.currentState = state;
    this._lastStateChangeT = this.t;

    if (state === 'speaking' && prev !== 'speaking') {
      // Bounce impulse on start speaking
      this._speakBounceV = -3;
      this._headSpring.vy = -2;
    }

    // Glow color
    const glowMap = {
      idle: 'rgba(139,92,246,0.1)',
      listening: 'rgba(239,68,68,0.15)',
      thinking: 'rgba(245,158,11,0.15)',
      speaking: 'rgba(139,92,246,0.18)',
    };
    if (this._glow) {
      this._glow.style.background = `radial-gradient(ellipse at center, ${glowMap[state] || glowMap.idle}, transparent 70%)`;
    }
  }

  bounce() {
    this._headSpring.vy = -4;
    this._speakBounceV = -5;
    this._spawnBurstSparkles();
  }

  _resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    this._canvasW = rect.width;
    this._canvasH = rect.height;
  }

  _animate() {
    const dt = 0.016;
    this.t += dt;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this._canvasW, this._canvasH);

    // === Update physics ===

    // Mouse look smoothing
    this._lookX += (this._targetLookX - this._lookX) * 0.08;
    this._lookY += (this._targetLookY - this._lookY) * 0.08;

    // Speaking bounce (damped spring)
    if (this.currentState === 'speaking') {
      this._speakBounceV += Math.sin(this.t * 8) * 0.3;
    }
    this._speakBounceV += (0 - this._speakBounce) * 0.15;
    this._speakBounceV *= 0.85;
    this._speakBounce += this._speakBounceV;

    // Head/body spring (the whole character moves)
    const headTargetY = this._speakBounce;
    const headTargetX = this._lookX * 3;
    const headTargetRot = this._lookX * 1.5 + (this.currentState === 'thinking' ? Math.sin(this.t * 1.5) * 2.5 : 0);
    this._updateSpring(this._headSpring, headTargetX, headTargetY, headTargetRot, 0.12, 0.82);

    // === Breathing ===
    const breathScale = 1.0 + Math.sin(this.t * 2) * 0.006;
    const breathY = Math.sin(this.t * 2) * 2;

    // Subtle sway
    const swayX = Math.sin(this.t * 0.7) * 1.5;
    const swayRot = Math.sin(this.t * 0.5) * 0.3;

    // === Blink ===
    this._updateBlink(dt);
    const blinkAlpha = this._getBlinkAlpha();

    // === Choose which character image to draw ===
    let charImg;
    if (blinkAlpha > 0.5 && this._images['char-blink']) {
      charImg = 'char-blink';
    } else if (this.currentState === 'speaking') {
      charImg = 'char-speaking';
    } else {
      charImg = 'char-idle';
    }

    // === Draw character ===
    this._drawLayer(charImg, {
      offsetX: this._headSpring.x + swayX,
      offsetY: this._headSpring.y + breathY,
      rotation: this._headSpring.rot + swayRot,
      scaleY: breathScale,
    });

    // === Cross-fade between expressions ===
    // When transitioning to speaking, briefly show both for smooth blend
    if (this.currentState === 'speaking' && this._images['char-idle'] && charImg === 'char-speaking') {
      // Fade out idle
      const fadeAlpha = Math.max(0, 1 - (this.t - (this._lastStateChangeT || 0)) * 3);
      if (fadeAlpha > 0.01) {
        this._drawLayer('char-idle', {
          offsetX: this._headSpring.x + swayX,
          offsetY: this._headSpring.y + breathY,
          rotation: this._headSpring.rot + swayRot,
          scaleY: breathScale,
          alpha: fadeAlpha,
        });
      }
    }

    this._animFrame = requestAnimationFrame(() => this._animate());
  }

  _drawLayer(imageKey, opts = {}) {
    const img = this._images[imageKey];
    if (!img) return;

    const ctx = this.ctx;
    const cw = this._canvasW;
    const ch = this._canvasH;

    // Scale image to fit canvas height
    const scale = ch / img.height;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const baseX = (cw - drawW) / 2;
    const baseY = 0;

    const ox = opts.offsetX || 0;
    const oy = opts.offsetY || 0;
    const rot = (opts.rotation || 0) * Math.PI / 180;
    const sx = opts.scaleX || 1;
    const sy = opts.scaleY || 1;
    const alpha = opts.alpha !== undefined ? opts.alpha : 1;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;

    // Transform around center of image
    const cx = baseX + drawW / 2 + ox;
    const cy = baseY + drawH / 2 + oy;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

    ctx.restore();
  }

  _updateSpring(spring, targetX, targetY, targetRot, stiffness, damping) {
    spring.vx += (targetX - spring.x) * stiffness;
    spring.vy += (targetY - spring.y) * stiffness;
    spring.vrot += (targetRot - spring.rot) * stiffness;
    spring.vx *= damping;
    spring.vy *= damping;
    spring.vrot *= damping;
    spring.x += spring.vx;
    spring.y += spring.vy;
    spring.rot += spring.vrot;
  }

  // === Blink System ===
  _scheduleBlink() {
    const delay = 2500 + Math.random() * 4000;
    this._blinkTimer = setTimeout(() => {
      this._isBlinking = true;
      this._blinkPhase = 0;
      this._scheduleBlink();
    }, delay);
  }

  _updateBlink(dt) {
    if (!this._isBlinking) return;
    this._blinkPhase += dt * 12; // speed of blink
    if (this._blinkPhase > 4) {
      this._isBlinking = false;
      this._blinkPhase = 0;
    }
  }

  _getBlinkAlpha() {
    if (!this._isBlinking) return 0;
    // 0-1: closing, 1-2: closed, 2-3: opening, 3-4: done
    if (this._blinkPhase < 1) return this._blinkPhase;
    if (this._blinkPhase < 2) return 1;
    if (this._blinkPhase < 3) return 3 - this._blinkPhase;
    return 0;
  }

  // === Sparkles ===
  _startSparkles() {
    this._sparkleInterval = setInterval(() => {
      if (Math.random() < 0.4) this._spawnSparkle();
    }, 2000);
  }

  _spawnSparkle() {
    const s = document.createElement('div');
    const sz = 2 + Math.random() * 3;
    const x = 15 + Math.random() * 70;
    const y = 10 + Math.random() * 70;
    s.style.cssText = `
      position:absolute;width:${sz}px;height:${sz}px;left:${x}%;top:${y}%;
      border-radius:50%;pointer-events:none;
      background:rgba(255,255,255,0.8);
      box-shadow:0 0 ${sz*2}px rgba(139,92,246,0.4);
      opacity:0;animation:lse-sparkle ${2+Math.random()*2}s ease-out forwards;
    `;
    this._sparkleContainer.appendChild(s);
    setTimeout(() => s.remove(), 4000);
  }

  _spawnBurstSparkles() {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this._spawnSparkle(), i * 100);
    }
  }

  _onClick() {
    this.bounce();
    // Flash glow
    if (this._glow) {
      this._glow.style.transition = 'none';
      this._glow.style.background = 'radial-gradient(ellipse at center, rgba(255,180,200,0.3), transparent 70%)';
      setTimeout(() => {
        this._glow.style.transition = 'background 0.8s ease';
        this.setState(this.currentState); // restore glow
      }, 200);
    }
  }

  // Inject required CSS
  static injectStyles() {
    if (document.getElementById('lse-styles')) return;
    const style = document.createElement('style');
    style.id = 'lse-styles';
    style.textContent = `
      @keyframes lse-sparkle {
        0% { opacity:0; transform:scale(0.3) translateY(0); }
        15% { opacity:0.8; transform:scale(1); }
        50% { opacity:0.5; transform:scale(0.8) translateY(-15px); }
        100% { opacity:0; transform:scale(0.2) translateY(-30px); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Auto-inject styles
LayeredSpriteEngine.injectStyles();

if (typeof window !== 'undefined') {
  window.LayeredSpriteEngine = LayeredSpriteEngine;
}

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
      body: basePath + '/body.png',
      'head-idle': basePath + '/head-idle.png',
      'head-speaking': basePath + '/head-speaking.png',
      hair: basePath + '/hair-all.png',
      ears: basePath + '/cat-ears.png',
      'face-only': basePath + '/face-only.png',
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
      // Continuous small bounces
      this._speakBounceV += Math.sin(this.t * 8) * 0.3;
    }
    this._speakBounceV += (0 - this._speakBounce) * 0.15;
    this._speakBounceV *= 0.85;
    this._speakBounce += this._speakBounceV;

    // Head spring
    const headTargetY = this._speakBounce;
    const headTargetX = this._lookX * 3;
    const headTargetRot = this._lookX * 2 + (this.currentState === 'thinking' ? Math.sin(this.t * 1.5) * 3 : 0);
    this._updateSpring(this._headSpring, headTargetX, headTargetY, headTargetRot, 0.12, 0.82);

    // Hair follows head with delay
    this._updateSpring(this._hairSpring, this._headSpring.x * 0.8, this._headSpring.y * 0.6, this._headSpring.rot * 1.2, 0.06, 0.88);

    // Ears follow head with more delay
    this._updateSpring(this._earSpring, this._headSpring.x * 0.7, this._headSpring.y * 0.5, this._headSpring.rot * 0.8, 0.04, 0.9);
    // Independent ear bounce
    if (this.currentState === 'speaking') {
      this._earSpring.y += Math.sin(this.t * 6) * 0.5;
    }

    // === Breathing ===
    const breathScale = 1.0 + Math.sin(this.t * 2) * 0.008;
    const breathY = Math.sin(this.t * 2) * 1.5;

    // === Blink ===
    this._updateBlink(dt);

    // === Draw layers (back to front) ===

    // Body
    this._drawLayer('body', {
      scaleY: breathScale,
      offsetY: breathY,
    });

    // Head (idle or speaking, with blink overlay)
    const headImg = this.currentState === 'speaking' ? 'head-speaking' : 'head-idle';
    const blinkAlpha = this._getBlinkAlpha();

    this._drawLayer(headImg, {
      offsetX: this._headSpring.x,
      offsetY: this._headSpring.y + breathY * 0.5,
      rotation: this._headSpring.rot,
    });

    // Blink effect: draw closed-eye version on top with alpha
    if (blinkAlpha > 0 && this._images['face-only']) {
      // We'll simulate blink by slightly squishing the eye area
      // Since we don't have a separate blink layer, we use a CSS-like approach:
      // draw a skin-colored band over the eye area
      this._drawBlinkOverlay(blinkAlpha);
    }

    // Hair
    this._drawLayer('hair', {
      offsetX: this._hairSpring.x + Math.sin(this.t * 0.5) * 0.8,
      offsetY: this._hairSpring.y + breathY * 0.3,
      rotation: this._hairSpring.rot,
    });

    // Cat ears
    this._drawLayer('ears', {
      offsetX: this._earSpring.x + Math.sin(this.t * 0.9) * 0.4,
      offsetY: this._earSpring.y + breathY * 0.2,
      rotation: this._earSpring.rot + Math.sin(this.t * 1.3) * 0.5,
    });

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

  _drawBlinkOverlay(alpha) {
    // Simple blink: draw a thin skin-colored rectangle over the eye area
    // This simulates closing eyes without needing a separate blink sprite
    const ctx = this.ctx;
    const ch = this._canvasH;
    const cw = this._canvasW;

    // Approximate eye area (relative to canvas)
    const eyeY = ch * 0.32 + this._headSpring.y;
    const eyeH = ch * 0.06 * alpha; // grows as blink progresses
    const eyeW = cw * 0.22;
    const eyeX = cw / 2 - eyeW / 2 + this._headSpring.x;

    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#f0d0c0'; // skin color approximation
    ctx.beginPath();
    // Two eye-shaped ellipses
    const gap = eyeW * 0.15;
    // Left eye
    ctx.ellipse(eyeX + eyeW * 0.3, eyeY, eyeW * 0.18, eyeH, 0, 0, Math.PI * 2);
    // Right eye
    ctx.ellipse(eyeX + eyeW * 0.7, eyeY, eyeW * 0.18, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
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

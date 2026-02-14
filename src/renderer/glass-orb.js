/**
 * Glass Orb Character — A fluid glass ball with expressive eyes.
 *
 * Inspired by claw-desktop-pet: pure CSS/JS, no sprite sheets.
 * Features:
 * - 67px fluid glass sphere with mood-based color systems
 * - 15+ eye expressions with 6 transition speeds
 * - Natural blinking (4 styles), mouse tracking, idle micro-expressions
 * - 7 mood colors: idle(pink), happy(gold), thinking(blue), speaking(coral),
 *   sleepy(muted), surprised(amber), offline(gray)
 * - Click interactions, hover effects, particle bursts
 */
class GlassOrbCharacter {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentState = 'idle';
    this.currentMood = 'idle';
    this.mouseTracking = true;
    this.t = 0;
    this.targetScale = 1;
    this.curScale = 1;
    this.breathExtra = 0;
    this.deepBreathPhase = 0;
    this.fidgetSeed = Math.random() * 100;
    this.lastInteraction = Date.now();
    this.talkInterval = null;
    this._moodTimer = null;
    this._animFrame = null;
    this._blinkTimeout = null;
    this._idleInterval = null;
    this._eyeDriftInterval = null;
    this._breathInterval = null;

    this._buildDOM();
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;';

    // Pet wrapper
    this.pet = document.createElement('div');
    this.pet.className = 'glass-orb-pet';
    this.pet.style.cssText = `
      width: 67px; height: 67px; position: relative; cursor: pointer;
      will-change: transform;
    `;

    // Inner fluid
    this.fluid = document.createElement('div');
    this.fluid.style.cssText = `
      position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
      border-radius: 50%; overflow: hidden; z-index: 1;
      background: linear-gradient(135deg, #ffb3ba, #ffe5e9);
      transition: filter 0.4s ease;
    `;

    this.blob1 = document.createElement('div');
    this.blob1.style.cssText = `
      position: absolute; width: 130%; height: 130%; top: -15%; left: -15%;
      background: radial-gradient(circle at 30% 30%, rgba(255,90,90,0.9), transparent 45%),
                  radial-gradient(circle at 70% 65%, rgba(255,140,100,0.85), transparent 45%);
      animation: glass-orb-spin 8s linear infinite;
    `;

    this.blob2 = document.createElement('div');
    this.blob2.style.cssText = `
      position: absolute; width: 110%; height: 110%; top: -5%; left: -5%;
      background: radial-gradient(circle at 60% 30%, rgba(255,190,140,0.45), transparent 40%),
                  radial-gradient(circle at 35% 70%, rgba(235,70,70,0.35), transparent 40%);
      animation: glass-orb-spin-r 12s linear infinite;
    `;

    this.fluid.appendChild(this.blob1);
    this.fluid.appendChild(this.blob2);

    // Glass shell
    this.shell = document.createElement('div');
    this.shell.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      border-radius: 50%; z-index: 2;
      background:
        radial-gradient(circle at 25% 25%, rgba(255,255,255,0.35), transparent 30%),
        radial-gradient(circle at 80% 80%, rgba(255,255,255,0.08), transparent 40%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03), transparent);
      box-shadow:
        inset -3px -3px 12px rgba(255,255,255,0.15),
        inset 3px 3px 12px rgba(255,255,255,0.45),
        0px 4px 12px rgba(220,80,80,0.15),
        0px 0px 20px rgba(255,255,255,0.1);
      backdrop-filter: blur(2px);
      border: 1.5px solid rgba(255,255,255,0.4);
      transition: box-shadow 1s ease, border 1s ease;
    `;

    // Shell highlights (::before and ::after via extra divs)
    const highlight1 = document.createElement('div');
    highlight1.style.cssText = `
      position: absolute; top: 10%; left: 15%; width: 35%; height: 18%;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.8), rgba(255,255,255,0.3) 60%, transparent);
      filter: blur(2px); transform: rotate(-40deg);
    `;
    const highlight2 = document.createElement('div');
    highlight2.style.cssText = `
      position: absolute; bottom: 20%; right: 18%; width: 20%; height: 12%;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.4), transparent 70%);
      filter: blur(2px); transform: rotate(25deg);
    `;
    this.shell.appendChild(highlight1);
    this.shell.appendChild(highlight2);

    // Eyes container
    this.eyesContainer = document.createElement('div');
    this.eyesContainer.style.cssText = `
      position: absolute; z-index: 3;
      top: 16%; left: 10%; width: 80%; height: 50%;
      display: flex; justify-content: center; align-items: center;
      gap: 12px; pointer-events: none; overflow: visible;
    `;

    this.eyeL = document.createElement('div');
    this.eyeR = document.createElement('div');
    const eyeStyle = `
      width: 11px; height: 19px; background: white; border-radius: 6px;
      box-shadow: 0 0 8px rgba(255,255,255,0.9), 0 0 16px rgba(255,255,255,0.4);
      transition: width 0.18s cubic-bezier(0.25,1,0.5,1), height 0.18s cubic-bezier(0.25,1,0.5,1),
                  border-radius 0.18s cubic-bezier(0.25,1,0.5,1), transform 0.18s cubic-bezier(0.25,1,0.5,1);
      transform-origin: center center;
    `;
    this.eyeL.style.cssText = eyeStyle;
    this.eyeR.style.cssText = eyeStyle;
    this.eyesContainer.appendChild(this.eyeL);
    this.eyesContainer.appendChild(this.eyeR);

    // Blush
    this.blushL = document.createElement('div');
    this.blushR = document.createElement('div');
    const blushBase = `
      position: absolute; z-index: 3; width: 14px; height: 8px; border-radius: 50%;
      background: rgba(255,130,130,0.25); filter: blur(3px); pointer-events: none;
      transition: background 2s ease, opacity 0.6s ease; opacity: 0.8;
    `;
    this.blushL.style.cssText = blushBase + 'top: 58%; left: 8%;';
    this.blushR.style.cssText = blushBase + 'top: 58%; right: 8%;';

    // Mouth (visible during talking)
    this.mouth = document.createElement('div');
    this.mouth.style.cssText = `
      position: absolute; z-index: 3;
      bottom: 22%; left: 50%; transform: translateX(-50%);
      width: 8px; height: 4px; border-radius: 0 0 4px 4px;
      background: rgba(255,255,255,0.7);
      box-shadow: 0 0 4px rgba(255,255,255,0.5);
      transition: width 0.1s ease, height 0.1s ease, border-radius 0.1s ease;
      opacity: 0; pointer-events: none;
    `;

    // Particles container
    this.particles = document.createElement('div');
    this.particles.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';

    // Audio visualizer ring (SVG)
    this.vizRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.vizRing.setAttribute('width', '100');
    this.vizRing.setAttribute('height', '100');
    this.vizRing.setAttribute('viewBox', '-50 -50 100 100');
    this.vizRing.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 100px; height: 100px;
      z-index: 0; pointer-events: none; opacity: 0;
      transition: opacity 0.3s ease;
    `;
    // Create ring bars
    this.vizBars = [];
    const barCount = 16;
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const cx = Math.cos(angle) * 36;
      const cy = Math.sin(angle) * 36;
      const ex = Math.cos(angle) * 40;
      const ey = Math.sin(angle) * 40;
      line.setAttribute('x1', cx.toString());
      line.setAttribute('y1', cy.toString());
      line.setAttribute('x2', ex.toString());
      line.setAttribute('y2', ey.toString());
      line.setAttribute('stroke', 'rgba(255,255,255,0.6)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      this.vizRing.appendChild(line);
      this.vizBars.push({ line, angle, cx, cy });
    }

    // Bubbles
    const bub1 = document.createElement('div');
    bub1.style.cssText = `
      position:absolute;border-radius:50%;width:5px;height:5px;left:-5px;top:60%;
      background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.4),rgba(255,255,255,0.06));
      border:1px solid rgba(255,255,255,0.12);z-index:0;opacity:0;pointer-events:none;
      animation:glass-orb-bub 5s ease-in infinite 0s;
    `;
    const bub2 = document.createElement('div');
    bub2.style.cssText = `
      position:absolute;border-radius:50%;width:3px;height:3px;right:-4px;top:40%;
      background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.4),rgba(255,255,255,0.06));
      border:1px solid rgba(255,255,255,0.12);z-index:0;opacity:0;pointer-events:none;
      animation:glass-orb-bub 6.5s ease-in infinite 2s;
    `;

    // Assemble
    this.pet.appendChild(this.fluid);
    this.pet.appendChild(this.shell);
    this.pet.appendChild(this.eyesContainer);
    this.pet.appendChild(this.blushL);
    this.pet.appendChild(this.blushR);
    this.pet.appendChild(this.mouth);
    this.pet.appendChild(this.vizRing);
    this.pet.appendChild(bub1);
    this.pet.appendChild(bub2);
    this.pet.appendChild(this.particles);
    this.container.appendChild(this.pet);

    // Inject keyframes
    this._injectStyles();

    // Click handler
    this.pet.addEventListener('click', () => this._onClick());
    this.pet.addEventListener('mouseenter', () => this._onHover(true));
    this.pet.addEventListener('mouseleave', () => this._onHover(false));

    // Mouse tracking
    document.addEventListener('mousemove', (e) => this._onMouseMove(e));
  }

  _injectStyles() {
    if (document.getElementById('glass-orb-styles')) return;
    const style = document.createElement('style');
    style.id = 'glass-orb-styles';
    style.textContent = `
      @keyframes glass-orb-spin {
        0% { transform: rotate(0deg) scale(1); }
        50% { transform: rotate(180deg) scale(1.08); }
        100% { transform: rotate(360deg) scale(1); }
      }
      @keyframes glass-orb-spin-r {
        0% { transform: rotate(360deg) scale(1.05); }
        50% { transform: rotate(180deg) scale(0.95); }
        100% { transform: rotate(0deg) scale(1.05); }
      }
      @keyframes glass-orb-bub {
        0% { opacity: 0; transform: translateY(0) scale(0.3); }
        15% { opacity: 0.5; }
        100% { opacity: 0; transform: translateY(-30px) translateX(5px) scale(1); }
      }
      @keyframes glass-orb-squish {
        0% { transform: scale(1, 1); }
        25% { transform: scale(1.15, 0.85); }
        50% { transform: scale(0.9, 1.1); }
        75% { transform: scale(1.05, 0.95); }
        100% { transform: scale(1, 1); }
      }
    `;
    document.head.appendChild(style);
  }

  // ===== Eye Expression System =====

  _EYE_SPEED = {
    snap: '0s', fast: '0.08s', normal: '0.18s',
    smooth: '0.3s', slow: '0.45s', drift: '0.6s',
  };

  _setEyeTransition(speed) {
    const dur = this._EYE_SPEED[speed] || this._EYE_SPEED.normal;
    const ease = speed === 'snap' || speed === 'fast' ? 'linear'
      : speed === 'slow' || speed === 'drift' ? 'cubic-bezier(0.4,0,0.2,1)'
      : 'cubic-bezier(0.25,1,0.5,1)';
    const t = `width ${dur} ${ease}, height ${dur} ${ease}, border-radius ${dur} ${ease}, transform ${dur} ${ease}`;
    this.eyeL.style.transition = t;
    this.eyeR.style.transition = t;
  }

  _setEyes(L, R, speed) {
    if (speed) this._setEyeTransition(speed);
    const d = { w: 11, h: 19, br: '6px', tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };
    const l = { ...d, ...L };
    const r = R ? { ...d, ...R } : { ...l };
    this.eyeL.style.width = l.w + 'px';
    this.eyeL.style.height = l.h + 'px';
    this.eyeL.style.borderRadius = l.br;
    this.eyeL.style.transform = `translate(${l.tx}px,${l.ty}px) scale(${l.sx},${l.sy}) rotate(${l.rot}deg)`;
    this.eyeR.style.width = r.w + 'px';
    this.eyeR.style.height = r.h + 'px';
    this.eyeR.style.borderRadius = r.br;
    this.eyeR.style.transform = `translate(${r.tx}px,${r.ty}px) scale(${r.sx},${r.sy}) rotate(${r.rot}deg)`;
    if (speed) setTimeout(() => this._setEyeTransition('normal'), 20);
  }

  // Named expressions
  _expr = {
    normal:    () => this._setEyes({ w: 11, h: 19, br: '6px' }),
    blink:     () => this._setEyes({ w: 12, h: 3, br: '3px' }, null, 'snap'),
    halfBlink: () => this._setEyes({ w: 11, h: 10, br: '5px' }, null, 'fast'),
    happy:     () => this._setEyes({ w: 13, h: 7, br: '7px 7px 3px 3px', ty: 1 }, null, 'smooth'),
    superHappy:() => this._setEyes({ w: 15, h: 5, br: '8px 8px 3px 3px', ty: 1, sx: 1.1 }, null, 'smooth'),
    surprised: () => this._setEyes({ w: 13, h: 21, br: '7px' }, null, 'fast'),
    thinking:  () => this._setEyes({ w: 10, h: 17, br: '5px', ty: -3 }, null, 'smooth'),
    talking:   () => this._setEyes({ w: 10, h: 17, br: '5px' }),
    talkBig:   () => this._setEyes({ w: 12, h: 20, br: '6px' }),
    sleepy:    () => this._setEyes({ w: 12, h: 4, br: '4px', ty: 2 }, null, 'slow'),
    drowsy:    () => this._setEyes({ w: 11, h: 10, br: '5px', ty: 1 }, null, 'slow'),
    sad:       () => this._setEyes({ w: 10, h: 16, br: '5px', ty: 3, sy: 0.9 }, null, 'smooth'),
    curious:   () => this._setEyes({ w: 9, h: 16, br: '5px', ty: -1 }, { w: 13, h: 21, br: '7px', ty: -1 }, 'smooth'),
    wink:      () => this._setEyes({ w: 13, h: 7, br: '7px 7px 3px 3px', ty: 1 }, { w: 11, h: 19, br: '6px' }, 'fast'),
    sparkle:   () => this._setEyes({ w: 12, h: 12, br: '3px', rot: 45 }, null, 'fast'),
    love:      () => this._setEyes({ w: 14, h: 13, br: '7px 1px 7px 1px', rot: 45, sx: 1.1 }, null, 'smooth'),
    lookLeft:  () => this._setEyes({ w: 11, h: 19, br: '6px', tx: -4 }),
    lookRight: () => this._setEyes({ w: 11, h: 19, br: '6px', tx: 4 }),
    lookUp:    () => this._setEyes({ w: 11, h: 19, br: '6px', ty: -5 }),
    squint:    () => this._setEyes({ w: 12, h: 6, br: '4px', ty: 1 }),
    giggle:    () => this._setEyes({ w: 13, h: 7, br: '7px 7px 3px 3px', ty: 1, rot: -8 },
                                    { w: 13, h: 7, br: '7px 7px 3px 3px', ty: 1, rot: 8 }, 'smooth'),
    hmm:       () => this._setEyes({ w: 11, h: 16, br: '5px', ty: -1, rot: 8 },
                                    { w: 9, h: 13, br: '5px', ty: 0, rot: -8 }, 'smooth'),
    softSmile: () => this._setEyes({ w: 12, h: 9, br: '6px 6px 3px 3px', ty: 1 }, null, 'smooth'),
    content:   () => this._setEyes({ w: 13, h: 8, br: '7px 7px 4px 4px', ty: 0, sx: 1.05 }, null, 'slow'),
  };

  // ===== Mood System =====

  _MOODS = {
    offline:  { fluid: 'linear-gradient(135deg,#a8a8a8,#c5c5c5)', b1: 'radial-gradient(circle at 30% 30%,rgba(120,120,120,0.7),transparent 45%),radial-gradient(circle at 70% 65%,rgba(145,145,145,0.6),transparent 45%)', b2: 'radial-gradient(circle at 60% 30%,rgba(160,160,160,0.35),transparent 40%),radial-gradient(circle at 35% 70%,rgba(110,110,110,0.25),transparent 40%)', eyes: 'sleepy', scale: 0.93, bounce: 0 },
    idle:     { fluid: 'linear-gradient(135deg,#ffb3ba,#ffe5e9)', b1: 'radial-gradient(circle at 30% 30%,rgba(255,90,90,0.9),transparent 45%),radial-gradient(circle at 70% 65%,rgba(255,140,100,0.85),transparent 45%)', b2: 'radial-gradient(circle at 60% 30%,rgba(255,190,140,0.45),transparent 40%),radial-gradient(circle at 35% 70%,rgba(235,70,70,0.35),transparent 40%)', eyes: 'normal', scale: 1, bounce: 0 },
    happy:    { fluid: 'linear-gradient(135deg,#ffdd99,#ffe0cc)', b1: 'radial-gradient(circle at 30% 30%,rgba(255,180,50,0.95),transparent 45%),radial-gradient(circle at 70% 65%,rgba(255,110,110,0.9),transparent 45%)', b2: 'radial-gradient(circle at 50% 50%,rgba(255,220,0,0.5),transparent 45%),radial-gradient(circle at 35% 70%,rgba(255,130,0,0.4),transparent 40%)', eyes: 'happy', scale: 1.05, bounce: 0.02 },
    talking:  { fluid: 'linear-gradient(135deg,#ffaab3,#ffd5e0)', b1: 'radial-gradient(circle at 30% 30%,rgba(255,95,95,0.95),transparent 45%),radial-gradient(circle at 70% 65%,rgba(255,125,85,0.9),transparent 45%)', b2: 'radial-gradient(circle at 60% 30%,rgba(255,170,120,0.55),transparent 40%),radial-gradient(circle at 35% 70%,rgba(240,80,80,0.4),transparent 40%)', eyes: 'talking', scale: 1, bounce: 0.015 },
    thinking: { fluid: 'linear-gradient(135deg,#b8d8ff,#e8ddff)', b1: 'radial-gradient(circle at 30% 30%,rgba(90,140,245,0.9),transparent 45%),radial-gradient(circle at 70% 65%,rgba(140,90,230,0.85),transparent 45%)', b2: 'radial-gradient(circle at 60% 30%,rgba(170,190,255,0.5),transparent 40%),radial-gradient(circle at 35% 70%,rgba(110,70,210,0.4),transparent 40%)', eyes: 'thinking', scale: 1, bounce: 0 },
    sleepy:   { fluid: 'linear-gradient(135deg,#d0bebe,#e5d8d8)', b1: 'radial-gradient(circle at 30% 30%,rgba(170,130,130,0.7),transparent 45%),radial-gradient(circle at 70% 65%,rgba(190,150,130,0.6),transparent 45%)', b2: 'radial-gradient(circle at 60% 30%,rgba(195,170,160,0.4),transparent 40%),radial-gradient(circle at 35% 70%,rgba(160,120,120,0.3),transparent 40%)', eyes: 'sleepy', scale: 0.97, bounce: 0 },
    surprised:{ fluid: 'linear-gradient(135deg,#ffe8b0,#ffddc8)', b1: 'radial-gradient(circle at 30% 30%,rgba(255,195,40,0.95),transparent 45%),radial-gradient(circle at 70% 65%,rgba(255,115,75,0.9),transparent 45%)', b2: 'radial-gradient(circle at 50% 50%,rgba(255,225,90,0.5),transparent 45%),radial-gradient(circle at 35% 70%,rgba(255,145,45,0.4),transparent 40%)', eyes: 'surprised', scale: 1.06, bounce: 0 },
  };

  _setMood(mood) {
    const m = this._MOODS[mood] || this._MOODS.idle;

    if (mood !== this.currentMood) {
      if (this._moodTimer) { clearTimeout(this._moodTimer); this._moodTimer = null; }

      // Flash transition to hide gradient jump
      this.fluid.style.transition = 'filter 0.35s ease-in';
      this.fluid.style.filter = 'brightness(1.6) blur(2px)';

      this._moodTimer = setTimeout(() => {
        this.fluid.style.background = m.fluid;
        this.blob1.style.background = m.b1;
        this.blob2.style.background = m.b2;
        this.fluid.style.transition = 'filter 0.5s ease-out';
        this.fluid.style.filter = 'brightness(1) blur(0px)';
        this._moodTimer = setTimeout(() => {
          this.fluid.style.transition = '';
          this.fluid.style.filter = '';
          this._moodTimer = null;
        }, 550);
      }, 350);
    }

    this.currentMood = mood;

    if (mood === 'sleepy') {
      this.blob1.style.transition = 'opacity 1.5s ease';
      this.blob1.style.opacity = '0.6';
    } else {
      this.blob1.style.transition = 'opacity 1s ease';
      this.blob1.style.opacity = '1';
    }

    this.targetScale = m.scale;
    this.breathExtra = m.bounce;
    this.mouseTracking = (mood !== 'sleepy' && mood !== 'happy');

    if (this.talkInterval) { clearInterval(this.talkInterval); this.talkInterval = null; }

    if (mood === 'talking') {
      // Show mouth + animate
      this.mouth.style.opacity = '1';
      let tog = false;
      this.talkInterval = setInterval(() => {
        tog = !tog;
        tog ? this._expr.talkBig() : this._expr.talking();
        // Mouth open/close animation
        if (tog) {
          this.mouth.style.width = '10px';
          this.mouth.style.height = '6px';
          this.mouth.style.borderRadius = '2px 2px 5px 5px';
        } else {
          this.mouth.style.width = '7px';
          this.mouth.style.height = '3px';
          this.mouth.style.borderRadius = '0 0 4px 4px';
        }
      }, 200);
    } else {
      this.mouth.style.opacity = '0';
      if (m.eyes && this._expr[m.eyes]) this._expr[m.eyes]();
    }

    // Blush for happy
    if (mood === 'happy') {
      this.blushL.style.background = 'rgba(255,120,120,0.4)';
      this.blushR.style.background = 'rgba(255,120,120,0.4)';
    } else {
      this.blushL.style.background = '';
      this.blushR.style.background = '';
    }
  }

  // ===== Public API =====

  start() {
    this._setMood('idle');
    this._scheduleBlink();
    this._startAnimation();
    this._startIdleMicro();
    console.log('[GlassOrb] Started');
  }

  stop() {
    if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
    if (this._blinkTimeout) { clearTimeout(this._blinkTimeout); this._blinkTimeout = null; }
    if (this._idleInterval) { clearInterval(this._idleInterval); this._idleInterval = null; }
    if (this._eyeDriftInterval) { clearInterval(this._eyeDriftInterval); this._eyeDriftInterval = null; }
    if (this._breathInterval) { clearInterval(this._breathInterval); this._breathInterval = null; }
    if (this.talkInterval) { clearInterval(this.talkInterval); this.talkInterval = null; }
  }

  /**
   * Set app state (idle, listening, thinking, speaking).
   * Maps to mood colors + eye expressions.
   */
  setState(state) {
    this.currentState = state;
    this.lastInteraction = Date.now();
    switch (state) {
      case 'speaking':
        this._setMood('talking');
        break;
      case 'thinking':
        this._setMood('thinking');
        break;
      case 'listening':
        this._setMood('idle');
        // Pulse effect — slightly larger
        this.targetScale = 1.03;
        break;
      case 'idle':
      default:
        this._setMood('idle');
        break;
    }
  }

  // ===== Animation Loop =====

  _startAnimation() {
    const loop = () => {
      this.t += 0.016;
      this.curScale += (this.targetScale - this.curScale) * 0.08;

      // Multi-frequency organic float
      const floatY = Math.sin(this.t * 1.3) * 3.5 + Math.sin(this.t * 0.67) * 2 + Math.sin(this.t * 2.3) * 0.6;
      const floatR = Math.sin(this.t * 0.9) * 0.3 + Math.sin(this.t * 0.37) * 0.2;

      // Breathing
      let breathScale = 1 + Math.sin(this.t * 2) * 0.01 + Math.sin(this.t * 0.8) * 0.005;
      if (this.deepBreathPhase > 0) {
        breathScale += Math.sin(this.deepBreathPhase) * 0.025;
        this.deepBreathPhase += 0.04;
        if (this.deepBreathPhase > Math.PI) this.deepBreathPhase = 0;
      }

      // Micro fidget
      const fidgetX = Math.sin(this.t * 0.23 + this.fidgetSeed) * 0.6;
      const fidgetR = Math.sin(this.t * 0.17 + this.fidgetSeed * 2) * 0.12;

      const bounce = this.breathExtra > 0 ? Math.sin(this.t * 12) * this.breathExtra : 0;

      this.pet.style.transform = `translateX(${fidgetX}px) translateY(${floatY + bounce}px) rotate(${floatR + fidgetR}deg) scale(${this.curScale * breathScale})`;

      this._animFrame = requestAnimationFrame(loop);
    };
    loop();

    // Deep breath every 20-40s
    this._breathInterval = setInterval(() => {
      if (this.currentMood === 'talking' || this.currentMood === 'thinking') return;
      if (this.deepBreathPhase === 0 && Math.random() < 0.5) this.deepBreathPhase = 0.01;
    }, 25000);
  }

  // ===== Blink System =====

  _doBlink() {
    if (this.currentMood === 'sleepy' || this.currentMood === 'happy') { this._scheduleBlink(); return; }
    this.mouseTracking = false;
    this._expr.blink();

    const r = Math.random();
    if (r < 0.15) {
      // Double blink
      setTimeout(() => {
        this._expr.normal();
        setTimeout(() => { this._expr.blink(); setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 70); }, 100);
      }, 70);
    } else if (r < 0.3) {
      // Half → full blink
      setTimeout(() => {
        this._expr.halfBlink();
        setTimeout(() => { this._expr.blink(); setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 80); }, 120);
      }, 80);
    } else {
      // Normal blink
      setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 80);
    }
    this._scheduleBlink();
  }

  _scheduleBlink() {
    const delay = Math.random() < 0.2 ? 800 + Math.random() * 1500 : 2500 + Math.random() * 5000;
    this._blinkTimeout = setTimeout(() => this._doBlink(), delay);
  }

  _applyMoodEyes() {
    const m = this._MOODS[this.currentMood];
    if (m && m.eyes && this._expr[m.eyes]) this._expr[m.eyes]();
  }

  // ===== Idle Micro-Expressions =====

  _startIdleMicro() {
    const microActions = [
      // Look left-right
      () => { this._expr.lookLeft(); setTimeout(() => { this._expr.lookRight(); setTimeout(() => this._expr.normal(), 500); }, 500); },
      // Curious
      () => { this._expr.curious(); setTimeout(() => this._expr.normal(), 800); },
      // Wink
      () => { this._expr.wink(); setTimeout(() => this._expr.normal(), 700); },
      // Hmm
      () => { this._expr.hmm(); setTimeout(() => this._expr.normal(), 800); },
      // Sparkle
      () => { this._expr.sparkle(); setTimeout(() => this._expr.normal(), 500); },
      // Soft smile
      () => { this._expr.softSmile(); setTimeout(() => this._expr.normal(), 1000); },
      // Giggle
      () => { this._expr.giggle(); setTimeout(() => this._expr.normal(), 800); },
    ];

    this._idleInterval = setInterval(() => {
      if (this.currentMood !== 'idle' || !this.mouseTracking) return;
      if (Math.random() < 0.3) {
        this.mouseTracking = false;
        microActions[Math.floor(Math.random() * microActions.length)]();
        setTimeout(() => { this.mouseTracking = true; }, 1500);
      }
    }, 4000);

    // Eye drift
    this._eyeDriftInterval = setInterval(() => {
      if (this.currentMood !== 'idle' || !this.mouseTracking) return;
      if (Math.random() < 0.35) {
        const dx = (Math.random() - 0.5) * 4;
        const dy = (Math.random() - 0.5) * 3;
        this.eyeL.style.transition = 'transform 0.8s ease';
        this.eyeR.style.transition = 'transform 0.8s ease';
        this.eyeL.style.transform = `translate(${dx}px,${dy}px)`;
        this.eyeR.style.transform = `translate(${dx}px,${dy}px)`;
        setTimeout(() => {
          this.eyeL.style.transition = 'transform 1.2s ease';
          this.eyeR.style.transition = 'transform 1.2s ease';
          this.eyeL.style.transform = '';
          this.eyeR.style.transform = '';
          setTimeout(() => { this.eyeL.style.transition = ''; this.eyeR.style.transition = ''; }, 1200);
        }, 1500 + Math.random() * 2000);
      }
    }, 5000);
  }

  // ===== Audio Visualization =====

  /**
   * Update visualizer ring with audio volume (0-1).
   * Call this from the app animation loop when audio is playing.
   */
  updateVisualizer(volume) {
    if (volume > 0.01) {
      this.vizRing.style.opacity = '1';
      for (let i = 0; i < this.vizBars.length; i++) {
        const bar = this.vizBars[i];
        // Each bar gets slightly different amplitude for organic feel
        const variance = 0.5 + Math.sin(this.t * 8 + i * 0.7) * 0.5;
        const amp = volume * variance * 12 + 4;
        const ex = Math.cos(bar.angle) * (36 + amp);
        const ey = Math.sin(bar.angle) * (36 + amp);
        bar.line.setAttribute('x2', ex.toString());
        bar.line.setAttribute('y2', ey.toString());
        // Color based on amplitude
        const hue = 340 + volume * 40; // pink to orange
        const alpha = 0.4 + volume * 0.5;
        bar.line.setAttribute('stroke', `hsla(${hue}, 80%, 75%, ${alpha})`);
      }
    } else {
      this.vizRing.style.opacity = '0';
    }
  }

  // ===== Click & Hover =====

  _onClick() {
    this.lastInteraction = Date.now();
    this.pet.style.animation = 'glass-orb-squish 0.35s cubic-bezier(0.34,1.56,0.64,1)';
    this.pet.style.filter = 'brightness(1.15)';
    setTimeout(() => { this.pet.style.animation = ''; this.pet.style.filter = ''; }, 350);
    this._spawnParticles();

    // Random expression
    const exprs = ['happy', 'wink', 'surprised', 'curious', 'giggle', 'sparkle', 'love'];
    const pick = exprs[Math.floor(Math.random() * exprs.length)];
    this.mouseTracking = false;
    this._expr[pick]();
    setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 800);
  }

  _onHover(entering) {
    if (this.currentMood === 'sleepy' || this.currentMood === 'offline') return;
    if (entering) {
      this.eyeL.style.transform = 'scale(1.08)';
      this.eyeR.style.transform = 'scale(1.08)';
      this.pet.style.filter = 'brightness(1.05)';
    } else {
      this.eyeL.style.transform = '';
      this.eyeR.style.transform = '';
      this.pet.style.filter = '';
    }
  }

  _onMouseMove(e) {
    if (!this.mouseTracking) return;
    const rect = this.pet.getBoundingClientRect();
    if (rect.width === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-2, Math.min(2, (e.clientX - cx) / window.innerWidth * 6));
    const dy = Math.max(-2, Math.min(2, (e.clientY - cy) / window.innerHeight * 6));
    this.eyeL.style.transform = `translate(${dx}px,${dy}px)`;
    this.eyeR.style.transform = `translate(${dx}px,${dy}px)`;
  }

  _spawnParticles() {
    const colors = ['#ff6b6b', '#ffa07a', '#ffb347', '#ff69b4', '#fff', '#ffd700'];
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      const sz = 2 + Math.random() * 3;
      const a = (Math.PI * 2 / 8) * i + Math.random() * 0.4;
      const dist = 15 + Math.random() * 25;
      p.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;
        width:${sz}px;height:${sz}px;
        background:${colors[Math.floor(Math.random() * colors.length)]};
        left:50%;top:50%;opacity:1;
        transition:transform 0.4s ease-out,opacity 0.4s ease-out;`;
      this.particles.appendChild(p);
      requestAnimationFrame(() => {
        p.style.transform = `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px)`;
        p.style.opacity = '0';
      });
      setTimeout(() => p.remove(), 450);
    }
  }
}

// Export
if (typeof window !== 'undefined') {
  window.GlassOrbCharacter = GlassOrbCharacter;
}

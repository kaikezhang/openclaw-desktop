/**
 * Glass Orb Character v2 — Liquid Glass Edition
 *
 * Major upgrade: Apple-inspired liquid glass effects with SVG filters,
 * organic shape morphing, and physics-based jelly animations.
 *
 * Features:
 * - SVG filter pipeline: feTurbulence + feDisplacementMap for liquid distortion
 * - feSpecularLighting for realistic surface highlights
 * - Organic blob morphing via animated SVG clipPath (not a rigid circle)
 * - Physics-based spring animations for jelly bounce
 * - 15+ eye expressions with 6 transition speeds
 * - Natural blinking, mouse tracking, idle micro-expressions
 * - 7 mood colors with smooth gradient transitions
 * - Click interactions, hover effects, particle bursts
 * - Audio visualizer ring
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

    // Spring physics for jelly effect
    this._springVx = 0;
    this._springVy = 0;
    this._springSx = 1;  // current scaleX
    this._springSy = 1;  // current scaleY
    this._springTargetSx = 1;
    this._springTargetSy = 1;
    this._springDamping = 0.72;
    this._springStiffness = 0.18;

    // Blob morph state
    this._blobPhase = Math.random() * Math.PI * 2;
    this._blobSpeed = 0.4;

    this._buildDOM();
  }

  // ===== Generate organic blob path =====

  _blobPath(phase, radius, cx, cy, points, variation) {
    const pts = [];
    for (let i = 0; i < points; i++) {
      const angle = (Math.PI * 2 / points) * i;
      // Multiple sine waves for organic shape
      const r = radius
        + Math.sin(phase + angle * 2) * variation * 0.6
        + Math.sin(phase * 1.7 + angle * 3) * variation * 0.3
        + Math.cos(phase * 0.8 + angle * 5) * variation * 0.15;
      pts.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
    }
    // Smooth spline through points (catmull-rom → cubic bezier)
    return this._catmullRomToPath(pts, true);
  }

  _catmullRomToPath(points, closed) {
    const n = points.length;
    if (n < 3) return '';
    let d = '';
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      if (i === 0) d += `M${p1.x.toFixed(2)},${p1.y.toFixed(2)} `;
      // Catmull-Rom to cubic bezier control points
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += `C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} `;
    }
    if (closed) d += 'Z';
    return d;
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible;';

    const SIZE = 67;
    const HALF = SIZE / 2;

    // ===== SVG Filter Definitions =====
    const svgNS = 'http://www.w3.org/2000/svg';
    this._filterSvg = document.createElementNS(svgNS, 'svg');
    this._filterSvg.setAttribute('width', '0');
    this._filterSvg.setAttribute('height', '0');
    this._filterSvg.style.cssText = 'position:absolute;pointer-events:none;';

    const defs = document.createElementNS(svgNS, 'defs');

    // --- Liquid distortion filter ---
    const liquidFilter = document.createElementNS(svgNS, 'filter');
    liquidFilter.setAttribute('id', 'glass-liquid-distort');
    liquidFilter.setAttribute('x', '-20%');
    liquidFilter.setAttribute('y', '-20%');
    liquidFilter.setAttribute('width', '140%');
    liquidFilter.setAttribute('height', '140%');

    // Turbulence for organic distortion
    this._turbulence = document.createElementNS(svgNS, 'feTurbulence');
    this._turbulence.setAttribute('type', 'fractalNoise');
    this._turbulence.setAttribute('baseFrequency', '0.015 0.02');
    this._turbulence.setAttribute('numOctaves', '3');
    this._turbulence.setAttribute('seed', Math.floor(Math.random() * 100).toString());
    this._turbulence.setAttribute('result', 'turbulence');

    // Displacement map for liquid warping
    const displacement = document.createElementNS(svgNS, 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'turbulence');
    displacement.setAttribute('scale', '4');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');
    displacement.setAttribute('result', 'displaced');

    liquidFilter.appendChild(this._turbulence);
    liquidFilter.appendChild(displacement);
    defs.appendChild(liquidFilter);

    // --- Specular highlight filter ---
    const specFilter = document.createElementNS(svgNS, 'filter');
    specFilter.setAttribute('id', 'glass-specular');
    specFilter.setAttribute('x', '-10%');
    specFilter.setAttribute('y', '-10%');
    specFilter.setAttribute('width', '120%');
    specFilter.setAttribute('height', '120%');

    const specTurb = document.createElementNS(svgNS, 'feTurbulence');
    specTurb.setAttribute('type', 'fractalNoise');
    specTurb.setAttribute('baseFrequency', '0.03');
    specTurb.setAttribute('numOctaves', '2');
    specTurb.setAttribute('result', 'specNoise');

    const specLight = document.createElementNS(svgNS, 'feSpecularLighting');
    specLight.setAttribute('in', 'specNoise');
    specLight.setAttribute('surfaceScale', '3');
    specLight.setAttribute('specularConstant', '0.6');
    specLight.setAttribute('specularExponent', '25');
    specLight.setAttribute('result', 'specular');
    specLight.setAttribute('lighting-color', '#ffffff');

    const pointLight = document.createElementNS(svgNS, 'fePointLight');
    pointLight.setAttribute('x', '20');
    pointLight.setAttribute('y', '15');
    pointLight.setAttribute('z', '60');
    this._specLight = pointLight;
    specLight.appendChild(pointLight);

    const specComp = document.createElementNS(svgNS, 'feComposite');
    specComp.setAttribute('in', 'specular');
    specComp.setAttribute('in2', 'SourceGraphic');
    specComp.setAttribute('operator', 'in');
    specComp.setAttribute('result', 'specMask');

    const specBlend = document.createElementNS(svgNS, 'feBlend');
    specBlend.setAttribute('in', 'SourceGraphic');
    specBlend.setAttribute('in2', 'specMask');
    specBlend.setAttribute('mode', 'screen');

    specFilter.appendChild(specTurb);
    specFilter.appendChild(specLight);
    specFilter.appendChild(specComp);
    specFilter.appendChild(specBlend);
    defs.appendChild(specFilter);

    // --- Blob clip path (organic shape) ---
    this._clipPath = document.createElementNS(svgNS, 'clipPath');
    this._clipPath.setAttribute('id', 'glass-blob-clip');
    this._blobPathEl = document.createElementNS(svgNS, 'path');
    this._blobPathEl.setAttribute('d', this._blobPath(0, 30, HALF, HALF, 8, 3));
    this._clipPath.appendChild(this._blobPathEl);
    defs.appendChild(this._clipPath);

    this._filterSvg.appendChild(defs);

    // ===== Pet wrapper =====
    this.pet = document.createElement('div');
    this.pet.className = 'glass-orb-pet';
    this.pet.style.cssText = `
      width: ${SIZE}px; height: ${SIZE}px; position: relative; cursor: pointer;
      will-change: transform;
    `;

    // Inner fluid — now with SVG liquid distortion filter
    this.fluid = document.createElement('div');
    this.fluid.style.cssText = `
      position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
      border-radius: 50%; overflow: hidden; z-index: 1;
      background: linear-gradient(135deg, #ffb3ba, #ffe5e9);
      filter: url(#glass-liquid-distort);
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

    // Extra blob layer for depth
    this.blob3 = document.createElement('div');
    this.blob3.style.cssText = `
      position: absolute; width: 90%; height: 90%; top: 5%; left: 5%;
      background: radial-gradient(circle at 50% 40%, rgba(255,255,255,0.15), transparent 50%);
      animation: glass-orb-spin 15s linear infinite reverse;
      mix-blend-mode: overlay;
    `;

    // Internal floating light particles
    this._floatingParticles = [];
    this._floatingParticleContainer = document.createElement('div');
    this._floatingParticleContainer.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      border-radius: 50%; overflow: hidden; pointer-events: none; z-index: 1;
    `;
    for (let i = 0; i < 6; i++) {
      const fp = document.createElement('div');
      const sz = 2 + Math.random() * 3;
      fp.style.cssText = `
        position: absolute; width: ${sz}px; height: ${sz}px;
        border-radius: 50%; pointer-events: none;
        background: radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,255,255,0.2));
        box-shadow: 0 0 ${sz * 2}px rgba(255,255,255,0.5);
        filter: blur(0.5px);
      `;
      this._floatingParticleContainer.appendChild(fp);
      this._floatingParticles.push({
        el: fp, sz,
        x: Math.random() * 60, y: Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1,
      });
    }

    this.fluid.appendChild(this.blob1);
    this.fluid.appendChild(this.blob2);
    this.fluid.appendChild(this.blob3);
    this.fluid.appendChild(this._floatingParticleContainer);

    // Glass shell — enhanced with specular filter
    this.shell = document.createElement('div');
    this.shell.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      border-radius: 50%; z-index: 2;
      background:
        radial-gradient(circle at 25% 25%, rgba(255,255,255,0.45), transparent 30%),
        radial-gradient(circle at 80% 80%, rgba(255,255,255,0.1), transparent 40%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05), transparent);
      box-shadow:
        inset -3px -3px 14px rgba(255,255,255,0.2),
        inset 3px 3px 14px rgba(255,255,255,0.5),
        0px 4px 16px rgba(220,80,80,0.12),
        0px 0px 24px rgba(255,255,255,0.12),
        0px 2px 6px rgba(0,0,0,0.08);
      backdrop-filter: blur(1.5px);
      border: 1.5px solid rgba(255,255,255,0.45);
      filter: url(#glass-specular);
      transition: box-shadow 1s ease, border 1s ease;
    `;

    // Shell highlight — main reflection spot
    const highlight1 = document.createElement('div');
    highlight1.style.cssText = `
      position: absolute; top: 8%; left: 13%; width: 40%; height: 20%;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.9), rgba(255,255,255,0.35) 55%, transparent);
      filter: blur(2px); transform: rotate(-40deg);
      animation: glass-highlight-drift 6s ease-in-out infinite alternate;
    `;
    // Secondary highlight — bottom reflection
    const highlight2 = document.createElement('div');
    highlight2.style.cssText = `
      position: absolute; bottom: 18%; right: 16%; width: 22%; height: 14%;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(255,255,255,0.5), transparent 70%);
      filter: blur(2px); transform: rotate(25deg);
      animation: glass-highlight-drift 8s ease-in-out infinite alternate-reverse;
    `;
    // Edge refraction glow
    const edgeGlow = document.createElement('div');
    edgeGlow.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      border-radius: 50%;
      box-shadow: inset 0 0 12px rgba(255,255,255,0.3);
      background: radial-gradient(circle at 50% 50%, transparent 55%, rgba(255,255,255,0.08) 70%, transparent 80%);
      animation: glass-edge-pulse 4s ease-in-out infinite;
    `;
    // Rainbow refraction edge — subtle prismatic effect
    const rainbowEdge = document.createElement('div');
    rainbowEdge.style.cssText = `
      position: absolute; top: -1px; left: -1px; width: calc(100% + 2px); height: calc(100% + 2px);
      border-radius: 50%; pointer-events: none;
      background: conic-gradient(from 0deg,
        rgba(255,100,100,0.08), rgba(255,200,100,0.08), rgba(100,255,100,0.08),
        rgba(100,200,255,0.08), rgba(200,100,255,0.08), rgba(255,100,100,0.08));
      mask: radial-gradient(circle at center, transparent 65%, black 75%, transparent 85%);
      -webkit-mask: radial-gradient(circle at center, transparent 65%, black 75%, transparent 85%);
      animation: glass-orb-spin 20s linear infinite;
      mix-blend-mode: screen;
      opacity: 0.7;
    `;

    // Caustic light pattern — simulates light refracting through glass
    this._causticLayer = document.createElement('div');
    this._causticLayer.style.cssText = `
      position: absolute; top: 10%; left: 10%; width: 80%; height: 80%;
      border-radius: 50%; pointer-events: none;
      background:
        radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.25), transparent 30%),
        radial-gradient(ellipse at 70% 40%, rgba(255,255,255,0.15), transparent 25%),
        radial-gradient(ellipse at 45% 70%, rgba(255,255,255,0.1), transparent 30%);
      mix-blend-mode: overlay;
      opacity: 0.6;
      animation: glass-caustic-shift 8s ease-in-out infinite alternate;
    `;

    this.shell.appendChild(highlight1);
    this.shell.appendChild(highlight2);
    this.shell.appendChild(edgeGlow);
    this.shell.appendChild(rainbowEdge);
    this.shell.appendChild(this._causticLayer);

    // ===== Eyes =====
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
      box-shadow: 0 0 8px rgba(255,255,255,0.9), 0 0 16px rgba(255,255,255,0.4),
                  0 0 3px rgba(255,255,255,1);
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

    // Mouth
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

    // Particles
    this.particles = document.createElement('div');
    this.particles.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';

    // Audio visualizer ring
    this.vizRing = document.createElementNS(svgNS, 'svg');
    this.vizRing.setAttribute('width', '100');
    this.vizRing.setAttribute('height', '100');
    this.vizRing.setAttribute('viewBox', '-50 -50 100 100');
    this.vizRing.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 100px; height: 100px;
      z-index: 0; pointer-events: none; opacity: 0;
      transition: opacity 0.3s ease;
      display: none;
    `;
    this.vizBars = [];
    const barCount = 16;
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const line = document.createElementNS(svgNS, 'line');
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

    // Ambient bubbles
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
    // Third bubble for more life
    const bub3 = document.createElement('div');
    bub3.style.cssText = `
      position:absolute;border-radius:50%;width:4px;height:4px;left:15%;bottom:-3px;
      background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.35),rgba(255,255,255,0.05));
      border:1px solid rgba(255,255,255,0.1);z-index:0;opacity:0;pointer-events:none;
      animation:glass-orb-bub 7s ease-in infinite 3.5s;
    `;

    // Ground shadow/glow
    this._groundGlow = document.createElement('div');
    this._groundGlow.style.cssText = `
      position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%);
      width: 50px; height: 8px;
      background: radial-gradient(ellipse at center, rgba(255,120,120,0.25), transparent 70%);
      border-radius: 50%; pointer-events: none; z-index: -1;
      filter: blur(3px);
      transition: background 1.5s ease, width 0.5s ease;
    `;

    // Assemble
    this.pet.appendChild(this._groundGlow);
    this.pet.appendChild(this.fluid);
    this.pet.appendChild(this.shell);
    this.pet.appendChild(this.eyesContainer);
    this.pet.appendChild(this.blushL);
    this.pet.appendChild(this.blushR);
    this.pet.appendChild(this.mouth);
    this.pet.appendChild(this.vizRing);
    this.pet.appendChild(bub1);
    this.pet.appendChild(bub2);
    this.pet.appendChild(bub3);
    this.pet.appendChild(this.particles);
    this.container.appendChild(this._filterSvg);
    this.container.appendChild(this.pet);

    this._injectStyles();

    this.pet.addEventListener('click', () => this._onClick());
    this.pet.addEventListener('mouseenter', () => this._onHover(true));
    this.pet.addEventListener('mouseleave', () => this._onHover(false));
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
      @keyframes glass-highlight-drift {
        0% { opacity: 0.7; transform: rotate(-40deg) translateX(0px); }
        100% { opacity: 1; transform: rotate(-35deg) translateX(2px); }
      }
      @keyframes glass-edge-pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
      }
      @keyframes glass-caustic {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes glass-caustic-shift {
        0% {
          background:
            radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.25), transparent 30%),
            radial-gradient(ellipse at 70% 40%, rgba(255,255,255,0.15), transparent 25%),
            radial-gradient(ellipse at 45% 70%, rgba(255,255,255,0.1), transparent 30%);
        }
        50% {
          background:
            radial-gradient(ellipse at 55% 35%, rgba(255,255,255,0.2), transparent 28%),
            radial-gradient(ellipse at 25% 60%, rgba(255,255,255,0.18), transparent 25%),
            radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.12), transparent 30%);
        }
        100% {
          background:
            radial-gradient(ellipse at 40% 55%, rgba(255,255,255,0.22), transparent 30%),
            radial-gradient(ellipse at 65% 25%, rgba(255,255,255,0.14), transparent 25%),
            radial-gradient(ellipse at 30% 45%, rgba(255,255,255,0.1), transparent 30%);
        }
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

      // Flash transition
      this.fluid.style.transition = 'filter 0.35s ease-in';
      this.fluid.style.filter = 'url(#glass-liquid-distort) brightness(1.6) blur(2px)';

      this._moodTimer = setTimeout(() => {
        this.fluid.style.background = m.fluid;
        this.blob1.style.background = m.b1;
        this.blob2.style.background = m.b2;
        this.fluid.style.transition = 'filter 0.5s ease-out';
        this.fluid.style.filter = 'url(#glass-liquid-distort) brightness(1) blur(0px)';
        this._moodTimer = setTimeout(() => {
          this.fluid.style.transition = '';
          this.fluid.style.filter = 'url(#glass-liquid-distort)';
          this._moodTimer = null;
        }, 550);
      }, 350);
    }

    this.currentMood = mood;

    // Scatter internal particles on mood change
    if (this._floatingParticles) {
      for (const fp of this._floatingParticles) {
        fp.vx = (Math.random() - 0.5) * 1.2;
        fp.vy = (Math.random() - 0.5) * 1.2;
      }
    }

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
      this.mouth.style.opacity = '1';
      let tog = false;
      this.talkInterval = setInterval(() => {
        tog = !tog;
        tog ? this._expr.talkBig() : this._expr.talking();
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

    if (mood === 'happy') {
      this.blushL.style.background = 'rgba(255,120,120,0.4)';
      this.blushR.style.background = 'rgba(255,120,120,0.4)';
    } else {
      this.blushL.style.background = '';
      this.blushR.style.background = '';
    }

    // Update ground glow color
    const glowColors = {
      idle: 'rgba(255,120,120,0.25)', happy: 'rgba(255,200,50,0.35)',
      talking: 'rgba(255,100,100,0.3)', thinking: 'rgba(120,140,255,0.3)',
      sleepy: 'rgba(180,150,150,0.15)', surprised: 'rgba(255,180,50,0.35)',
      offline: 'rgba(120,120,120,0.1)',
    };
    if (this._groundGlow) {
      this._groundGlow.style.background = `radial-gradient(ellipse at center, ${glowColors[mood] || glowColors.idle}, transparent 70%)`;
    }
  }

  // ===== Public API =====

  start() {
    this._setMood('idle');
    this._scheduleBlink();
    this._startAnimation();
    this._startIdleMicro();
    console.log('[GlassOrb v2] Started — Liquid Glass Edition');
  }

  stop() {
    if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
    if (this._blinkTimeout) { clearTimeout(this._blinkTimeout); this._blinkTimeout = null; }
    if (this._idleInterval) { clearInterval(this._idleInterval); this._idleInterval = null; }
    if (this._eyeDriftInterval) { clearInterval(this._eyeDriftInterval); this._eyeDriftInterval = null; }
    if (this._breathInterval) { clearInterval(this._breathInterval); this._breathInterval = null; }
    if (this.talkInterval) { clearInterval(this.talkInterval); this.talkInterval = null; }
  }

  setState(state) {
    this.currentState = state;
    this.lastInteraction = Date.now();
    if (this.currentMood === 'sleepy' && state !== 'idle') {
      this._jellyBounce(0.12);
      this._spawnParticles();
    }
    switch (state) {
      case 'speaking':
        this._setMood('talking');
        break;
      case 'thinking':
        this._setMood('thinking');
        break;
      case 'listening':
        this._setMood('idle');
        this.targetScale = 1.03;
        break;
      case 'idle':
      default:
        this._setMood('idle');
        break;
    }
  }

  // ===== Spring Physics (Jelly) =====

  _jellyBounce(intensity) {
    // Apply impulse: squash horizontally, stretch vertically
    this._springVx += intensity * 1.5;
    this._springVy -= intensity;
  }

  _updateSpring() {
    // Damped spring toward (1, 1)
    const dx = 1 - this._springSx;
    const dy = 1 - this._springSy;
    this._springVx += dx * this._springStiffness;
    this._springVy += dy * this._springStiffness;
    this._springVx *= this._springDamping;
    this._springVy *= this._springDamping;
    this._springSx += this._springVx;
    this._springSy += this._springVy;
  }

  // ===== Animation Loop =====

  _startAnimation() {
    const HALF = 33.5;
    let turbSeed = parseFloat(this._turbulence.getAttribute('seed'));

    const loop = () => {
      this.t += 0.016;
      this.curScale += (this.targetScale - this.curScale) * 0.08;

      // Update spring physics
      this._updateSpring();

      // Organic float (multi-frequency)
      const floatY = Math.sin(this.t * 1.3) * 3.5
        + Math.sin(this.t * 0.67) * 2
        + Math.sin(this.t * 2.3) * 0.6;
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

      // Apply spring jelly to scale
      const jellyX = this._springSx;
      const jellyY = this._springSy;

      this.pet.style.transform = `translateX(${fidgetX}px) translateY(${floatY + bounce}px) rotate(${floatR + fidgetR}deg) scale(${this.curScale * breathScale * jellyX}, ${this.curScale * breathScale * jellyY})`;

      // Animate blob clip path for organic shape
      this._blobPhase += this._blobSpeed * 0.016;
      const blobVariation = this.currentMood === 'thinking' ? 4 : this.currentMood === 'talking' ? 3.5 : 3;
      this._blobPathEl.setAttribute('d', this._blobPath(this._blobPhase, 30, HALF, HALF, 8, blobVariation));

      // Animate internal floating particles
      for (const fp of this._floatingParticles) {
        fp.phase += fp.speed * 0.016;
        fp.x += fp.vx + Math.sin(fp.phase) * 0.15;
        fp.y += fp.vy + Math.cos(fp.phase * 0.7) * 0.12;
        // Bounce off borders (within the orb ~60px range)
        if (fp.x < 5 || fp.x > 55) fp.vx *= -1;
        if (fp.y < 5 || fp.y > 55) fp.vy *= -1;
        fp.x = Math.max(3, Math.min(57, fp.x));
        fp.y = Math.max(3, Math.min(57, fp.y));
        const alpha = 0.4 + Math.sin(fp.phase) * 0.3;
        fp.el.style.left = fp.x + '%';
        fp.el.style.top = fp.y + '%';
        fp.el.style.opacity = alpha.toFixed(2);
      }

      // Slowly animate turbulence seed for living distortion
      turbSeed += 0.003;
      // Only update every few frames to save perf
      if (Math.floor(this.t * 10) % 3 === 0) {
        this._turbulence.setAttribute('seed', turbSeed.toFixed(1));
      }

      // Update specular light position based on mouse (subtle)
      // Already tracked in _onMouseMove

      this._animFrame = requestAnimationFrame(loop);
    };
    loop();

    // Deep breath every 20-40s
    this._breathInterval = setInterval(() => {
      if (this.currentMood === 'talking' || this.currentMood === 'thinking') return;
      if (this.deepBreathPhase === 0 && Math.random() < 0.5) {
        this.deepBreathPhase = 0.01;
        this._jellyBounce(0.03); // subtle jelly on deep breath
      }
    }, 25000);
  }

  // ===== Blink System =====

  _doBlink() {
    if (this.currentMood === 'sleepy' || this.currentMood === 'happy') { this._scheduleBlink(); return; }
    this.mouseTracking = false;
    this._expr.blink();

    const r = Math.random();
    if (r < 0.15) {
      setTimeout(() => {
        this._expr.normal();
        setTimeout(() => { this._expr.blink(); setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 70); }, 100);
      }, 70);
    } else if (r < 0.3) {
      setTimeout(() => {
        this._expr.halfBlink();
        setTimeout(() => { this._expr.blink(); setTimeout(() => { this._applyMoodEyes(); this.mouseTracking = true; }, 80); }, 120);
      }, 80);
    } else {
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
      () => { this._expr.lookLeft(); setTimeout(() => { this._expr.lookRight(); setTimeout(() => this._expr.normal(), 500); }, 500); },
      () => { this._expr.curious(); setTimeout(() => this._expr.normal(), 800); },
      () => { this._expr.wink(); setTimeout(() => this._expr.normal(), 700); },
      () => { this._expr.hmm(); setTimeout(() => this._expr.normal(), 800); },
      () => { this._expr.sparkle(); setTimeout(() => this._expr.normal(), 500); },
      () => { this._expr.softSmile(); setTimeout(() => this._expr.normal(), 1000); },
      () => { this._expr.giggle(); this._jellyBounce(0.04); setTimeout(() => this._expr.normal(), 800); },
    ];

    this._idleInterval = setInterval(() => {
      this._checkIdleState();
      if (this.currentMood !== 'idle' || !this.mouseTracking) return;
      if (Math.random() < 0.3) {
        this.mouseTracking = false;
        microActions[Math.floor(Math.random() * microActions.length)]();
        setTimeout(() => { this.mouseTracking = true; }, 1500);
      }
    }, 4000);

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

  updateVisualizer(volume) {
    if (volume > 0.01) {
      this.vizRing.style.display = 'block';
      this.vizRing.style.opacity = '1';
      for (let i = 0; i < this.vizBars.length; i++) {
        const bar = this.vizBars[i];
        const variance = 0.5 + Math.sin(this.t * 8 + i * 0.7) * 0.5;
        const amp = volume * variance * 12 + 4;
        const ex = Math.cos(bar.angle) * (36 + amp);
        const ey = Math.sin(bar.angle) * (36 + amp);
        bar.line.setAttribute('x2', ex.toString());
        bar.line.setAttribute('y2', ey.toString());
        const hue = 340 + volume * 40;
        const alpha = 0.4 + volume * 0.5;
        bar.line.setAttribute('stroke', `hsla(${hue}, 80%, 75%, ${alpha})`);
      }
    } else {
      this.vizRing.style.opacity = '0';
      this.vizRing.style.display = 'none';
    }
  }

  // ===== Attention & Sleep =====

  bounce() {
    this.lastInteraction = Date.now();
    this._jellyBounce(0.15);
    this._expr.surprised();
    this._spawnParticles();
    setTimeout(() => { this._expr.happy(); }, 300);
    setTimeout(() => { this._applyMoodEyes(); }, 800);
  }

  _checkIdleState() {
    if (this.currentMood === 'offline' || this.currentState !== 'idle') return;
    const idleSeconds = (Date.now() - this.lastInteraction) / 1000;
    if (idleSeconds > 180 && this.currentMood !== 'sleepy') {
      this._setMood('sleepy');
    }
  }

  // ===== Click & Hover =====

  _onClick() {
    this.lastInteraction = Date.now();
    this._jellyBounce(0.12);
    this.pet.style.filter = 'brightness(1.15)';
    setTimeout(() => { this.pet.style.filter = ''; }, 350);
    this._spawnParticles();

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
      this._jellyBounce(0.02);
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

    // Subtle specular light tracking
    const lightX = 20 + dx * 5;
    const lightY = 15 + dy * 5;
    this._specLight.setAttribute('x', lightX.toString());
    this._specLight.setAttribute('y', lightY.toString());
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

if (typeof window !== 'undefined') {
  window.GlassOrbCharacter = GlassOrbCharacter;
}

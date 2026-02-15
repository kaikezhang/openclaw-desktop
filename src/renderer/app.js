// ===== State Machine =====
// States: idle | thinking | speaking
let appState = 'idle';
let isProcessing = false;
let auraAnimator = null;
let live2dManager = null;
let characterAnimator = null;
let audioPlayerQueue = null;
let streamingTTSStarted = false;
let lastAIResponse = '';
let isMiniMode = false;
const BUBBLE_AUTO_HIDE = 12000;
let followupTimer = null;
let bubbleHideTimer = null;
let lastBubbleText = '';  // Track what's already displayed in bubble
let bubbleScrollTimer = null;  // Auto-scroll timer for long text

// ===== DOM Elements =====
const speechBubble = document.getElementById('speech-bubble');
const bubbleText = document.getElementById('bubble-text');
const statusHint = document.getElementById('status-hint');
const characterArea = document.getElementById('character-area');
const stateIndicator = document.getElementById('state-indicator');
const stateDot = stateIndicator.querySelector('.state-dot');
const stateText = document.getElementById('state-text');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const tapHint = document.getElementById('tap-hint');
const listeningPulseRing = document.getElementById('listening-pulse-ring');
const miniOrb = document.getElementById('mini-orb');
const widgetContainer = document.getElementById('widget-container');

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Load theme from settings
  try {
    const settings = await window.electronAPI?.settings?.get();
    if (settings?.theme) {
      document.body.classList.add('theme-' + settings.theme);
    }
  } catch (e) { /* ignore */ }

  // Aura canvas
  const auraCanvas = document.getElementById('aura-canvas');
  if (auraCanvas && window.OrbAnimator) {
    auraAnimator = new OrbAnimator(auraCanvas);
  }

  // Character mode: 'sprite' | 'glassorb' | 'live2d'
  // Load saved preference, default to sprite
  let characterMode = 'sprite';
  try {
    const settings = await window.electronAPI?.settings?.get();
    if (settings?.characterMode) characterMode = settings.characterMode;
  } catch (e) { /* ignore */ }

  currentCharModeIndex = CHARACTER_MODES.indexOf(characterMode);
  if (currentCharModeIndex < 0) currentCharModeIndex = 0;
  initCharacterMode(characterMode);

  // Audio player queue
  if (window.AudioPlayerQueue) {
    audioPlayerQueue = new AudioPlayerQueue();
    audioPlayerQueue.onPlayStart = (text) => {
      showBubble(escapeHtml(text), false, true);
    };
    audioPlayerQueue.onQueueEmpty = () => {
      // TTS done — back to idle
      if (appState === 'speaking') {
        isProcessing = false;
        setAppState('idle');
      }
    };
  }

  initTTSListeners();

  // Session reset from tray menu
  window.electronAPI?.onSessionReset?.(() => {
    chatHistory = [];
    if (historyPanel) renderHistory();
    showBubble('New chat started ✨');
  });

  // Outfit change from gateway
  // Pending TTS to play after outfit swap completes
  window._outfitTTSPending = null;
  window.electronAPI?.onOutfitChange?.((data) => {
    console.log('[App] Outfit change:', data.status, data.outfit);
    if (data.status === 'loading') {
      showBubble('换装中～ 等一下下…');
      if (layeredSprite) layeredSprite.bounce();
    } else if (data.status === 'ready' && data.sprites && layeredSprite) {
      layeredSprite.swapOutfit(data.sprites);

      // Notify gateway about outfit change (for Discord selfie)
      if (data.outfit && data.outfit !== '__default__') {
        const desc = data.description || data.outfit;
        window.electronAPI?.notifyOutfitChanged?.(desc).catch(() => {});
      }

      // Release held streaming TTS audio
      if (window._outfitTTSHold) {
        window._outfitTTSHold = false;
        const held = window._outfitTTSHoldQueue || [];
        window._outfitTTSHoldQueue = [];
        console.log(`[App] Flushing ${held.length} held TTS chunks after outfit swap`);
        setAppState('speaking');
        for (const chunk of held) {
          if (audioPlayerQueue) audioPlayerQueue.enqueue(chunk.audio, chunk.text);
        }
      }
      // Play pending non-streaming TTS if held
      if (window._outfitTTSPending) {
        const { reply } = window._outfitTTSPending;
        window._outfitTTSPending = null;
        showBubble(escapeHtml(reply));
        playTTSForReply(reply);
      } else if (!window._outfitTTSHold) {
        // No pending TTS — say something about the new outfit
        const desc = data.description || data.outfit || '新衣服';
        const lines = [
          `换好啦～${desc}，好看吗？✨`,
          `${desc}上身！主人觉得怎么样？🎀`,
          `哒哒！${desc}的晚晚登场～好看吧！💕`,
          `${desc}换好了！是不是很可爱？🐱`,
        ];
        const line = lines[Math.floor(Math.random() * lines.length)];
        showBubble(escapeHtml(line));
        playTTSForReply(line);
      }
    } else if (data.status === 'error') {
      // Release held TTS on error too
      if (window._outfitTTSHold) {
        window._outfitTTSHold = false;
        const held = window._outfitTTSHoldQueue || [];
        window._outfitTTSHoldQueue = [];
        setAppState('speaking');
        for (const chunk of held) {
          if (audioPlayerQueue) audioPlayerQueue.enqueue(chunk.audio, chunk.text);
        }
      }
      if (window._outfitTTSPending) {
        const { reply } = window._outfitTTSPending;
        window._outfitTTSPending = null;
        showBubble(escapeHtml(reply));
        playTTSForReply(reply);
      } else {
        showBubble('换装失败了…');
      }
    }
  });

  initMiniMode();

  console.log('[App] Initialized');
});

// ===== Character Mode Management =====
let glassOrbCharacter = null;
let layeredSprite = null;

function initCharacterMode(mode) {
  // Stop all existing character renderers
  if (characterAnimator) { characterAnimator.stop(); characterAnimator = null; }
  if (glassOrbCharacter) { glassOrbCharacter.stop(); glassOrbCharacter = null; }
  if (layeredSprite) { layeredSprite.stop(); layeredSprite = null; }
  if (live2dManager) { live2dManager = null; }

  const l2dCanvas = document.getElementById('live2d-canvas');
  const spriteContainer = document.getElementById('character-sprite-container');
  const auraCanvas = document.getElementById('aura-canvas');

  // Hide all
  if (l2dCanvas) l2dCanvas.style.display = 'none';
  if (spriteContainer) { spriteContainer.style.display = 'none'; spriteContainer.innerHTML = ''; }
  // Hide aura for glass orb (it has its own visuals); show for other modes
  if (auraCanvas) auraCanvas.style.display = mode === 'glassorb' ? 'none' : 'block';

  switch (mode) {
    case 'glassorb':
      if (window.GlassOrbCharacter && spriteContainer) {
        spriteContainer.style.display = 'block';
        glassOrbCharacter = new GlassOrbCharacter('character-sprite-container');
        glassOrbCharacter.start();
        console.log('[App] Using GlassOrbCharacter (glass orb mode)');
      }
      break;
    case 'sprite':
      if (window.LayeredSpriteEngine && spriteContainer) {
        spriteContainer.style.display = 'block';
        layeredSprite = new LayeredSpriteEngine('character-sprite-container');
        layeredSprite.loadLayers('../../assets/character/wanwan/layers/final').then(() => { if (!layeredSprite) return;
          layeredSprite.start();
          // Set mini-orb avatar from sprite idle image
          const miniAvatar = document.getElementById('mini-orb-avatar');
          if (miniAvatar) {
            miniAvatar.style.backgroundImage = 'url(../../assets/character/wanwan/avatar.png)';
            miniAvatar.style.display = 'block';
            document.getElementById('mini-orb-canvas').style.display = 'none';
          }
        });
        console.log('[App] Using LayeredSpriteEngine (sprite mode)');
      } else if (window.CharacterAnimator && spriteContainer) {
        spriteContainer.style.display = 'block';
        characterAnimator = new CharacterAnimator('character-sprite-container');
        characterAnimator.start();
        console.log('[App] Using CharacterAnimator (sprite mode fallback)');
      }
      break;
    case 'live2d':
      if (l2dCanvas && window.Live2DManager) {
        l2dCanvas.style.display = 'block';
        // Ensure canvas has actual pixel dimensions before PixiJS init
        const parent = l2dCanvas.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          l2dCanvas.width = Math.round(rect.width) || 330;
          l2dCanvas.height = Math.round(rect.height) || 400;
        }
        // Delay init slightly to ensure layout is computed after display:block
        setTimeout(() => {
          live2dManager = new Live2DManager(l2dCanvas);
          live2dManager.init();
          live2dManager.loadModel('../../assets/models/Hiyori/Hiyori.model3.json');
          console.log('[App] Using Live2DManager (Live2D mode)');
        }, 50);
      }
      break;
  }
}

// Cycle through character modes: glassorb → sprite → live2d → glassorb
const CHARACTER_MODES = ['glassorb', 'sprite', 'live2d'];
let currentCharModeIndex = 0;

function cycleCharacterMode() {
  currentCharModeIndex = (currentCharModeIndex + 1) % CHARACTER_MODES.length;
  const newMode = CHARACTER_MODES[currentCharModeIndex];
  initCharacterMode(newMode);
  // Save preference
  if (window.electronAPI?.settings?.set) {
    window.electronAPI.settings.get().then(s => {
      s.characterMode = newMode;
      window.electronAPI.settings.set(s);
    }).catch(() => {});
  }
  return newMode;
}

// ===== State Management =====
function setAppState(newState) {
  appState = newState;
  clearTimeout(followupTimer);

  stateDot.className = 'state-dot';
  statusHint.className = 'status-hint';

  switch (newState) {
    case 'idle':
      stateText.textContent = window.I18N ? window.I18N.t('ready') : 'Ready';
      statusHint.textContent = '';
      break;
    case 'thinking':
      stateDot.classList.add('thinking');
      statusHint.classList.add('thinking');
      stateText.textContent = window.I18N ? window.I18N.t('thinking') : 'Thinking...';
      statusHint.textContent = window.I18N ? window.I18N.t('analyzing') : 'Analyzing your request';
      showBubble('<div class="thinking-dots"><span></span><span></span><span></span></div>', false);
      break;
    case 'speaking':
      stateDot.classList.add('speaking');
      statusHint.classList.add('speaking');
      stateText.textContent = window.I18N ? window.I18N.t('speaking') : 'Speaking...';
      statusHint.textContent = window.I18N ? window.I18N.t('replying') : 'Replying';
      break;
  }

  // Sync aura
  if (auraAnimator) {
    auraAnimator.setState(newState);
  }

  // Sync character animation
  if (characterAnimator) characterAnimator.setState(newState);
  if (glassOrbCharacter) glassOrbCharacter.setState(newState);
  if (layeredSprite) layeredSprite.setState(newState);
  if (live2dManager?.isLoaded) live2dManager.setMotion(newState);

  // Sync mini-orb
  if (isMiniMode) {
    setMiniOrbState(newState);
  }
}

// ===== TTS Listeners =====
function initTTSListeners() {
  window.electronAPI.tts.removeAllListeners();

  window.electronAPI.tts.onAudioChunk((data) => {
    if (window._outfitTTSHold) {
      // Buffer audio chunks while waiting for outfit swap
      window._outfitTTSHoldQueue = window._outfitTTSHoldQueue || [];
      window._outfitTTSHoldQueue.push(data);
      return;
    }
    if (audioPlayerQueue) {
      audioPlayerQueue.enqueue(data.audio, data.text);
    }
  });

  window.electronAPI.tts.onFirstSentence(() => {
    streamingTTSStarted = true;
    if (!window._outfitTTSHold && appState === 'thinking') {
      setAppState('speaking');
    }
  });
}

// ===== TTS Interrupt =====
function interruptTTS() {
  if (audioPlayerQueue) {
    audioPlayerQueue.stop();
  }
  window.electronAPI.tts.stop();
}

// ===== Character Click =====
function onCharacterClick() {
  // Speaking → interrupt
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    setAppState('idle');
    return;
  }

  // Thinking → cancel
  if (appState === 'thinking') {
    isProcessing = false;
    interruptTTS();
    setAppState('idle');
    showBubble('Cancelled');
    return;
  }

  // Idle → focus text input
  textInput.focus();
}

characterArea.addEventListener('click', onCharacterClick);

// ===== Command Handler =====
async function handleCommand(command) {
  if (isProcessing) return;
  isProcessing = true;

  // Add user message to history
  if (typeof addToHistory === 'function') addToHistory('user', command);

  setAppState('thinking');

  // Reset audio queue for new session
  if (audioPlayerQueue) {
    audioPlayerQueue.reset();
  }
  streamingTTSStarted = false;
  lastBubbleText = '';
  if (bubbleScrollTimer) { clearInterval(bubbleScrollTimer); bubbleScrollTimer = null; }

  try {
    // Check if user is requesting outfit change BEFORE sending to AI
    let outfitGenerating = false;
    const outfitRequest = detectOutfitRequest(command);
    if (outfitRequest) {
      console.log('[App] Outfit request detected:', outfitRequest);

      // Instant voice feedback before generation starts
      const loadingMsg = `好的～晚晚这就去换${outfitRequest}，稍等一下哦～`;
      setAppState('speaking');
      showBubble(escapeHtml(loadingMsg));
      await playTTSForReply(loadingMsg);

      const res = await window.electronAPI?.requestOutfit?.(outfitRequest);
      console.log('[App] Outfit request result:', res);
      if (res?.cached) {
        outfitGenerating = false;
      }
      if (res && !res.cached) {
        outfitGenerating = true;
        window._outfitTTSHold = true;
        window._outfitTTSHoldQueue = [];
      }
    }

    const result = await window.electronAPI.chat(command);
    let reply = cleanMarkdown(result.message || '');
    lastAIResponse = reply;

    // Check AI reply for __OUTFIT:name__ trigger
    const outfitMatch = reply.match(/__OUTFIT:([a-zA-Z0-9_-]+)__/);
    if (outfitMatch) {
      const outfitName = outfitMatch[1];
      reply = reply.replace(/__OUTFIT:[a-zA-Z0-9_-]+__/g, '').trim();
      lastAIResponse = reply;
      window.electronAPI?.loadOutfit?.(outfitName);
    }

    // Also detect outfit intent in AI reply (e.g. "给你换个丝绸吊带睡裙")
    if (!outfitMatch && !outfitRequest) {
      const aiOutfit = detectOutfitInReply(reply);
      if (aiOutfit) {
        console.log('[App] AI suggested outfit change:', aiOutfit);
        window.electronAPI?.requestOutfit?.(aiOutfit);
      }
    }

    // Bounce character on new response
    if (glassOrbCharacter) glassOrbCharacter.bounce();
    if (layeredSprite) layeredSprite.bounce();

    // System notification if window not focused
    if (!document.hasFocus() && window.electronAPI?.notify) {
      const preview = reply.length > 80 ? reply.substring(0, 80) + '...' : reply;
      window.electronAPI.notify('OpenClaw', preview);
    }

    // Add AI reply to history
    if (typeof addToHistory === 'function') addToHistory('assistant', reply);

    // If streaming TTS already handled it, we're done.
    // Otherwise fall back to non-streaming TTS.
    if (!streamingTTSStarted && !audioPlayerQueue?.playing && audioPlayerQueue?.queue?.length === 0) {
      if (outfitGenerating) {
        // Hold TTS until outfit swap completes
        console.log('[App] Holding TTS for outfit generation...');
        window._outfitTTSPending = { reply };
        // outfit:change handler will play TTS + set idle
      } else {
        setAppState('speaking');
        showBubble(escapeHtml(reply));
        await playTTSForReply(reply);
        isProcessing = false;
        setAppState('idle');
      }
    }
  } catch (error) {
    console.error('[Command] Failed:', error);
    showBubble('Something went wrong');
    setAppState('idle');
    isProcessing = false;
  }
}

// ===== Text Input =====
async function handleTextInput() {
  const text = textInput.value.trim();
  if (!text || isProcessing) return;
  textInput.value = '';
  showBubble(escapeHtml(text), true);
  await handleCommand(text);
}

sendBtn.addEventListener('click', handleTextInput);
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleTextInput();
});

// ===== Window Controls =====
minimizeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.minimizeWindow();
});

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.electronAPI.closeWindow();
});

// ===== Mini-Orb Mode =====
let miniOrbClickTimer = null;

function initMiniMode() {
  window.electronAPI.onMiniMode((isMini) => {
    if (isMini) enterMiniMode();
    else exitMiniMode();
  });

  miniOrb.addEventListener('click', (e) => {
    if (e.target.closest('.mini-expand-btn')) return;

    if (miniOrbClickTimer) {
      clearTimeout(miniOrbClickTimer);
      miniOrbClickTimer = null;
      window.electronAPI.restoreWindow();
    } else {
      miniOrbClickTimer = setTimeout(() => {
        miniOrbClickTimer = null;
        onMiniOrbTap();
      }, 250);
    }
  });

  const expandBtn = document.getElementById('mini-expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.restoreWindow();
    });
  }
}

function onMiniOrbTap() {
  if (!isMiniMode) return;

  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    setAppState('idle');
    return;
  }

  // Restore from mini mode to type
  window.electronAPI?.restoreWindow?.();
}

function setMiniOrbState(state) {
  if (!isMiniMode) return;
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  if (state === 'listening' || state === 'followup') miniOrb.classList.add('mini-listening');
  else if (state === 'thinking') miniOrb.classList.add('mini-thinking');
  else if (state === 'speaking') miniOrb.classList.add('mini-speaking');
}

function enterMiniMode() {
  isMiniMode = true;
  widgetContainer.style.display = 'none';
  miniOrb.style.display = 'flex';
  setMiniOrbState(appState);
}

function exitMiniMode() {
  isMiniMode = false;
  miniOrb.style.display = 'none';
  miniOrb.classList.remove('mini-listening', 'mini-thinking', 'mini-speaking');
  widgetContainer.style.display = 'flex';
}

// ===== Bubble =====
let typewriterTimer = null;

function showBubble(content, isUser = false, instant = false) {
  clearTimeout(bubbleHideTimer);
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }

  speechBubble.style.display = 'block';
  speechBubble.style.opacity = '1';

  if (isUser) {
    speechBubble.className = 'speech-bubble user-speech';
    bubbleText.innerHTML = content;
  } else {
    speechBubble.className = 'speech-bubble ai-response';

    if (instant || content.includes('<')) {
      // Instant display for TTS playback or HTML content
      bubbleText.textContent = content.includes('<') ? '' : content;
      if (content.includes('<')) bubbleText.innerHTML = content;
      lastBubbleText = content;
      // Start smooth auto-scroll if text overflows
      if (bubbleScrollTimer) { clearInterval(bubbleScrollTimer); bubbleScrollTimer = null; }
      speechBubble.scrollTop = 0;
      requestAnimationFrame(() => {
        if (speechBubble.scrollHeight > speechBubble.clientHeight) {
          const scrollDistance = speechBubble.scrollHeight - speechBubble.clientHeight;
          const duration = 4000; // scroll over 4 seconds
          const startTime = Date.now();
          bubbleScrollTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-in-out
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            speechBubble.scrollTop = ease * scrollDistance;
            if (progress >= 1) { clearInterval(bubbleScrollTimer); bubbleScrollTimer = null; }
          }, 16);
        }
      });
    } else {
      // Typewriter effect for non-TTS AI responses
      lastBubbleText = content;
      bubbleText.textContent = '';
      let i = 0;
      const text = content;
      typewriterTimer = setInterval(() => {
        if (i < text.length) {
          bubbleText.textContent += text[i];
          i++;
          speechBubble.scrollTop = speechBubble.scrollHeight;
        } else {
          clearInterval(typewriterTimer);
          typewriterTimer = null;
        }
      }, 30);
    }
  }

  // Don't auto-hide while speaking — bubble stays until TTS is done
  if (appState !== 'speaking') {
    bubbleHideTimer = setTimeout(() => hideBubble(), BUBBLE_AUTO_HIDE);
  }
}

function hideBubble(delay) {
  if (delay) {
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => fadeOutBubble(), delay);
  } else {
    fadeOutBubble();
  }
}

function fadeOutBubble() {
  speechBubble.style.transition = 'opacity 0.3s ease-out';
  speechBubble.style.opacity = '0';
  setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.style.opacity = '1';
    speechBubble.style.transition = '';
  }, 300);
}

// ===== Outfit Detection =====
async function playTTSForReply(reply) {
  setAppState('speaking');
  try {
    const ttsResult = await window.electronAPI.tts.synthesize(reply);
    if (ttsResult?.success) {
      const audio = new Audio('data:audio/mp3;base64,' + ttsResult.audio);
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    }
  } catch (e) {
    console.error('[TTS] playTTSForReply error:', e);
  }
  isProcessing = false;
  setAppState('idle');
}

function detectOutfitRequest(text) {
  // Detect outfit change intent — returns the outfit description or null
  const patterns = [
    /穿[个一件套身]?(.{1,20}?)(?:吧|呗|看看|的样子|$)/,
    /换[上成]?[个一件套身]?(.{1,20}?)(?:吧|呗|看看|$)/,
    /(?:想看你|给我)穿[个一件套]?(.{1,20})/,
    /wear\s+(?:a\s+)?(.{1,30})/i,
    /change.*?(?:to|into)\s+(?:a\s+)?(.{1,30})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const desc = m[1].replace(/^[的地得]/, '').trim();
      if (desc.length > 0 && desc.length < 30) return desc;
    }
  }
  return null;
}

function detectOutfitInReply(text) {
  // Detect when AI says it will change outfit (e.g. "给你换个xxx" "穿上xxx给你看")
  const patterns = [
    /(?:给你|帮你|我来|这就|马上)换[上个一件套身]?(.{2,20}?)(?:[吧呗啦了！!？?～~]|$)/,
    /换[上成]?[个一件套身]?(.{2,20}?)(?:给你|怎么样|好不好|[吧呗啦了！!？?～~]|$)/,
    /穿[上个一件套]?(.{2,20}?)(?:给你看|怎么样|好不好|[吧呗啦了！!？?～~]|$)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const desc = m[1].replace(/^[的地得]/, '').trim();
      if (desc.length >= 2 && desc.length < 25) return desc;
    }
  }
  return null;
}

// ===== Utilities =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function cleanMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

// ===== Chat History =====
let chatHistory = [];
const historyPanel = document.getElementById('chat-history-panel');
const historyMessages = document.getElementById('chat-history-messages');
const historyBtn = document.getElementById('history-btn');
const closeHistoryBtn = document.getElementById('close-history-btn');

function addToHistory(role, text) {
  chatHistory.push({ role, text, time: new Date() });
  renderHistory();
}

function renderHistory() {
  if (!historyMessages) return;
  historyMessages.innerHTML = chatHistory.map(m => {
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const time = m.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="chat-msg ${cls}">${escapeHtml(m.text)}<div class="timestamp">${time}</div></div>`;
  }).join('');
  historyMessages.scrollTop = historyMessages.scrollHeight;
}

// Mode toggle — cycle glassorb / sprite / live2d
const modeToggleBtn = document.getElementById('mode-toggle-btn');
if (modeToggleBtn) {
  modeToggleBtn.addEventListener('click', () => {
    const newMode = cycleCharacterMode();
    const labels = { glassorb: '🫧 Glass Orb', sprite: '🎨 Sprite', live2d: '🎭 Live2D' };
    modeToggleBtn.title = labels[newMode] || newMode;
  });
}

if (historyBtn) {
  historyBtn.addEventListener('click', () => {
    if (historyPanel) {
      const isVisible = historyPanel.style.display !== 'none';
      historyPanel.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) renderHistory();
    }
  });
}

if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener('click', () => {
    if (historyPanel) historyPanel.style.display = 'none';
  });
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  // Escape: cancel current action / close panels
  if (e.key === 'Escape') {
    if (wardrobePanel && wardrobePanel.style.display !== 'none') {
      wardrobePanel.style.display = 'none';
      return;
    }
    if (historyPanel && historyPanel.style.display !== 'none') {
      historyPanel.style.display = 'none';
      return;
    }
    if (appState === 'thinking') {
      isProcessing = false;
      interruptTTS();
      setAppState('idle');
      showBubble(window.I18N ? window.I18N.t('cancelled') : 'Cancelled');
      return;
    }
    if (appState === 'speaking') {
      interruptTTS();
      isProcessing = false;
      setAppState('idle');
      return;
    }
  }

  // Ctrl+H / Cmd+H: toggle history
  if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    if (historyPanel) {
      const isVisible = historyPanel.style.display !== 'none';
      historyPanel.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) renderHistory();
    }
  }

  // / : focus text input
  if (e.key === '/' && document.activeElement !== textInput) {
    e.preventDefault();
    textInput.focus();
  }
});

// ===== Wardrobe =====
const wardrobePanel = document.getElementById('wardrobe-panel');
const wardrobeGrid = document.getElementById('wardrobe-grid');
const closeWardrobeBtn = document.getElementById('close-wardrobe-btn');

let wardrobeCurrentOutfit = '__default__';

async function openWardrobe() {
  if (!wardrobePanel) return;
  wardrobePanel.style.display = 'flex';
  wardrobeGrid.innerHTML = '<div class="wardrobe-empty">加载中…</div>';

  try {
    const res = await window.electronAPI?.listOutfits?.();
    if (!res?.success || !res.outfits?.length) {
      wardrobeGrid.innerHTML = '<div class="wardrobe-empty">衣橱空空的～<br>跟晚晚说"换装"试试！</div>';
      return;
    }

    // Add default outfit first
    const allOutfits = [
      { name: '__default__', description: '默认校服', timestamp: '2026-01-01T00:00:00Z' },
      ...res.outfits,
    ];

    wardrobeGrid.innerHTML = '';

    for (const outfit of allOutfits) {
      const item = document.createElement('div');
      item.className = 'wardrobe-item' + (wardrobeCurrentOutfit === outfit.name ? ' active' : '');

      if (outfit.name === '__default__') {
        // Default outfit uses the base sprite
        item.innerHTML = `
          <img src="../../assets/character/wanwan/layers/final/char-idle.png" alt="默认">
          ${wardrobeCurrentOutfit === outfit.name ? '<div class="outfit-check">✓</div>' : ''}
          <div class="outfit-label">${outfit.description}</div>
        `;
      } else {
        // Load thumbnail
        item.innerHTML = `
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;">加载中</div>
          ${wardrobeCurrentOutfit === outfit.name ? '<div class="outfit-check">✓</div>' : ''}
          <div class="outfit-label">${outfit.description}</div>
        `;
        // Async load thumbnail
        window.electronAPI?.getOutfitThumbnail?.(outfit.name).then(thumbRes => {
          if (thumbRes?.success && thumbRes.idle) {
            const img = document.createElement('img');
            img.src = 'data:image/png;base64,' + thumbRes.idle;
            img.alt = outfit.description;
            // Replace the loading placeholder
            const placeholder = item.querySelector('div[style]');
            if (placeholder) item.replaceChild(img, placeholder);
            else item.insertBefore(img, item.firstChild);
          }
        });
      }

      item.addEventListener('click', async () => {
        if (outfit.name === '__default__') {
          // Reset to default sprites
          wardrobeCurrentOutfit = '__default__';
          if (window.layeredSpriteEngine) {
            window.layeredSpriteEngine.resetToDefault?.();
          }
        } else {
          wardrobeCurrentOutfit = outfit.name;
          await window.electronAPI?.loadOutfit?.(outfit.name);
        }
        // Re-render to update active state
        openWardrobe();
      });

      wardrobeGrid.appendChild(item);
    }
  } catch (e) {
    wardrobeGrid.innerHTML = '<div class="wardrobe-empty">加载失败 😿</div>';
    console.error('[Wardrobe] Error:', e);
  }
}

if (closeWardrobeBtn) {
  closeWardrobeBtn.addEventListener('click', () => {
    if (wardrobePanel) wardrobePanel.style.display = 'none';
  });
}

// Track current outfit from outfit:change events
window.electronAPI?.onOutfitChange?.((data) => {
  if (data.status === 'ready' && data.outfit) {
    wardrobeCurrentOutfit = data.outfit;
  }
});

// ===== Context Menu =====
characterArea.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `
    position: fixed; left: ${e.clientX}px; top: ${e.clientY}px; z-index: 999;
    background: var(--bg-secondary, #1e1e3a); border: 1px solid var(--border-color, #333);
    border-radius: 8px; padding: 4px 0; min-width: 160px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-size: 13px;
  `;

  const items = [
    { label: window.I18N ? window.I18N.t('mode-glassorb') : '🫧 Glass Orb', action: () => { initCharacterMode('glassorb'); currentCharModeIndex = 0; } },
    { label: window.I18N ? window.I18N.t('mode-sprite') : '🎨 Sprite', action: () => { initCharacterMode('sprite'); currentCharModeIndex = 1; } },
    { label: window.I18N ? window.I18N.t('mode-live2d') : '🎭 Live2D', action: () => { initCharacterMode('live2d'); currentCharModeIndex = 2; } },
    { divider: true },
    { label: '👗 衣橱 Wardrobe', action: () => openWardrobe() },
    { divider: true },
    { label: '🔄 New Chat', action: async () => { await window.electronAPI?.newSession?.(); chatHistory = []; if (historyPanel) renderHistory(); showBubble('New chat started ✨'); } },
    { label: window.I18N ? window.I18N.t('chat-history') : 'Chat History', action: () => { if (historyPanel) { historyPanel.style.display = 'flex'; renderHistory(); } } },
    { label: window.I18N ? window.I18N.t('settings-title') : '⚙️ Settings', action: () => { window.electronAPI?.settings?.get(); /* trigger settings window via tray */ } },
  ];

  for (const item of items) {
    if (item.divider) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:var(--border-color,#333);margin:4px 8px;';
      menu.appendChild(hr);
      continue;
    }
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.cssText = `
      padding: 6px 16px; cursor: pointer; color: var(--text-primary, #e0e0e0);
      transition: background 0.15s;
    `;
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(124,111,239,0.15)'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', () => {
      item.action();
      menu.remove();
    });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);

  // Close on click outside
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
});

// ===== Audio Visualization Loop =====
function startVizLoop() {
  function vizFrame() {
    if (audioPlayerQueue) {
      const vol = audioPlayerQueue.getVolume();
      // Glass orb visualizer
      if (glassOrbCharacter) {
        glassOrbCharacter.updateVisualizer(vol);
      }
      // Sprite lip sync
      if (layeredSprite) {
        layeredSprite.updateVisualizer(vol);
      }
      // Live2D lip sync
      if (live2dManager?.isLoaded) {
        live2dManager.setLipSync(vol);
      }
    }
    requestAnimationFrame(vizFrame);
  }
  vizFrame();
}
startVizLoop();

// ===== Connection Status Polling =====
let wasConnected = false;

async function checkConnectionStatus() {
  try {
    const status = await window.electronAPI?.getConnectionStatus?.();
    if (!status) return;

    const isConnected = status.connected;
    if (!wasConnected && isConnected) {
      // Just connected — revival animation
      if (glassOrbCharacter) {
        glassOrbCharacter.setState('idle');
        glassOrbCharacter._spawnParticles();
        glassOrbCharacter._spawnParticles();
      }
      if (layeredSprite) layeredSprite.bounce();
      console.log('[App] Gateway connected');
    } else if (wasConnected && !isConnected) {
      // Disconnected — show offline state
      if (glassOrbCharacter) {
        glassOrbCharacter._setMood('offline');
      }
      console.log('[App] Gateway disconnected');
    }
    wasConnected = isConnected;
  } catch (e) { /* ignore */ }
}

// Poll every 10 seconds
setInterval(checkConnectionStatus, 10000);
// Initial check
setTimeout(checkConnectionStatus, 2000);

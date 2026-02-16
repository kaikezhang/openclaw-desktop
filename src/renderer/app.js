// ===== State Machine =====
// States: idle | thinking | speaking
let appState = 'idle';
let isProcessing = false;
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

  // Initialize sprite mode
  initCharacterMode();

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
  window._lastOutfitChangeTime = 0;
  window.electronAPI?.onOutfitChange?.((data) => {
    console.log('[App] Outfit change:', data.status, data.outfit);

    // Debounce: ignore rapid-fire outfit changes (< 2s apart)
    const now = Date.now();
    if (data.status === 'ready' && now - window._lastOutfitChangeTime < 2000) {
      console.log('[App] Outfit change debounced');
      // Still swap sprites silently
      if (data.sprites && layeredSprite) layeredSprite.swapOutfit(data.sprites);
      return;
    }
    if (data.status === 'ready') window._lastOutfitChangeTime = now;

    if (data.status === 'loading') {
      showBubble('换装中～ 等一下下…');
      if (layeredSprite) layeredSprite.bounce();
    } else if (data.status === 'ready' && data.sprites && layeredSprite) {
      layeredSprite.swapOutfit(data.sprites);

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
  initExternalChatListeners();

  console.log('[App] Initialized');
});

// ===== Character Mode Management =====
let layeredSprite = null;

function initCharacterMode() {
  // Stop existing character renderers
  if (characterAnimator) { characterAnimator.stop(); characterAnimator = null; }
  if (layeredSprite) { layeredSprite.stop(); layeredSprite = null; }

  const spriteContainer = document.getElementById('character-sprite-container');

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

  // Sync character animation
  if (characterAnimator) characterAnimator.setState(newState);
  if (layeredSprite) layeredSprite.setState(newState);

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

// ===== External Chat (from sessions_send / other sessions) =====
function initExternalChatListeners() {
  // When an external session triggers a run on our session
  window.electronAPI?.onExternalChatStarted?.(() => {
    console.log('[App] External chat started');
    if (audioPlayerQueue) audioPlayerQueue.reset();
    streamingTTSStarted = false;
    lastBubbleText = '';
    setAppState('thinking');
    isProcessing = true;
  });

  // When the external chat run completes with final text
  window.electronAPI?.onExternalChat?.((data) => {
    console.log('[App] External chat final:', data.text?.substring(0, 60));
    const reply = cleanMarkdown(data.text || '');
    lastAIResponse = reply;

    // Bounce character
    if (layeredSprite) layeredSprite.bounce();

    // Add to history
    if (typeof addToHistory === 'function') addToHistory('assistant', reply);

    // Show bubble — TTS is already being handled by main process via onEvent→splitter
    showBubble(escapeHtml(reply));

    // If TTS didn't start (very short text), show bubble and go idle after delay
    if (!streamingTTSStarted && !audioPlayerQueue?.playing && audioPlayerQueue?.queue?.length === 0) {
      // TTS chunks may still arrive, wait a moment
      setTimeout(() => {
        if (!audioPlayerQueue?.playing && audioPlayerQueue?.queue?.length === 0) {
          isProcessing = false;
          setAppState('idle');
        }
      }, 2000);
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
    const result = await window.electronAPI.chat(command);
    let reply = cleanMarkdown(result.message || '');
    lastAIResponse = reply;

    // AI-driven outfit change: look for __OUTFIT:描述__ tag in reply
    const outfitMatch = reply.match(/__OUTFIT:(.+?)__/);
    if (outfitMatch) {
      const outfitDesc = outfitMatch[1].trim();
      reply = reply.replace(/__OUTFIT:.+?__/g, '').trim();
      lastAIResponse = reply;
      console.log('[App] AI requested outfit change:', outfitDesc);
      window.electronAPI?.requestOutfit?.(outfitDesc);
    }

    // Bounce character on new response
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

// Outfit detection is now fully AI-driven via __OUTFIT:描述__ tags in replies.
// No client-side regex needed.

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
      closeWardrobeAndApply();
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

      item.addEventListener('click', () => {
        // Just select, don't apply yet — apply on wardrobe close
        window._wardrobePendingOutfit = outfit;
        // Update visual selection
        document.querySelectorAll('.wardrobe-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        // Re-render to show selection
        wardrobeCurrentOutfit = outfit.name;
        openWardrobe();
      });

      wardrobeGrid.appendChild(item);
    }
  } catch (e) {
    wardrobeGrid.innerHTML = '<div class="wardrobe-empty">加载失败 😿</div>';
    console.error('[Wardrobe] Error:', e);
  }
}

function closeWardrobeAndApply() {
  if (wardrobePanel) wardrobePanel.style.display = 'none';

  const pending = window._wardrobePendingOutfit;
  window._wardrobePendingOutfit = null;
  if (!pending) return;

  // Wait 0.5s after close, then apply with transition
  setTimeout(async () => {
    if (pending.name === '__default__') {
      if (layeredSprite) layeredSprite.resetToDefault?.();
    } else {
      window._wardrobeTriggered = true;
      await window.electronAPI?.loadOutfit?.(pending.name);
    }
  }, 500);
}

if (closeWardrobeBtn) {
  closeWardrobeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    closeWardrobeAndApply();
  });
  // Also close on mousedown for snappier feel (in case click gets swallowed)
  closeWardrobeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
}
// Escape key closes wardrobe
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && wardrobePanel && wardrobePanel.style.display !== 'none') {
    closeWardrobeAndApply();
  }
});

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
    { label: '👗 衣橱 Wardrobe', action: () => openWardrobe() },
    { divider: true },
    { label: '🔄 New Chat', action: async () => { await window.electronAPI?.newSession?.(); chatHistory = []; if (historyPanel) renderHistory(); showBubble('New chat started ✨'); } },
    { label: window.I18N ? window.I18N.t('chat-history') : 'Chat History', action: () => { if (historyPanel) { historyPanel.style.display = 'flex'; renderHistory(); } } },
    { label: window.I18N ? window.I18N.t('settings-title') : '⚙️ Settings', action: () => { window.electronAPI?.settings?.open(); } },
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
      // Sprite lip sync
      if (layeredSprite) {
        layeredSprite.updateVisualizer(vol);
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
      if (layeredSprite) layeredSprite.bounce();
      console.log('[App] Gateway connected');
    } else if (wasConnected && !isConnected) {
      console.log('[App] Gateway disconnected');
    }
    wasConnected = isConnected;
  } catch (e) { /* ignore */ }
}

// Poll every 10 seconds
setInterval(checkConnectionStatus, 10000);
// Initial check
setTimeout(checkConnectionStatus, 2000);

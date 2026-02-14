// ===== State Machine =====
// States: idle | listening | thinking | speaking | followup
let appState = 'idle';
let isRecording = false;
let isProcessing = false;
let audioStream = null;
let audioContext = null;
let audioWorkletNode = null;
let auraAnimator = null;
let live2dManager = null;
let characterAnimator = null;
let audioPlayerQueue = null;
let executeTimer = null;
let countdownInterval = null;
let accumulatedTranscript = '';
let lastAIResponse = '';
let isMiniMode = false;

const FOLLOWUP_TIMEOUT = 30000;
const BUBBLE_AUTO_HIDE = 12000;
const EXECUTE_DELAY = 3000;

let followupTimer = null;
let bubbleHideTimer = null;

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
  // Load saved preference, default to glassorb
  let characterMode = 'glassorb';
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
      showBubble(escapeHtml(text));
    };
    audioPlayerQueue.onQueueEmpty = () => {
      // TTS done — enter followup mode
      if (appState === 'speaking') {
        isProcessing = false;
        setAppState('followup');
        startRecording();
      }
    };
  }

  initSTTListeners();
  initTTSListeners();
  initMiniMode();

  console.log('[App] Initialized');
});

// ===== Character Mode Management =====
let glassOrbCharacter = null;

function initCharacterMode(mode) {
  // Stop all existing character renderers
  if (characterAnimator) { characterAnimator.stop(); characterAnimator = null; }
  if (glassOrbCharacter) { glassOrbCharacter.stop(); glassOrbCharacter = null; }
  if (live2dManager) { live2dManager = null; }

  const l2dCanvas = document.getElementById('live2d-canvas');
  const spriteContainer = document.getElementById('character-sprite-container');

  // Hide all
  if (l2dCanvas) l2dCanvas.style.display = 'none';
  if (spriteContainer) { spriteContainer.style.display = 'none'; spriteContainer.innerHTML = ''; }

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
      if (window.CharacterAnimator && spriteContainer) {
        spriteContainer.style.display = 'block';
        characterAnimator = new CharacterAnimator('character-sprite-container');
        characterAnimator.start();
        console.log('[App] Using CharacterAnimator (sprite mode)');
      }
      break;
    case 'live2d':
      if (l2dCanvas && window.Live2DManager) {
        l2dCanvas.style.display = 'block';
        live2dManager = new Live2DManager(l2dCanvas);
        live2dManager.init();
        live2dManager.loadModel('../../assets/models/Hiyori/Hiyori.model3.json');
        console.log('[App] Using Live2DManager (Live2D mode)');
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

  // Tap hint visibility
  if (newState === 'idle') {
    tapHint.classList.remove('hidden');
  } else {
    tapHint.classList.add('hidden');
  }

  // Pulse ring
  if (newState === 'listening' || newState === 'followup') {
    listeningPulseRing.classList.remove('hidden');
  } else {
    listeningPulseRing.classList.add('hidden');
  }

  switch (newState) {
    case 'idle':
      stateText.textContent = 'Tap to start';
      statusHint.textContent = '';
      break;
    case 'listening':
      stateDot.classList.add('listening');
      statusHint.classList.add('listening');
      stateText.textContent = 'Listening...';
      statusHint.textContent = 'Speak now...';
      break;
    case 'thinking':
      stateDot.classList.add('thinking');
      statusHint.classList.add('thinking');
      stateText.textContent = 'Thinking...';
      statusHint.textContent = 'Analyzing your request';
      showBubble('<div class="thinking-dots"><span></span><span></span><span></span></div>', false);
      break;
    case 'speaking':
      stateDot.classList.add('speaking');
      statusHint.classList.add('speaking');
      stateText.textContent = 'Speaking...';
      statusHint.textContent = 'Replying';
      break;
    case 'followup':
      stateDot.classList.add('listening');
      statusHint.classList.add('listening');
      stateText.textContent = 'Continue speaking...';
      statusHint.textContent = 'Ask a follow-up';
      followupTimer = setTimeout(() => {
        stopRecording().then(() => {
          setAppState('idle');
          hideBubble(2000);
        });
      }, FOLLOWUP_TIMEOUT);
      break;
  }

  // Sync aura
  if (auraAnimator) {
    const orbState = newState === 'followup' ? 'listening' : newState;
    auraAnimator.setState(orbState);
  }

  // Sync character animation
  const charState = newState === 'followup' ? 'listening' : newState;
  if (characterAnimator) characterAnimator.setState(charState);
  if (glassOrbCharacter) glassOrbCharacter.setState(charState);
  if (live2dManager?.isLoaded) live2dManager.setMotion(charState);

  // Sync mini-orb
  if (isMiniMode) {
    setMiniOrbState(newState);
  }
}

// ===== STT Listeners =====
function initSTTListeners() {
  window.electronAPI.stt.removeAllListeners();

  window.electronAPI.stt.onConnected(() => {
    console.log('[STT] Connected');
  });

  window.electronAPI.stt.onTranscript((data) => {
    const { transcript, isFinal } = data;

    if (isFinal) {
      if (transcript.trim().length > 0) {
        accumulatedTranscript += (accumulatedTranscript.length > 0 ? ' ' : '') + transcript.trim();
        showBubble(escapeHtml(accumulatedTranscript), true);

        clearTimeout(executeTimer);

        executeTimer = setTimeout(() => {
          clearInterval(countdownInterval);
          const cmd = accumulatedTranscript;
          accumulatedTranscript = '';
          stopRecording().then(() => handleCommand(cmd));
        }, EXECUTE_DELAY);

        // Countdown
        let countdown = Math.ceil(EXECUTE_DELAY / 1000);
        clearInterval(countdownInterval);
        statusHint.textContent = `Executing in ${countdown}s...`;
        countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            statusHint.textContent = `Executing in ${countdown}s...`;
          } else {
            clearInterval(countdownInterval);
          }
        }, 1000);
      }
    } else {
      if (transcript.trim().length > 0) {
        statusHint.textContent = transcript + '...';
      }
    }
  });

  window.electronAPI.stt.onUtteranceEnd(() => {
    if (accumulatedTranscript.trim().length > 0) {
      clearTimeout(executeTimer);
      clearInterval(countdownInterval);
      const cmd = accumulatedTranscript;
      accumulatedTranscript = '';
      stopRecording().then(() => handleCommand(cmd));
    }
  });

  window.electronAPI.stt.onError((error) => {
    console.error('[STT] Error:', error);
    stopRecording();
    setAppState('idle');
    showBubble('Speech recognition error');
  });

  window.electronAPI.stt.onClosed(() => {
    console.log('[STT] Connection closed');
  });
}

// ===== TTS Listeners =====
function initTTSListeners() {
  window.electronAPI.tts.removeAllListeners();

  window.electronAPI.tts.onAudioChunk((data) => {
    if (audioPlayerQueue) {
      audioPlayerQueue.enqueue(data.audio, data.text);
    }
  });

  window.electronAPI.tts.onFirstSentence(() => {
    if (appState === 'thinking') {
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

// ===== Recording =====
async function startRecording() {
  if (isRecording || isProcessing) return;

  try {
    interruptTTS();

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
      },
    });

    const result = await window.electronAPI.stt.startListening();
    if (!result.success) {
      showBubble('STT failed: ' + (result.error || 'unknown'));
      setAppState('idle');
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    await audioContext.audioWorklet.addModule('audio-processor.js');
    const source = audioContext.createMediaStreamSource(audioStream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    audioWorkletNode.port.onmessage = (event) => {
      if (isRecording && event.data) {
        window.electronAPI.stt.sendAudio(new Uint8Array(event.data));
      }
    };

    source.connect(audioWorkletNode);
    isRecording = true;
  } catch (error) {
    console.error('[Recording] Failed:', error);
    setAppState('idle');
    if (error.name === 'NotAllowedError') {
      showBubble('Microphone access denied');
    } else if (error.name === 'NotFoundError') {
      showBubble('No microphone found');
    } else {
      showBubble('Recording failed: ' + error.message);
    }
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  clearTimeout(executeTimer);
  clearInterval(countdownInterval);

  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    try { audioWorkletNode.port.close(); } catch (_) {}
    audioWorkletNode = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }

  await window.electronAPI.stt.stopListening();
}

// ===== Character Click =====
async function onCharacterClick() {
  // Speaking → interrupt & listen
  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    accumulatedTranscript = '';
    setAppState('listening');
    await startRecording();
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

  if (isProcessing) return;

  // Toggle listening
  if (appState === 'listening' || appState === 'followup') {
    clearTimeout(executeTimer);
    accumulatedTranscript = '';
    await stopRecording();
    setAppState('idle');
    return;
  }

  accumulatedTranscript = '';
  hideBubble();
  setAppState('listening');
  await startRecording();
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

  try {
    const result = await window.electronAPI.chat(command);
    const reply = cleanMarkdown(result.message || '');
    lastAIResponse = reply;

    // Add AI reply to history
    if (typeof addToHistory === 'function') addToHistory('assistant', reply);

    // If streaming TTS already handled it, we're done.
    // Otherwise fall back to non-streaming TTS.
    if (!audioPlayerQueue?.playing && audioPlayerQueue?.queue?.length === 0) {
      setAppState('speaking');
      showBubble(escapeHtml(reply));

      const ttsResult = await window.electronAPI.tts.synthesize(reply);
      if (ttsResult?.success) {
        const audio = new Audio('data:audio/mp3;base64,' + ttsResult.audio);
        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;
          audio.play().catch(resolve);
        });
      }

      isProcessing = false;
      setAppState('followup');
      await startRecording();
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

async function onMiniOrbTap() {
  if (!isMiniMode) return;

  if (appState === 'speaking') {
    interruptTTS();
    isProcessing = false;
    accumulatedTranscript = '';
    setAppState('listening');
    await startRecording();
    return;
  }

  if (isProcessing) return;

  if (appState === 'listening' || appState === 'followup') {
    clearTimeout(executeTimer);
    accumulatedTranscript = '';
    await stopRecording();
    setAppState('idle');
    return;
  }

  accumulatedTranscript = '';
  setAppState('listening');
  await startRecording();
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
function showBubble(content, isUser = false) {
  clearTimeout(bubbleHideTimer);
  speechBubble.style.display = 'block';
  speechBubble.style.opacity = '1';

  if (isUser) {
    speechBubble.className = 'speech-bubble user-speech';
  } else {
    speechBubble.className = 'speech-bubble ai-response';
  }
  bubbleText.innerHTML = content;

  bubbleHideTimer = setTimeout(() => hideBubble(), BUBBLE_AUTO_HIDE);
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
const chatHistory = [];
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

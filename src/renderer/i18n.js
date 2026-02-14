/**
 * Simple i18n for OpenClaw Desktop.
 * Supports English and Chinese with automatic detection.
 */
const I18N = {
  en: {
    'tap-to-start': 'Tap to start',
    'listening': 'Listening...',
    'speak-now': 'Speak now...',
    'thinking': 'Thinking...',
    'analyzing': 'Analyzing your request',
    'speaking': 'Speaking...',
    'replying': 'Replying',
    'continue-speaking': 'Continue speaking...',
    'ask-followup': 'Ask a follow-up',
    'executing-in': 'Executing in {n}s...',
    'cancelled': 'Cancelled',
    'something-wrong': 'Something went wrong',
    'mic-denied': 'Microphone access denied',
    'no-mic': 'No microphone found',
    'recording-failed': 'Recording failed',
    'stt-failed': 'STT failed',
    'type-message': 'Type a message...',
    'chat-history': 'Chat History',
    'mode-glassorb': '🫧 Glass Orb',
    'mode-sprite': '🎨 Sprite',
    'mode-live2d': '🎭 Live2D',
    'settings-title': '⚙️ Settings',
    'gateway': 'OpenClaw Gateway',
    'port': 'Port',
    'auth-token': 'Auth Token',
    'stt-section': 'Speech-to-Text (Deepgram)',
    'tts-section': 'Text-to-Speech (MiniMax)',
    'appearance': 'Appearance',
    'theme': 'Theme',
    'character-mode': 'Character Mode',
    'dark': 'Dark (Default)',
    'light': 'Light',
    'purple-night': 'Purple Night',
    'window': 'Window',
    'always-on-top': 'Always on top',
    'start-minimized': 'Start minimized',
    'start-with-system': 'Start with system',
    'save': 'Save',
    'cancel': 'Cancel',
    'settings-saved': '✓ Settings saved!',
    'gateway-disconnected': 'Gateway disconnected',
    'gateway-connected': 'Connected',
  },
  zh: {
    'tap-to-start': '点击开始',
    'listening': '聆听中...',
    'speak-now': '请说话...',
    'thinking': '思考中...',
    'analyzing': '正在分析你的请求',
    'speaking': '回复中...',
    'replying': '正在回复',
    'continue-speaking': '继续说话...',
    'ask-followup': '继续提问',
    'executing-in': '{n}秒后执行...',
    'cancelled': '已取消',
    'something-wrong': '出了点问题',
    'mic-denied': '麦克风权限被拒绝',
    'no-mic': '未找到麦克风',
    'recording-failed': '录音失败',
    'stt-failed': '语音识别失败',
    'type-message': '输入消息...',
    'chat-history': '聊天记录',
    'mode-glassorb': '🫧 琉璃球',
    'mode-sprite': '🎨 立绘',
    'mode-live2d': '🎭 Live2D',
    'settings-title': '⚙️ 设置',
    'gateway': 'OpenClaw 网关',
    'port': '端口',
    'auth-token': '认证令牌',
    'stt-section': '语音识别 (Deepgram)',
    'tts-section': '语音合成 (MiniMax)',
    'appearance': '外观',
    'theme': '主题',
    'character-mode': '角色模式',
    'dark': '深色 (默认)',
    'light': '浅色',
    'purple-night': '紫色之夜',
    'window': '窗口',
    'always-on-top': '窗口置顶',
    'start-minimized': '启动时最小化',
    'start-with-system': '开机自启动',
    'save': '保存',
    'cancel': '取消',
    'settings-saved': '✓ 设置已保存！',
    'gateway-disconnected': '网关已断开',
    'gateway-connected': '已连接',
  },
};

// Detect language from system or settings
let currentLang = 'en';

function detectLanguage() {
  const lang = navigator.language || navigator.userLanguage || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function setLanguage(lang) {
  currentLang = lang;
}

function t(key, params) {
  let text = (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

// Auto-detect on load
currentLang = detectLanguage();

// Export
if (typeof window !== 'undefined') {
  window.I18N = { t, setLanguage, detectLanguage, currentLang: () => currentLang };
}

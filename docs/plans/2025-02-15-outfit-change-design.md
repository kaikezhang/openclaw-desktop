# Outfit Change Feature Design

## Overview

让用户通过自然对话让晚晚换衣服。说"穿裙子"→ 晚晚在 desktop app 里换上新衣服，带过渡动画。

## User Flow

1. 用户说 "我想看你穿红裙子"
2. 晚晚回复 "好呀～等我换一下！"，desktop app 播放换装过渡特效
3. 服务器端生成新衣服的 sprite 套装（idle/blink/speaking）
4. 通过 WebSocket 推送图片到 desktop app
5. 特效散开，新衣服晚晚出现
6. 晚晚说 "好啦～你看好看吗？💃"
7. 如果是已有衣服（衣柜里有），直接秒切

## Architecture

```
用户消息 → Gateway（晚晚识别意图）
  → 检查衣柜缓存
    → 命中 → WebSocket 推送 outfit_change 事件
    → 未命中 → 触发生成 Skill
      → Step 1: 生成 idle（Gemini Image Edit）
      → Step 2: 验证 + 去背景 + 标准化尺寸
      → Step 3: 基于 idle 生成 blink（闭眼版）
      → Step 4: 对齐 + 复用 idle alpha
      → Step 5: 基于 idle 生成 speaking（微张嘴版）
      → Step 6: 对齐 + 复用 idle alpha
      → Step 7: 存入衣柜
      → Step 8: WebSocket 推送
  → Desktop app 热替换 sprite + 过渡动画
```

## Sprite Generation Workflow (Skill)

基于修 blink 图的实战经验，固化为标准流程：

### Step 1: Generate Idle
- 用 Gemini Image Edit，以当前 idle 为参考
- Prompt: "Change this character's outfit to [description]. Keep the EXACT same character, face, hair, pose, position, background. Only change the clothing."
- Resolution: 1K（匹配 553x400 原图）

### Step 2: Validate & Normalize Idle
- 检测人物 bounding box（非白/非透明像素）
- 验证 bbox 面积在合理范围（原图的 70%~130%）
- 去背景：如果背景不透明，用原版 idle 的 alpha 通道
- Resize 到标准 553x400
- 对齐：人物 bbox center 对齐到原版位置

### Step 3: Generate Blink
- 用 Gemini Image Edit，以新 idle 为输入
- Prompt: "Close the eyes gently. Keep EVERYTHING else exactly the same."
- Resolution: 1K

### Step 4: Align Blink
- Resize 到 553x400
- 检测 bbox，缩放对齐到 idle 的 bbox
- 复用 idle 的 alpha 通道（关键！防止白背景闪烁）

### Step 5: Generate Speaking
- 用 Gemini Image Edit，以新 idle 为输入
- Prompt: "Open the mouth slightly as if speaking. Keep EVERYTHING else exactly the same."
- Resolution: 1K

### Step 6: Align Speaking
- 同 Step 4

### Step 7: Quality Gate
- 如果任何步骤失败，自动重试（最多 3 次）
- 比较 idle/blink/speaking 三张图的 bbox 一致性
- 差异过大则重新生成

## Wardrobe Storage

```
assets/character/wanwan/
  layers/final/          # 默认套装（当前）
    char-idle.png
    char-blink.png
    char-speaking.png
  outfits/
    red-dress/
      char-idle.png
      char-blink.png
      char-speaking.png
      metadata.json      # { name: "红裙子", prompt: "red dress", created: "..." }
    school-uniform/
      ...
```

## WebSocket Protocol

### Server → Desktop: 换装指令

```json
{
  "type": "outfit_change",
  "status": "loading" | "ready" | "error",
  "outfit": "red-dress",
  "sprites": {
    "idle": "base64...",
    "blink": "base64...",
    "speaking": "base64..."
  }
}
```

- `loading`: 开始生成，desktop 播放过渡动画
- `ready`: 图片就绪，sprite 数据在 `sprites` 字段
- `error`: 生成失败，desktop 取消过渡动画

## Desktop App Changes

### Transition Animation
- 收到 `loading` → 角色身上出现 ✨ 粒子爆发 + 轻微旋转模糊
- 收到 `ready` → 替换 sprite img src（base64 data URL），粒子散开
- 已缓存衣服 → 跳过 loading，直接 ✨ 一闪切换

### Speaking Mouth Animation (CSS)
- Speaking sprite 画微张嘴表情
- 嘴部区域（下半脸）用 CSS clip-path 隔离
- 随 TTS 音量做 scaleY(1.0~1.15) 脉动
- 实现：在 `_wrapper` 内加一个 clip 层，只包含嘴部区域的 speaking sprite 副本
- 脉动频率跟 `speakBounce` spring 同步

### Sprite Hot-Swap
- `LayeredSpriteEngine` 新增 `swapOutfit(sprites)` 方法
- 接收 base64 图片，替换所有 img 元素的 src
- 替换前确保新图片 decode 完成（`img.decode()`）再切换，避免闪烁

## Implementation Order

1. **Sprite Generation Skill** — 固化生成 workflow 为可复用 skill
2. **Wardrobe Management** — 存储/检索/metadata
3. **WebSocket Protocol** — outfit_change 消息类型
4. **Desktop Transition Animation** — 粒子特效 + 切换
5. **Desktop Sprite Hot-Swap** — base64 替换 + decode
6. **Speaking Mouth CSS** — 音量脉动动画
7. **Intent Recognition** — 晚晚识别换装意图并触发

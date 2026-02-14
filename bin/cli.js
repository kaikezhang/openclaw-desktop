#!/usr/bin/env node

/**
 * OpenClaw Desktop — Quick Setup CLI
 *
 * Usage: npx openclaw-desktop
 *
 * This will:
 *   1. Check if OpenClaw is installed
 *   2. Prompt for Gateway URL and token
 *   3. Optionally configure API keys (Deepgram, MiniMax, fal.ai)
 *   4. Download and launch the desktop app
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(msg) { console.log(`${CYAN}[openclaw-desktop]${RESET} ${msg}`); }
function success(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }
function error(msg) { console.log(`${RED}✗${RESET} ${msg}`); }

async function main() {
  console.log(`
${BOLD}${CYAN}╔══════════════════════════════════════╗
║     OpenClaw Desktop Setup           ║
║     AI Assistant with Live2D         ║
╚══════════════════════════════════════╝${RESET}
`);

  // Step 1: Check OpenClaw
  log('Checking OpenClaw installation...');
  try {
    const version = execSync('openclaw --version 2>/dev/null || echo "not found"', { encoding: 'utf-8' }).trim();
    if (version === 'not found') {
      warn('OpenClaw not found. You need a running OpenClaw Gateway to use this app.');
      warn('Install: npm install -g openclaw');
      const proceed = await ask('Continue anyway? (y/N): ');
      if (proceed.toLowerCase() !== 'y') {
        error('Setup cancelled.');
        process.exit(1);
      }
    } else {
      success(`OpenClaw found: ${version}`);
    }
  } catch (e) {
    warn('Could not check OpenClaw version');
  }

  // Step 2: Gateway config
  console.log('');
  log('Gateway Configuration');
  const port = await ask(`  Gateway port [${YELLOW}18789${RESET}]: `) || '18789';
  const token = await ask(`  Gateway token (leave empty if none): `) || '';

  // Step 3: Optional API keys
  console.log('');
  log('Optional API Keys (press Enter to skip)');
  const deepgramKey = await ask('  Deepgram API key (for STT): ') || '';
  const minimaxKey = await ask('  MiniMax API key (for TTS): ') || '';
  const minimaxGroup = minimaxKey ? (await ask('  MiniMax Group ID: ') || '') : '';
  const falKey = await ask('  fal.ai API key (for selfie generation): ') || '';

  // Step 4: Write .env
  console.log('');
  log('Writing configuration...');

  const envContent = [
    `OPENCLAW_PORT=${port}`,
    `OPENCLAW_TOKEN=${token}`,
    deepgramKey ? `DEEPGRAM_API_KEY=${deepgramKey}` : '# DEEPGRAM_API_KEY=',
    minimaxKey ? `MINIMAX_API_KEY=${minimaxKey}` : '# MINIMAX_API_KEY=',
    minimaxGroup ? `MINIMAX_GROUP_ID=${minimaxGroup}` : '# MINIMAX_GROUP_ID=',
    'MINIMAX_MODEL=speech-02-hd',
    'MINIMAX_VOICE_ID=Lovely_Girl',
    falKey ? `FAL_KEY=${falKey}` : '# FAL_KEY=',
  ].join('\n') + '\n';

  const projectDir = path.resolve(__dirname, '..');
  const envPath = path.join(projectDir, '.env');
  fs.writeFileSync(envPath, envContent);
  success('.env file created');

  // Step 5: Install deps and build
  log('Installing dependencies...');
  try {
    execSync('npm install', { cwd: projectDir, stdio: 'inherit' });
    success('Dependencies installed');
  } catch (e) {
    error('Failed to install dependencies');
    process.exit(1);
  }

  log('Building TypeScript...');
  try {
    execSync('npm run build', { cwd: projectDir, stdio: 'inherit' });
    success('Build complete');
  } catch (e) {
    error('Build failed');
    process.exit(1);
  }

  // Step 6: Launch
  console.log('');
  const launch = await ask(`${GREEN}Ready! Launch now? (Y/n): ${RESET}`) || 'y';
  if (launch.toLowerCase() !== 'n') {
    log('Launching OpenClaw Desktop...');
    const child = spawn('npx', ['electron', '.'], {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    success('OpenClaw Desktop is starting! 🚀');
  }

  console.log(`
${BOLD}${GREEN}Setup complete!${RESET}

  Start anytime:  ${CYAN}cd ${projectDir} && npm start${RESET}
  Settings:       ${CYAN}System tray → Settings${RESET}
  Hotkeys:        ${CYAN}Ctrl+Shift+O${RESET} (record) | ${CYAN}Ctrl+Shift+M${RESET} (mini)

${BOLD}Happy chatting! 🐱${RESET}
`);

  rl.close();
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});

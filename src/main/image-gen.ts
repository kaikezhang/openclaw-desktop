import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface ImageGenConfig {
  falKey: string;
}

export interface SelfieOptions {
  prompt: string;
  outfitDescription?: string;
  referenceImageUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Auto-match a scene/background based on outfit description.
 */
function matchScene(outfit: string): string {
  const scenes: Array<{ keywords: string[]; scene: string }> = [
    { keywords: ['泳', '比基尼', 'bikini', 'swimsuit', '沙滩'], scene: 'on a sunny tropical beach with turquoise ocean waves, palm trees, golden sand' },
    { keywords: ['运动', '篮球', '棒球', 'sport', 'jersey', 'basketball'], scene: 'on an outdoor basketball court at golden hour, dynamic sporty atmosphere' },
    { keywords: ['和服', '旗袍', 'kimono', 'qipao', 'cheongsam', '汉服'], scene: 'in a traditional Chinese garden with cherry blossoms, red lanterns, moonlight' },
    { keywords: ['水手', 'sailor', 'JK', '制服', '校服', 'uniform', '学'], scene: 'at a Japanese high school rooftop during cherry blossom season, soft spring breeze' },
    { keywords: ['睡衣', 'pajama', '居家'], scene: 'in a cozy bedroom with fairy lights, plush pillows, warm golden lamp light' },
    { keywords: ['海绵宝宝', 'spongebob', '卡通', 'cartoon', '可爱'], scene: 'in a colorful candy-themed wonderland with pastel buildings and floating bubbles' },
    { keywords: ['西装', 'suit', '正装', 'formal', '职业'], scene: 'in a sleek modern office with city skyline view through floor-to-ceiling windows at sunset' },
    { keywords: ['朋克', 'punk', '摇滚', 'rock', '哥特', 'gothic'], scene: 'in a neon-lit cyberpunk alley with graffiti walls and rain-slicked streets' },
    { keywords: ['仙女', '公主', 'princess', 'fairy', '礼服', 'dress', 'gown'], scene: 'in an enchanted forest with glowing fireflies, crystal clear stream, magical twilight' },
    { keywords: ['冬', '雪', 'winter', '羽绒', '毛衣', 'sweater'], scene: 'in a snowy winter wonderland with pine trees, soft snowfall, warm cabin in background' },
    { keywords: ['夏', '短裤', 'summer', '背心'], scene: 'at a vibrant summer festival with colorful banners, ice cream stands, blue sky' },
  ];

  const lc = outfit.toLowerCase();
  for (const s of scenes) {
    if (s.keywords.some(k => lc.includes(k))) return s.scene;
  }
  // Default scene
  return 'in a stylish modern room with soft natural lighting, aesthetic interior design';
}

/**
 * Image generation engine using fal.ai API.
 * Generates character selfies with a consistent reference image.
 */
export class ImageGenEngine {
  private falKey: string;
  private referenceUrl: string;

  constructor(config: ImageGenConfig) {
    this.falKey = config.falKey;
    // Default reference image (can be customized)
    this.referenceUrl = '';
  }

  setFalKey(key: string): void {
    this.falKey = key;
  }

  setReferenceImage(url: string): void {
    this.referenceUrl = url;
  }

  /**
   * Generate a selfie image.
   * Returns the local path to the saved image.
   */
  async generateSelfie(options: SelfieOptions): Promise<string | null> {
    if (!this.falKey) {
      console.warn('[ImageGen] No fal.ai API key configured');
      return null;
    }

    const refUrl = options.referenceImageUrl || this.referenceUrl;

    // Build outfit-aware prompt with auto-matched scene
    let finalPrompt = options.prompt;
    if (options.outfitDescription) {
      const scene = matchScene(options.outfitDescription);
      finalPrompt = `anime girl with long black hair and white cat ear headband, wearing ${options.outfitDescription}, ${scene}. Beautiful detailed anime illustration, high quality, vibrant colors, consistent character design.`;
      console.log(`[ImageGen] Auto-matched scene for "${options.outfitDescription}": ${scene}`);
    }

    const body: any = {
      prompt: finalPrompt,
      image_size: {
        width: options.width || 512,
        height: options.height || 512,
      },
      num_images: 1,
      enable_safety_checker: true,
    };

    // If we have a reference image, use image-to-image endpoint
    if (refUrl) {
      body.image_url = refUrl;
      body.strength = 0.65; // How much to deviate from reference
    }

    try {
      const result = await this.callFalApi(
        refUrl ? 'fal-ai/flux/dev/image-to-image' : 'fal-ai/flux/dev',
        body,
      );

      if (result?.images?.[0]?.url) {
        const imageUrl = result.images[0].url;
        const localPath = await this.downloadImage(imageUrl);
        return localPath;
      }

      console.error('[ImageGen] No image in response');
      return null;
    } catch (err: any) {
      console.error('[ImageGen] Generation failed:', err.message);
      return null;
    }
  }

  private callFalApi(endpoint: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const req = https.request(
        {
          hostname: 'fal.run',
          path: `/${endpoint}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Key ${this.falKey}`,
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error(`Invalid JSON response: ${body.substring(0, 200)}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private async downloadImage(url: string): Promise<string> {
    const imagesDir = path.join(app.getPath('userData'), 'selfies');
    fs.mkdirSync(imagesDir, { recursive: true });

    const filename = `selfie-${Date.now()}.png`;
    const filePath = path.join(imagesDir, filename);

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      https.get(url, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            https.get(redirectUrl, (redirectRes) => {
              redirectRes.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve(filePath);
              });
            });
            return;
          }
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(filePath);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  }
}

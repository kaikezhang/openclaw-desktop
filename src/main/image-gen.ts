import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface ImageGenConfig {
  falKey: string;
}

export interface SelfieOptions {
  prompt: string;
  referenceImageUrl?: string;
  width?: number;
  height?: number;
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

    const body: any = {
      prompt: options.prompt,
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

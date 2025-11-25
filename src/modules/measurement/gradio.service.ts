import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';

@Injectable()
export class GradioService {
  private client: any = null;

  /**
   * Get or initialize Gradio Client
   */
  async getClient(spaceId: string): Promise<any> {
    if (this.client) return this.client;

    // Dynamic import for ESM module
    const { Client } = await import('@gradio/client');

    this.client = await Client.connect(spaceId, {
      token: `hf_${process.env.HUGGING_FACE_TOKEN}`,
    });
    return this.client;
  }

  /**
   * Convert Node Buffer to Blob (for Gradio inputs)
   */
  bufferToBlob(
    buffer: Buffer,
    mime: string = 'application/octet-stream',
  ): Blob {
    const uint8 = new Uint8Array(buffer);
    return new Blob([uint8], { type: mime });
  }

  /**
   * Save a file to a temporary folder
   */
  async saveFile(
    fileData: { path: string } | null,
    destDir = 'tmp',
  ): Promise<string | null> {
    if (!fileData || !fileData.path) return null;

    await fs.mkdir(destDir, { recursive: true });
    const fileName = path.basename(fileData.path);
    const dest = path.join(destDir, fileName);

    try {
      const content = await fs.readFile(fileData.path);
      await fs.writeFile(dest, content);
      return dest;
    } catch {
      return fileData.path;
    }
  }

  /**
   * Example method to run Gradio inference
   */
  // async runInference(fileBuffer: Buffer): Promise<any> {
  //   const client = await this.getClient();
  //   const blob = this.bufferToBlob(fileBuffer);

  //   // Adjust method name depending on your Gradio space inputs
  //   const result = await client.predict('/predict', {
  //     image: blob,
  //   });
  //   return result;
  // }
}

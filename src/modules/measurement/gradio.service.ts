import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';

@Injectable()
export class GradioService {
  private readonly logger = new Logger(GradioService.name);
  private clients = new Map<string, any>();

  /**
   * Get or initialize Gradio Client for a specific space.
   * Each space gets its own cached client.
   */
  async getClient(spaceId: string): Promise<any> {
    const existing = this.clients.get(spaceId);
    if (existing) return existing;

    this.logger.log(`Connecting to Gradio space: ${spaceId}`);

    // Dynamic import for ESM module
    const { Client } = await import('@gradio/client');

    const client = await Client.connect(spaceId, {
      token: `hf_${process.env.HUGGING_FACE_TOKEN}`,
    });

    this.clients.set(spaceId, client);
    this.logger.log(`Connected to Gradio space: ${spaceId}`);
    return client;
  }

  /**
   * Clear a cached client (useful if a connection goes stale).
   */
  clearClient(spaceId: string) {
    this.clients.delete(spaceId);
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
}

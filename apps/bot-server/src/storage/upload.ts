import { supabase } from './supabase.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';

export async function uploadScreenshot(base64: string, mimeType: string): Promise<string> {
  const extension = mimeType.split('/')[1] ?? 'png';
  const filePath = `${randomUUID()}.${extension}`;
  const buffer = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Screenshot upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

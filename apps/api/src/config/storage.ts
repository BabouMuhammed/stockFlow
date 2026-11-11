import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '../utils/http';

export type ImageStorage =
  { mode: 'disabled' } | { mode: 'local' | 'persistent'; directory: string };
export function imageStorageFromEnv(env: {
  IMAGE_STORAGE: 'disabled' | 'local' | 'persistent';
  UPLOAD_DIR?: string;
}): ImageStorage {
  if (env.IMAGE_STORAGE === 'disabled') return { mode: 'disabled' };
  if (env.IMAGE_STORAGE === 'persistent') {
    if (!env.UPLOAD_DIR) throw new Error('Persistent storage requires UPLOAD_DIR');
    return { mode: 'persistent', directory: env.UPLOAD_DIR };
  }
  return {
    mode: 'local',
    directory: resolve(
      process.cwd(),
      process.cwd().endsWith('api') ? '../../.local/uploads' : '.local/uploads',
    ),
  };
}
export async function checkImageStorage(storage: ImageStorage) {
  if (storage.mode !== 'persistent') return;
  try {
    // Provision on the mounted disk; never create a missing mount automatically.
    if (
      (await readFile(resolve(storage.directory, '.stockflow-storage'), 'utf8')).trim() !==
      'stockflow-persistent-v1'
    )
      throw new Error('Invalid storage marker');
    await access(storage.directory, constants.R_OK | constants.W_OK);
  } catch {
    throw new ApiError(
      503,
      'IMAGE_STORAGE_UNAVAILABLE',
      'Persistent image storage is unavailable; no upload was saved',
    );
  }
}

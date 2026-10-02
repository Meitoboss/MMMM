import * as FileSystem from 'expo-file-system/legacy';

/**
 * Downloads a stream to the cache folder so AVPlayer can play a plain local file.
 * (RiMusic itself reads the stream in ranged chunks – AVPlayer's own range handling is the part that fails.)
 */
export async function downloadToCache(url: string, id: string, userAgent?: string): Promise<string> {
  const dir = `${FileSystem.cacheDirectory}audio/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const uri = `${dir}${id}.m4a`;
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists && (info as { size?: number }).size && (info as { size?: number }).size! > 10_000) return uri;

  const res = await FileSystem.downloadAsync(url, uri, userAgent ? { headers: { 'User-Agent': userAgent } } : undefined);
  if (res.status !== 200 && res.status !== 206) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  return res.uri;
}

export async function clearAudioCache(): Promise<void> {
  await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}audio/`, { idempotent: true });
}

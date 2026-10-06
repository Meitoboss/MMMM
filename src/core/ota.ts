/**
 * Over-the-air updates, as the person sees them: what is running, what is happening, what to do.
 * Pure text logic – the expo-updates calls are in state/ota.ts, so this can be tested.
 */
export type OtaPhase = 'disabled' | 'emergency' | 'error' | 'checking' | 'downloading' | 'pending' | 'idle';

export interface OtaSnapshot {
  /** updates are switched on in this build */
  enabled: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  /** a newer version has been downloaded and waits for a restart */
  isUpdatePending: boolean;
  error?: string | null;
  /** the app fell back to the version inside the app because the downloaded one could not start */
  emergencyReason?: string | null;
}

export function otaPhase(s: OtaSnapshot): OtaPhase {
  if (!s.enabled) return 'disabled';
  if (s.emergencyReason) return 'emergency';
  if (s.isDownloading) return 'downloading';
  if (s.isChecking) return 'checking';
  if (s.isUpdatePending) return 'pending';
  if (s.error) return 'error';
  return 'idle';
}

export function otaMessage(s: OtaSnapshot): string {
  switch (otaPhase(s)) {
    case 'disabled':
      return 'この版では、アプリの中身の更新は使いません';
    case 'emergency':
      return `更新の中身を起動できなかったため、アプリに入っている版で動いています（${s.emergencyReason}）`;
    case 'downloading':
      return '更新をダウンロードしています…';
    case 'checking':
      return '更新を確認しています…';
    case 'pending':
      return '新しい中身を取得しました。再起動すると反映されます';
    case 'error':
      return `更新を取得できませんでした（${s.error}）`;
    case 'idle':
      return '最新です';
  }
}

export const shortId = (id?: string | null): string => (id ? id.slice(0, 8) : '');

/** 2026-10-08 12:30 (the phone's own time) */
export function formatWhen(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export interface OtaRunning {
  /** the version inside the app (true), or one that was downloaded (false) */
  isEmbedded: boolean;
  updateId?: string | null;
  createdAt?: Date | string | null;
  runtimeVersion?: string | null;
}

/** "which JavaScript is running" – so that a person (and I) can tell whether an update arrived */
export function runningLine(r: OtaRunning): string {
  if (r.isEmbedded) return 'アプリに入っている版';
  const when = formatWhen(r.createdAt);
  return `配信された版${when ? `（${when}）` : ''}${r.updateId ? ` ・ ${shortId(r.updateId)}` : ''}`;
}

/** only a failure worth showing: the app's own reason, shortened */
export function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m.replace(/\s+/g, ' ').slice(0, 160);
}

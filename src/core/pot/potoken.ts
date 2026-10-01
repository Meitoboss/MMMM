import { getEngine } from './engine';
import { parseChallengeData, parseIntegrityTokenData, u8CsvToPoToken } from './botguard';

/**
 * Port of PoTokenWebView.kt + PoTokenGenerator.kt (NewPipe, GPL-3.0).
 *
 * BotGuard flow:  Create (challenge) → run BotGuard in the WebView → GenerateIT (integrity token)
 * → mint tokens in the WebView. Network calls are made natively (no CORS), the WebView only runs JS.
 */
const GOOGLE_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.3';

export interface PoTokenResult {
  /** goes into the `player` request (`serviceIntegrityDimensions.poToken`) */
  player: string;
  /** appended to the stream URL as `&pot=` */
  streaming: string;
}

async function botguardRequest(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json+protobuf',
      'x-goog-api-key': GOOGLE_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body,
  });
  if (res.status !== 200) throw new Error(`BotGuard service ${url.split('/').pop()}: HTTP ${res.status}`);
  return res.text();
}

export class WebPoTokenProvider {
  private lock: Promise<unknown> = Promise.resolve();
  private sessionId: string | null = null;
  private streamingPot: string | null = null;
  private expiresAt = 0;
  private ready = false;

  /** Run `fn` after every previously queued call (Kotlin used a Mutex). */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private async initialize(): Promise<void> {
    const engine = await getEngine();
    const challengeRaw = await botguardRequest('https://www.youtube.com/api/jnn/v1/Create', `["${REQUEST_KEY}"]`);
    const challenge = parseChallengeData(challengeRaw);
    const botguardResponse = await engine.call<string>('botguard', { challenge }, 30_000);
    const itRaw = await botguardRequest(
      'https://www.youtube.com/api/jnn/v1/GenerateIT',
      JSON.stringify([REQUEST_KEY, botguardResponse]),
    );
    const { bytes, expiresInSec } = parseIntegrityTokenData(itRaw);
    await engine.call('integrity', { bytes });
    // leave 10 minutes of margin, like the Kotlin code
    this.expiresAt = Date.now() + expiresInSec * 1000 - 10 * 60_000;
    this.ready = true;
  }

  private async mint(identifier: string): Promise<string> {
    const engine = await getEngine();
    const csv = await engine.call<string>('mint', { identifier });
    return u8CsvToPoToken(csv);
  }

  /** The streaming token (bound to the session) must be minted exactly once before any player token. */
  getWebClientPoToken(videoId: string, sessionId: string, forceRecreate = false): Promise<PoTokenResult> {
    return this.serialized(async () => {
      const recreate = forceRecreate || !this.ready || Date.now() > this.expiresAt || this.sessionId !== sessionId;
      if (recreate) {
        this.ready = false;
        this.sessionId = sessionId;
        await this.initialize();
        this.streamingPot = await this.mint(sessionId);
      }
      try {
        return { player: await this.mint(videoId), streaming: this.streamingPot as string };
      } catch (e) {
        if (recreate) throw e; // already a fresh generator – nothing more to try
        // WebView content may have been lost (app was in background): rebuild once
        this.ready = false;
        this.sessionId = sessionId;
        await this.initialize();
        this.streamingPot = await this.mint(sessionId);
        return { player: await this.mint(videoId), streaming: this.streamingPot };
      }
    });
  }

  reset() {
    this.ready = false;
  }
}

export const poTokenProvider = new WebPoTokenProvider();

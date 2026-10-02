import { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { engineStatus, setEngine } from '../core/pot/engine';
import { poTokenProvider } from '../core/pot/potoken';
import { resetSolverState } from '../core/pot/solver';
import { buildEngineHtml } from './engineHtml';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Invisible WebView that hosts BotGuard (PO tokens) and the yt-dlp "ejs" solver.
 * Mounted once in the root layout. Core code talks to it through `getEngine()`.
 */
export function EngineHost() {
  const ref = useRef<WebView>(null);
  const pending = useRef(new Map<number, Pending>());
  const seq = useRef(0);
  const html = useMemo(() => buildEngineHtml(), []);

  const failAll = useCallback((message: string) => {
    pending.current.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    });
    pending.current.clear();
  }, []);

  const call = useCallback(
    (cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 20_000) =>
      new Promise<never>((resolve, reject) => {
        const id = ++seq.current;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error(`JS engine: "${cmd}" timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
        pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        ref.current?.injectJavaScript(`window.__rpc(${JSON.stringify({ id, cmd, ...payload })});true;`);
      }),
    [],
  );

  useEffect(() => {
    engineStatus.mounted = true;
    return () => {
      engineStatus.mounted = false;
      setEngine(null);
      failAll('JS engine was unmounted');
    };
  }, [failAll]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string; message?: string };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'jserror') {
        engineStatus.note(`js: ${msg.message}`);
        return;
      }
      if (msg.type === 'probe') {
        engineStatus.probe = String((msg as { info?: string }).info);
        return;
      }
      if (msg.type === 'ready') {
        // fresh page: whatever the core believed about the engine's state is gone
        resetSolverState();
        poTokenProvider.reset();
        setEngine({ call });
        return;
      }
      if (msg.id === undefined) return;
      const p = pending.current.get(msg.id);
      if (!p) return;
      pending.current.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'engine error'));
    },
    [call],
  );

  // react-native-webview wraps the web view in a container with `flex: 1`; without an explicit
  // containerStyle that container takes half of the screen and swallows touches meant for the app.
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
      <WebView
        ref={ref}
        source={{ html, baseUrl: 'https://www.youtube.com' }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        onLoadStart={() => {
          engineStatus.loadStarted = true;
        }}
        onLoadEnd={() => {
          engineStatus.loadEnded = true;
          // tells us whether the page scripts ran even if 'ready' never arrives
          ref.current?.injectJavaScript(
            "window.ReactNativeWebView.postMessage(JSON.stringify({type:'probe',info:'rpc='+typeof window.__rpc+',bg='+typeof window.runBotGuard}));true;",
          );
        }}
        onError={(e) => engineStatus.note(`load error: ${e.nativeEvent.description}`)}
        onHttpError={(e) => engineStatus.note(`http ${e.nativeEvent.statusCode}`)}
        onContentProcessDidTerminate={() => {
          // iOS killed the web content process (memory / background) – reload and rebuild state
          setEngine(null);
          failAll('JS engine process was terminated');
          ref.current?.reload();
        }}
        onRenderProcessGone={() => {
          // Android killed the WebView renderer (memory / background) – reload and rebuild state
          setEngine(null);
          failAll('JS engine process was terminated');
          ref.current?.reload();
        }}
        containerStyle={{ flex: 0, width: 1, height: 1 }}
        style={{ width: 1, height: 1 }}
        scrollEnabled={false}
        accessible={false}
      />
    </View>
  );
}

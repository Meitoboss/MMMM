/**
 * HTML for the hidden "JS engine" WebView.
 * PO_TOKEN_SCRIPT is RiMusic's assets/po_token.html (from NewPipe, GPL-3.0) – defines runBotGuard / obtainPoToken.
 * BRIDGE adds a tiny RPC layer on top plus the yt-dlp "ejs" challenge solver loader.
 */
export const PO_TOKEN_SCRIPT: string = "/**\n     * Factory method to create and load a BotGuardClient instance.\n     * @param options - Configuration options for the BotGuardClient.\n     * @returns A promise that resolves to a loaded BotGuardClient instance.\n     */\n    function loadBotGuard(challengeData) {\n      this.vm = this[challengeData.globalName];\n      this.program = challengeData.program;\n      this.vmFunctions = {};\n      this.syncSnapshotFunction = null;\n\n      if (!this.vm)\n        throw new Error('[BotGuardClient]: VM not found in the global object');\n\n      if (!this.vm.a)\n        throw new Error('[BotGuardClient]: Could not load program');\n\n      const vmFunctionsCallback = function (\n        asyncSnapshotFunction,\n        shutdownFunction,\n        passEventFunction,\n        checkCameraFunction\n      ) {\n        this.vmFunctions = {\n          asyncSnapshotFunction: asyncSnapshotFunction,\n          shutdownFunction: shutdownFunction,\n          passEventFunction: passEventFunction,\n          checkCameraFunction: checkCameraFunction\n        };\n      };\n\n      this.syncSnapshotFunction = this.vm.a(this.program, vmFunctionsCallback, true, this.userInteractionElement, function () {/** no-op */ }, [ [], [] ])[0]\n\n      // an asynchronous function runs in the background and it will eventually call\n      // `vmFunctionsCallback`, however we need to manually tell JavaScript to pass\n      // control to the things running in the background by interrupting this async\n      // function in any way, e.g. with a delay of 1ms. The loop is most probably not\n      // needed but is there just because.\n      return new Promise(function (resolve, reject) {\n        i = 0\n        refreshIntervalId = setInterval(function () {\n          if (!!this.vmFunctions.asyncSnapshotFunction) {\n            resolve(this)\n            clearInterval(refreshIntervalId);\n          }\n          if (i >= 10000) {\n            reject(\"asyncSnapshotFunction is null even after 10 seconds\")\n            clearInterval(refreshIntervalId);\n          }\n          i += 1;\n        }, 1);\n      })\n    }\n\n    /**\n     * Takes a snapshot asynchronously.\n     * @returns The snapshot result.\n     * @example\n     * ```ts\n     * const result = await botguard.snapshot({\n     *   contentBinding: {\n     *     c: \"a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo\",\n     *     e: \"ENGAGEMENT_TYPE_VIDEO_LIKE\",\n     *     encryptedVideoId: \"P-vC09ZJcnM\"\n     *    }\n     * });\n     *\n     * console.log(result);\n     * ```\n     */\n    function snapshot(args) {\n      return new Promise(function (resolve, reject) {\n        if (!this.vmFunctions.asyncSnapshotFunction)\n          return reject(new Error('[BotGuardClient]: Async snapshot function not found'));\n\n        this.vmFunctions.asyncSnapshotFunction(function (response) { resolve(response) }, [\n          args.contentBinding,\n          args.signedTimestamp,\n          args.webPoSignalOutput,\n          args.skipPrivacyBuffer\n        ]);\n      });\n    }\n\n    function runBotGuard(challengeData) {\n      const interpreterJavascript = challengeData.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;\n\n      if (interpreterJavascript) {\n        new Function(interpreterJavascript)();\n      } else throw new Error('Could not load VM');\n\n      const webPoSignalOutput = [];\n      return loadBotGuard({\n        globalName: challengeData.globalName,\n        globalObj: this,\n        program: challengeData.program\n      }).then(function (botguard) {\n        return botguard.snapshot({ webPoSignalOutput: webPoSignalOutput })\n      }).then(function (botguardResponse) {\n        return { webPoSignalOutput: webPoSignalOutput, botguardResponse: botguardResponse }\n      })\n    }\n\n    function obtainPoToken(webPoSignalOutput, integrityToken, identifier) {\n      const getMinter = webPoSignalOutput[0];\n\n      if (!getMinter)\n        throw new Error('PMD:Undefined');\n\n      const mintCallback = getMinter(integrityToken);\n\n      if (!(mintCallback instanceof Function))\n        throw new Error('APF:Failed');\n\n      const result = mintCallback(identifier);\n\n      if (!result)\n        throw new Error('YNJ:Undefined');\n\n      if (!(result instanceof Uint8Array))\n        throw new Error('ODM:Invalid');\n\n      return result;\n    }";

export const BRIDGE = String.raw`
(function () {
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }

  async function handle(m) {
    switch (m.cmd) {
      case 'ping':
        return 'pong';

      case 'botguard': {
        var r = await runBotGuard(m.challenge);
        window.webPoSignalOutput = r.webPoSignalOutput;
        return r.botguardResponse;
      }
      case 'integrity':
        window.integrityToken = new Uint8Array(m.bytes);
        return true;

      case 'mint': {
        var id = new TextEncoder().encode(m.identifier);
        var out = obtainPoToken(window.webPoSignalOutput, window.integrityToken, id);
        return out.join(',');
      }

      case 'loadSolver': {
        // ejs assigns globalThis.location = new URL(...), which would navigate this WebView away.
        var core = m.core.split('globalThis.location =').join('globalThis.__ejsLocation =');
        (0, eval)(m.lib + '\n;Object.assign(globalThis, lib);\n' + core);
        return typeof jsc;
      }

      case 'solve': {
        var input;
        if (m.player) {
          input = { type: 'player', player: m.player, requests: m.requests, output_preprocessed: true };
        } else if (window.__pre && window.__preId === m.playerId) {
          input = { type: 'preprocessed', preprocessed_player: window.__pre, requests: m.requests };
        } else {
          throw new Error('NEED_PLAYER');
        }
        var o = jsc(input);
        if (o.type === 'error') throw new Error(o.error);
        if (o.preprocessed_player) { window.__pre = o.preprocessed_player; window.__preId = m.playerId; }
        return { responses: o.responses };
      }
      default:
        throw new Error('unknown command ' + m.cmd);
    }
  }

  window.__rpc = function (m) {
    Promise.resolve().then(function () { return handle(m); }).then(
      function (r) { post({ id: m.id, ok: true, result: r }); },
      function (e) { post({ id: m.id, ok: false, error: String((e && e.stack) || e) }); }
    );
  };
  window.addEventListener('error', function (e) { post({ type: 'jserror', message: String(e.message) }); });
  post({ type: 'ready' });
})();
`;

export function buildEngineHtml(): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title></title><script>' +
    PO_TOKEN_SCRIPT +
    '</script><script>' +
    BRIDGE +
    '</script></head><body></body></html>'
  );
}

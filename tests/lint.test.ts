import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Catches mistakes that only the real bundler (Metro / Babel) reports – and only after a 10-minute build:
 * the same name imported or declared twice in one file ("Identifier 'x' has already been declared").
 * Uses the TypeScript compiler in a mode that needs no node_modules (module resolution is switched off).
 */
const require_ = createRequire(import.meta.url);
let ts: typeof import('typescript') | undefined;
try {
  ts = require_('typescript');
} catch {
  /* TypeScript is not installed here: the test is skipped */
}

const DUPLICATE_CODES = new Set([
  2300, // Duplicate identifier
  2451, // Cannot redeclare block-scoped variable
  2440, // Import declaration conflicts with local declaration
  2395, // Individual declarations in merged declaration must be all exported or all local
  2528, // A module cannot have multiple default exports
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('source files', { skip: ts ? false : 'typescript is not installed' }, () => {
  it('declare / import every name only once', () => {
    const t = ts as typeof import('typescript');
    const files = [...sourceFiles('app'), ...sourceFiles('src'), 'index.ts'];
    const program = t.createProgram(files, {
      noResolve: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: false,
      jsx: t.JsxEmit.ReactJSX,
      target: t.ScriptTarget.ES2022,
      module: t.ModuleKind.ESNext,
      moduleResolution: t.ModuleResolutionKind.Bundler,
      types: [],
    });
    const problems: string[] = [];
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile || !files.some((f) => sf.fileName.endsWith(f))) continue;
      for (const d of program.getSemanticDiagnostics(sf)) {
        if (!DUPLICATE_CODES.has(d.code)) continue;
        const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        problems.push(`${sf.fileName}:${line + 1}  ${t.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      }
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
  });

  it('every relative import / require points at a file that exists', () => {
    const t = ts as typeof import('typescript');
    const EXT = ['', '.ts', '.tsx', '.js', '.json', '.png', '.svg', '/index.ts', '/index.tsx'];
    const missing: string[] = [];
    for (const file of [...sourceFiles('app'), ...sourceFiles('src'), 'index.ts']) {
      const text = readFileSync(file, 'utf8');
      for (const imp of t.preProcessFile(text, true, true).importedFiles) {
        if (!imp.fileName.startsWith('.')) continue;
        const base = join(dirname(file), imp.fileName);
        if (!EXT.some((e) => existsSync(base + e) && !statSync(base + e).isDirectory())) missing.push(`${file}: ${imp.fileName}`);
      }
    }
    assert.deepEqual(missing, [], `\nmissing files:\n${missing.join('\n')}`);
  });

  it('really notices a duplicate import (the check itself works)', () => {
    const t = ts as typeof import('typescript');
    const name = 'virtual.tsx';
    const text = "import { a } from './x';\nimport { a } from './x';\nexport const b = a;\n";
    const host = t.createCompilerHost({});
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lang, ...rest) => (f === name ? t.createSourceFile(f, text, lang) : original(f, lang, ...rest));
    host.fileExists = (f) => f === name || t.sys.fileExists(f);
    const program = t.createProgram([name], { noResolve: true, noEmit: true, skipLibCheck: true, types: [] }, host);
    const codes = program.getSemanticDiagnostics().map((d) => d.code);
    assert.ok(codes.some((c) => DUPLICATE_CODES.has(c)), `diagnostic codes: ${codes.join(',')}`);
  });
});

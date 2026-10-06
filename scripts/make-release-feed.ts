// Makes version.json (and altstore.json) for a release.
//   npx tsx scripts/make-release-feed.ts --repo owner/name --tag v1.0.2 [--ipa MusicSpace-unsigned.ipa] [--base https://…] [--notes "…"] [--out feed] [--only version]
// In the workflow, repo and tag come from GITHUB_REPOSITORY and GITHUB_REF_NAME.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import { type AppJson, buildFeeds } from '../src/core/releaseFeed';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repo = arg('repo') ?? process.env.GITHUB_REPOSITORY ?? '';
const tag = arg('tag') ?? process.env.GITHUB_REF_NAME ?? '';
if (!repo || !tag) {
  console.error('--repo and --tag are needed (or GITHUB_REPOSITORY and GITHUB_REF_NAME)');
  process.exit(1);
}
const ipa = arg('ipa');
const only = arg('only') ?? 'all';
const out = arg('out') ?? 'feed';
const app = JSON.parse(readFileSync('app.json', 'utf8')) as AppJson;

const { feed, altstore } = buildFeeds({ app, repo, tag, base: arg('base'), ipaSize: ipa ? statSync(ipa).size : undefined, notes: arg('notes') });
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/version.json`, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`${out}/version.json  (${feed.version})`);
if (only === 'all') {
  if (!ipa) {
    console.error('altstore.json needs the IPA (its size): give --ipa, or use --only version');
    process.exit(1);
  }
  writeFileSync(`${out}/altstore.json`, `${JSON.stringify(altstore, null, 2)}\n`);
  console.log(`${out}/altstore.json  (${statSync(ipa).size} bytes)`);
}

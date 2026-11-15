// main.ts — the entry program for threejs-fps-02 (Node 22, stdlib only).
//
// It hands the game in: it copies game/ and screenshots/ from this
// repository into the output directory and writes /output/dossier.json
// with buildDossier from vendor/makefun-threejs.ts. The output directory
// is $MAKEFUN_OUTPUT_DIR, or /output when that is unset. The program is
// deterministic: two runs write byte-identical files (the dossier is a
// pure function of the copied trees, and the copy preserves file bytes).
// It prints the dossier's size and sha256 so a run's output can be
// compared by eye.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const src = join(repoRoot, name);
  const dst = join(outDir, name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`dossier.json: ${dossier.length} bytes, sha256 ${createHash('sha256').update(dossier).digest('hex')}`);

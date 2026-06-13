import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Boundary check (SPEC §1.1/§1.2): /src/core/ never imports
// three.js and never touches the DOM.
// ============================================================

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('core boundary', () => {
  const coreDir = join(HERE, '..', 'core');
  const files = walk(coreDir);

  it('found core files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of walk(coreDir)) {
    it(`${file.split('/src/')[1]} stays renderer-independent`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src, 'imports three').not.toMatch(/from\s+['"]three['"]/);
      expect(src, 'imports three subpath').not.toMatch(/from\s+['"]three\//);
      expect(src, 'touches document').not.toMatch(/\bdocument\./);
      expect(src, 'touches window').not.toMatch(/\bwindow\./);
      expect(src, 'uses Math.random (breaks determinism)').not.toMatch(/Math\.random/);
      expect(src, 'imports engine').not.toMatch(/from\s+['"]\.\.\/engine\//);
      expect(src, 'imports ui').not.toMatch(/from\s+['"]\.\.\/ui\//);
      expect(src, 'imports systems').not.toMatch(/from\s+['"]\.\.\/systems\//);
    });
  }

  it('data files do not import three either', () => {
    const dataDir = join(HERE, '..', 'data');
    for (const file of walk(dataDir)) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} imports three`).not.toMatch(/from\s+['"]three['"]/);
    }
  });
});

// ------------------------------------------------------------------
// Procedural 2D icons (SPEC §3): canvas-drawn glyphs from a fixed
// vocabulary, colored per ability/item. Data URLs cached by key.
// ------------------------------------------------------------------

import type { AbilityDef, ItemDef } from '../core/types';

const cache = new Map<string, string>();

function draw(size: number, fn: (ctx: CanvasRenderingContext2D, s: number) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  fn(ctx, size);
  return canvas.toDataURL();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bg(ctx: CanvasRenderingContext2D, s: number, color: string, color2: string): void {
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, color2);
  grad.addColorStop(1, '#10141c');
  ctx.fillStyle = grad;
  roundRect(ctx, 1, 1, s - 2, s - 2, s * 0.16);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  roundRect(ctx, 1.5, 1.5, s - 3, s - 3, s * 0.16);
  ctx.stroke();
}

type GlyphFn = (ctx: CanvasRenderingContext2D, s: number, color: string) => void;

const GLYPHS: Record<string, GlyphFn> = {
  projectile: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.62, s * 0.38, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.8);
    ctx.lineTo(s * 0.5, s * 0.5);
    ctx.stroke();
  },
  'ground-aoe': (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.06;
    for (const r of [0.16, 0.28]) {
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.62, s * r * 1.5, s * r * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.62, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  },
  chain: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.3);
    ctx.lineTo(s * 0.45, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.72);
    ctx.lineTo(s * 0.62, s * 0.62);
    ctx.lineTo(s * 0.8, s * 0.78);
    ctx.stroke();
  },
  beam: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, s * 0.78);
    ctx.lineTo(s * 0.82, s * 0.24);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.82, s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  },
  'summon-pop': (ctx, s, c) => {
    ctx.fillStyle = c;
    for (const [x, y, r] of [[0.5, 0.45, 0.16], [0.32, 0.68, 0.1], [0.68, 0.68, 0.1]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  shield: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.18);
    ctx.lineTo(s * 0.78, s * 0.32);
    ctx.lineTo(s * 0.72, s * 0.66);
    ctx.lineTo(s * 0.5, s * 0.84);
    ctx.lineTo(s * 0.28, s * 0.66);
    ctx.lineTo(s * 0.22, s * 0.32);
    ctx.closePath();
    ctx.stroke();
  },
  'stun-stars': (ctx, s, c) => {
    ctx.fillStyle = c;
    const star = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    star(s * 0.42, s * 0.46, s * 0.22);
    star(s * 0.7, s * 0.32, s * 0.12);
  },
  channel: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.06;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * (0.14 + i * 0.11), i * 0.8, i * 0.8 + Math.PI * 1.4);
      ctx.stroke();
    }
  },
  'global-mark': (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.12);
    ctx.lineTo(s * 0.5, s * 0.88);
    ctx.moveTo(s * 0.12, s * 0.5);
    ctx.lineTo(s * 0.88, s * 0.5);
    ctx.stroke();
  },
  hook: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    ctx.moveTo(s * 0.25, s * 0.2);
    ctx.lineTo(s * 0.55, s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * 0.55, s * 0.66, s * 0.17, -Math.PI / 2, Math.PI * 0.8);
    ctx.stroke();
  },
  wall: (ctx, s, c) => {
    ctx.fillStyle = c;
    for (let i = 0; i < 4; i++) {
      const x = 0.2 + i * 0.16;
      const h = 0.25 + (i % 2) * 0.12;
      ctx.beginPath();
      ctx.moveTo(s * x, s * 0.8);
      ctx.lineTo(s * (x + 0.07), s * (0.8 - h));
      ctx.lineTo(s * (x + 0.14), s * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  },
  storm: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.06;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * (0.12 + i * 0.12), i, i + Math.PI * (1.2 - i * 0.2));
      ctx.stroke();
    }
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.52, s * 0.3);
    ctx.lineTo(s * 0.42, s * 0.52);
    ctx.lineTo(s * 0.52, s * 0.52);
    ctx.lineTo(s * 0.44, s * 0.74);
    ctx.lineTo(s * 0.64, s * 0.48);
    ctx.lineTo(s * 0.53, s * 0.48);
    ctx.lineTo(s * 0.6, s * 0.3);
    ctx.closePath();
    ctx.fill();
  }
};

// item glyphs reuse + extras
const ITEM_GLYPHS: Record<string, GlyphFn> = {
  leaf: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.5, s * 0.3, s * 0.16, -0.7, 0, Math.PI * 2);
    ctx.fill();
  },
  flask: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.44, s * 0.2);
    ctx.lineTo(s * 0.56, s * 0.2);
    ctx.lineTo(s * 0.56, s * 0.42);
    ctx.lineTo(s * 0.7, s * 0.74);
    ctx.arc(s * 0.5, s * 0.74, s * 0.2, 0, Math.PI);
    ctx.lineTo(s * 0.44, s * 0.42);
    ctx.closePath();
    ctx.fill();
  },
  branch: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.85);
    ctx.lineTo(s * 0.5, s * 0.3);
    ctx.moveTo(s * 0.5, s * 0.55);
    ctx.lineTo(s * 0.32, s * 0.38);
    ctx.moveTo(s * 0.5, s * 0.45);
    ctx.lineTo(s * 0.68, s * 0.3);
    ctx.stroke();
  },
  ring: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.55, s * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.3, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  },
  crown: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.22, s * 0.7);
    ctx.lineTo(s * 0.22, s * 0.4);
    ctx.lineTo(s * 0.38, s * 0.55);
    ctx.lineTo(s * 0.5, s * 0.3);
    ctx.lineTo(s * 0.62, s * 0.55);
    ctx.lineTo(s * 0.78, s * 0.4);
    ctx.lineTo(s * 0.78, s * 0.7);
    ctx.closePath();
    ctx.fill();
  },
  fist: (ctx, s, c) => {
    ctx.fillStyle = c;
    roundRect(ctx, s * 0.3, s * 0.35, s * 0.4, s * 0.34, s * 0.08);
    ctx.fill();
    roundRect(ctx, s * 0.24, s * 0.42, s * 0.12, s * 0.2, s * 0.05);
    ctx.fill();
  },
  boot: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.38, s * 0.2);
    ctx.lineTo(s * 0.56, s * 0.2);
    ctx.lineTo(s * 0.56, s * 0.6);
    ctx.lineTo(s * 0.76, s * 0.72);
    ctx.lineTo(s * 0.76, s * 0.8);
    ctx.lineTo(s * 0.38, s * 0.8);
    ctx.closePath();
    ctx.fill();
  },
  mantle: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.18);
    ctx.lineTo(s * 0.74, s * 0.5);
    ctx.lineTo(s * 0.66, s * 0.82);
    ctx.lineTo(s * 0.34, s * 0.82);
    ctx.lineTo(s * 0.26, s * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  band: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.24, 0.3, Math.PI * 2 - 0.3);
    ctx.stroke();
  },
  blade: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.78);
    ctx.lineTo(s * 0.66, s * 0.2);
    ctx.lineTo(s * 0.76, s * 0.3);
    ctx.lineTo(s * 0.4, s * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(s * 0.24, s * 0.66, s * 0.18, s * 0.06);
  },
  hammer: (ctx, s, c) => {
    ctx.fillStyle = c;
    roundRect(ctx, s * 0.3, s * 0.22, s * 0.4, s * 0.24, s * 0.05);
    ctx.fill();
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.08, s * 0.36);
  },
  axe: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.42, s * 0.4, s * 0.24, -Math.PI * 0.6, Math.PI * 0.5);
    ctx.lineTo(s * 0.42, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.07, s * 0.52);
  },
  staff: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(s * 0.42, s * 0.84);
    ctx.lineTo(s * 0.62, s * 0.24);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * 0.64, s * 0.2, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  },
  mask: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.48, s * 0.24, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10141c';
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.42, s * 0.06, s * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.58, s * 0.42, s * 0.06, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  gem: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.2);
    ctx.lineTo(s * 0.74, s * 0.45);
    ctx.lineTo(s * 0.5, s * 0.82);
    ctx.lineTo(s * 0.26, s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#10141c';
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    ctx.moveTo(s * 0.26, s * 0.45);
    ctx.lineTo(s * 0.74, s * 0.45);
    ctx.stroke();
  },
  armor: (ctx, s, c) => GLYPHS.shield(ctx, s, c),
  cloak: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.16);
    ctx.quadraticCurveTo(s * 0.78, s * 0.4, s * 0.7, s * 0.84);
    ctx.lineTo(s * 0.3, s * 0.84);
    ctx.quadraticCurveTo(s * 0.22, s * 0.4, s * 0.5, s * 0.16);
    ctx.fill();
  },
  wand: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.76);
    ctx.lineTo(s * 0.64, s * 0.3);
    ctx.stroke();
    ctx.fillStyle = c;
    for (const [x, y] of [[0.7, 0.22], [0.78, 0.34], [0.62, 0.18]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  dagger: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.16);
    ctx.lineTo(s * 0.58, s * 0.52);
    ctx.lineTo(s * 0.5, s * 0.6);
    ctx.lineTo(s * 0.42, s * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.66, s * 0.08, s * 0.18);
  },
  bar: (ctx, s, c) => {
    ctx.fillStyle = c;
    roundRect(ctx, s * 0.26, s * 0.3, s * 0.48, s * 0.16, s * 0.04);
    ctx.fill();
    roundRect(ctx, s * 0.26, s * 0.54, s * 0.48, s * 0.16, s * 0.04);
    ctx.fill();
  },
  cyclone: (ctx, s, c) => GLYPHS.storm(ctx, s, c),
  gear: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s * 0.5 + Math.cos(a) * s * 0.24, s * 0.5 + Math.sin(a) * s * 0.24);
      ctx.lineTo(s * 0.5 + Math.cos(a) * s * 0.32, s * 0.5 + Math.sin(a) * s * 0.32);
      ctx.stroke();
    }
  },
  drum: (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.36, s * 0.24, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(s * 0.26, s * 0.36, s * 0.48, s * 0.3);
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.66, s * 0.24, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  fang: (ctx, s, c) => {
    ctx.fillStyle = c;
    for (const dx of [-0.1, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(s * (0.45 + dx), s * 0.3);
      ctx.lineTo(s * (0.52 + dx), s * 0.3);
      ctx.lineTo(s * (0.48 + dx), s * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  },
  burst: (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.05;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s * 0.5 + Math.cos(a) * s * 0.12, s * 0.5 + Math.sin(a) * s * 0.12);
      ctx.lineTo(s * 0.5 + Math.cos(a) * s * 0.3, s * 0.5 + Math.sin(a) * s * 0.3);
      ctx.stroke();
    }
  }
};

export function abilityIcon(def: AbilityDef, size = 64): string {
  const key = `ab:${def.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = draw(size, (ctx, s) => {
    bg(ctx, s, def.vfx.color, '#1c2433');
    const glyph = GLYPHS[def.vfx.archetype] ?? GLYPHS.projectile;
    glyph(ctx, s, def.vfx.color);
    if (def.ult) {
      ctx.fillStyle = '#ffd86a';
      ctx.beginPath();
      ctx.arc(s * 0.84, s * 0.16, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  cache.set(key, url);
  return url;
}

const TIER_COLORS: Record<string, string> = {
  consumable: '#9fdc5c',
  component: '#b8c4d8',
  basic: '#7ec8f2',
  core: '#ffd86a'
};

export function itemIcon(def: ItemDef, size = 64): string {
  const key = `it:${def.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = TIER_COLORS[def.tier] ?? '#ffffff';
  const url = draw(size, (ctx, s) => {
    bg(ctx, s, color, '#141a26');
    const glyph = (def.glyph && ITEM_GLYPHS[def.glyph]) || ITEM_GLYPHS.gem;
    glyph(ctx, s, color);
  });
  cache.set(key, url);
  return url;
}

export function heroPortrait(palette: [string, string, string], letter: string, size = 72): string {
  const key = `hp:${palette.join()}:${letter}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = draw(size, (ctx, s) => {
    bg(ctx, s, palette[0], '#1a2030');
    ctx.fillStyle = palette[0];
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.42, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.88);
    ctx.quadraticCurveTo(s * 0.5, s * 0.5, s * 0.76, s * 0.88);
    ctx.fill();
    ctx.fillStyle = palette[2];
    ctx.font = `bold ${s * 0.28}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(letter, s * 0.5, s * 0.46);
  });
  cache.set(key, url);
  return url;
}

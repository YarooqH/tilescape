export const boldFont = (size: number) => `700 ${size}px Geist, system-ui, sans-serif`;

/**
 * Break a message into one to three lines and size it to fit a `w` × `h` box, keeping
 * whichever layout lets the letters be biggest. Long messages lose whole words past `limit`.
 */
export function fitText(g: CanvasRenderingContext2D, text: string, w: number, h: number, max: number, limit = 48, spacing = 0) {
  const words = (text.trim() || 'hello').split(/\s+/);
  while (words.length > 1 && words.join(' ').length > limit) words.pop();
  if (words[0].length > limit) words[0] = words[0].slice(0, limit);
  g.font = boldFont(100);
  g.letterSpacing = `${spacing * 100}px`;
  const widthOf = (from: number, to: number) => g.measureText(words.slice(from, to).join(' ')).width;

  let lines = [words.join(' ')];
  let size = 0;
  const nw = words.length;
  for (let L = 1; L <= Math.min(3, nw); L++) {
    let best: number[] = [];
    let bestW = Infinity;
    for (let a = 1; a <= (L > 1 ? nw - L + 1 : 1); a++) {
      for (let b = L > 2 ? a + 1 : nw; b <= (L > 2 ? nw - 1 : nw); b++) {
        const cuts = L === 1 ? [0, nw] : L === 2 ? [0, a, nw] : [0, a, b, nw];
        let lw = 0;
        for (let k = 0; k < L; k++) lw = Math.max(lw, widthOf(cuts[k], cuts[k + 1]));
        if (lw < bestW) {
          bestW = lw;
          best = cuts;
        }
      }
    }
    const s = Math.min(max, (w * 100) / bestW, h / (L * 1.15));
    // an extra line has to earn its place, or short phrases break up for nothing
    if (s > size * 1.15) {
      size = s;
      lines = best.slice(0, -1).map((from, k) => words.slice(from, best[k + 1]).join(' '));
    }
  }
  return { lines, size };
}

/** Draw lines from `fitText` centred on (cx, cy); `spacing` is extra space between letters, in ems. */
export function drawText(g: CanvasRenderingContext2D, lines: string[], size: number, cx: number, cy: number, spacing = 0) {
  g.font = boldFont(size);
  g.letterSpacing = `${spacing * size}px`;
  // letter spacing also trails the last letter, which would pull centred text left
  cx += (spacing * size) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  lines.forEach((line, k) => g.fillText(line, cx, cy + (k - (lines.length - 1) / 2) * size * 1.15));
}

/** Rasterise a message at one pixel per grid cell; returns coverage 0..1 per cell, or null without a canvas. */
export function textMask(text: string, cols: number, rows: number, cx: number, cy: number, w: number, h: number, max: number, spacing = 0) {
  if (typeof document === 'undefined' || cols === 0 || rows === 0) return null;
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const { lines, size } = fitText(g, text, w, h, max, 48, spacing);
  drawText(g, lines, size, cx, cy, spacing);
  const data = g.getImageData(0, 0, cols, rows).data;
  const mask = new Float32Array(cols * rows);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] / 255;
  return mask;
}

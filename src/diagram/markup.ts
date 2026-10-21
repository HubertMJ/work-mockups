// The SVG markup helpers the architecture drawings are written with: the same ones hubertjablon.ski's
// "The way in" diagram uses (its src/diagram/layout.ts), so both draw in one language. Strings for
// scripts/build.mjs, which writes the drawings into the pages at build time; no DOM is built for them.

export type Pt = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An arrow stops this short of the box it points at, so the head's tip touches the edge. */
export const GAP = 2;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const r1 = (n: number) => String(Math.round(n * 10) / 10);
type Attrs = Record<string, string | number | undefined>;
export function el(tag: string, attrs: Attrs, ...children: string[]): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(typeof v === "number" ? r1(v) : String(v))}"`)
    .join("");
  return children.length ? `<${tag}${a}>${children.join("")}</${tag}>` : `<${tag}${a}/>`;
}
export const text = (cls: string, x: number, y: number, s: string, extra: Attrs = {}) => el("text", { class: cls, x, y, ...extra }, esc(s));
export const pathD = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join(" ");

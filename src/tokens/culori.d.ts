declare module "culori" {
  export type Color = Record<string, number | string | undefined>;

  export function parse(value: string): Color | undefined;
  export function formatHex(color: Color): string | undefined;
  export function formatHex8(color: Color): string | undefined;
  export function converter(mode: "oklch"): (color: Color) => Color | undefined;
}

declare module "postcss-safe-parser" {
  import type { ProcessOptions, Root } from "postcss";

  export default function safeParse(css: string, options?: ProcessOptions): Root;
}

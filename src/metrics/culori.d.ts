declare module "culori" {
  export interface CuloriColor {
    mode: string;
    alpha?: number;
    [channel: string]: number | string | undefined;
  }

  export function parse(value: string): CuloriColor | undefined;
  export function converter(mode: string): (color: string | CuloriColor) => CuloriColor | undefined;
  export function formatHex(color: string | CuloriColor): string | undefined;
  export function differenceEuclidean(
    mode?: string
  ): (first: string | CuloriColor, second: string | CuloriColor) => number;
}

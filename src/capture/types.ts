import type { BrowserContextOptions } from "@playwright/test";
import type {
  DriftRadarConfig,
  DomSample,
  ObservationRecord,
  PageCapture
} from "../contracts/types.js";

export type CaptureState = DriftRadarConfig["states"][number];

export type CaptureWarning = {
  routeId: string;
  url: string;
  message: string;
};

export type CaptureResult = {
  runDir: string;
  pages: PageCapture[];
  observations: ObservationRecord[];
  warnings: CaptureWarning[];
};

export type CaptureOptions = {
  runId?: string;
  runDir?: string;
  allowedOrigin?: string;
  browserOptions?: Pick<BrowserContextOptions, "timezoneId" | "locale">;
};

export type DomSampleDocument = {
  routeId: string;
  viewport: string;
  state: CaptureState;
  elements: DomSample[];
};

export type RawDomSample = Omit<DomSample, "elementId"> & {
  domPath: string;
  classHint: string;
};

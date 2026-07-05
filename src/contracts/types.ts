import type { z } from "zod";
import type {
  configSchema,
  domSampleSchema,
  issueSchema,
  observationRecordSchema,
  pageCaptureSchema,
  reportSchema,
  tokensSchema
} from "./schemas.js";

export type DriftRadarConfig = z.infer<typeof configSchema>;
export type TokenSet = z.infer<typeof tokensSchema>;
export type DomSample = z.infer<typeof domSampleSchema>;
export type ObservationRecord = z.infer<typeof observationRecordSchema>;
export type PageCapture = z.infer<typeof pageCaptureSchema>;
export type DriftIssue = z.infer<typeof issueSchema>;
export type DriftReport = z.infer<typeof reportSchema>;

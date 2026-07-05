import { z } from "zod";

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function duplicateIndex(values: string[]): number {
  const seen = new Set<string>();
  return values.findIndex((value) => {
    if (seen.has(value)) {
      return true;
    }

    seen.add(value);
    return false;
  });
}

const safeKey = /^[a-z0-9_-]+$/;
const safeKeyMessage = "use lowercase letters, numbers, underscores, or dashes";

export const stateSchema = z.enum(["default", "hover", "focus", "disabled", "dark"]);

export const viewportSchema = z.object({
  name: z.string().trim().min(1).regex(safeKey, safeKeyMessage),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const routeSchema = z.object({
  id: z.string().trim().min(1).regex(safeKey, safeKeyMessage),
  url: z.string().trim().min(1),
  label: z.string().trim().min(1).optional()
});

export const thresholdSchema = z
  .object({
    color: z.number().nonnegative().optional(),
    spacing: z.number().nonnegative().optional(),
    radius: z.number().nonnegative().optional(),
    typography: z.number().nonnegative().optional(),
    shadow: z.number().nonnegative().optional()
  })
  .optional();

export const configSchema = z
  .object({
    projectName: z.string().trim().min(1),
    baseUrl: z.string().trim().url().refine(isHttpUrl, "must use http or https"),
    routes: z.array(routeSchema).min(1),
    tokenFiles: z.array(z.string().trim().min(1)).min(1),
    outputDir: z.string().trim().min(1).default(".driftradar"),
    viewports: z
      .array(viewportSchema)
      .min(1)
      .default([
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 }
      ]),
    states: z.array(stateSchema).min(1).default(["default"]),
    storybookMode: z.boolean().default(false),
    thresholds: thresholdSchema,
    // "demo" (default) keeps the deterministic sample-app fixture generator for zero-setup demos.
    // "real" runs the actual Playwright capture, token analyzer, and drift classifier against
    // `baseUrl`/`routes`/`tokenFiles` for scanning a real product or third-party repo.
    captureMode: z.enum(["demo", "real"]).default("demo"),
    ollama: z
      .object({
        enabled: z.boolean().default(false),
        baseUrl: z.string().trim().url().refine(isHttpUrl, "must use http or https").optional(),
        model: z.string().trim().min(1).optional()
      })
      .default({ enabled: false }),
    ai: z
      .object({
        enabled: z.boolean().default(false),
        model: z.string().trim().min(1).default("gpt-5.4-mini"),
        reasoningEffort: z.enum(["low", "medium", "high"]).default("medium"),
        sourceRoots: z.array(z.string().trim().min(1)).default(["sample-app"])
      })
      .default({
        enabled: false,
        model: "gpt-5.4-mini",
        reasoningEffort: "medium",
        sourceRoots: ["sample-app"]
      })
  })
  .superRefine((config, context) => {
    const duplicateRouteIdIndex = duplicateIndex(config.routes.map((route) => route.id));
    if (duplicateRouteIdIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: ["routes", duplicateRouteIdIndex, "id"],
        message: "must be unique"
      });
    }

    const duplicateViewportNameIndex = duplicateIndex(
      config.viewports.map((viewport) => viewport.name)
    );
    if (duplicateViewportNameIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: ["viewports", duplicateViewportNameIndex, "name"],
        message: "must be unique"
      });
    }

    const duplicateStateIndex = duplicateIndex(config.states);
    if (duplicateStateIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: ["states", duplicateStateIndex],
        message: "must be unique"
      });
    }

    config.routes.forEach((route, index) => {
      try {
        const url = new URL(route.url, config.baseUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("unsupported protocol");
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["routes", index, "url"],
          message: "must be a valid absolute URL or relative URL"
        });
      }
    });
  });

export const sourceFileSchema = z.object({
  path: z.string(),
  modifiedTime: z.string()
});

export const tokensSchema = z.object({
  sourceFiles: z.array(sourceFileSchema),
  colors: z.array(
    z.object({
      name: z.string().min(1),
      cssVariable: z.string().optional(),
      originalValue: z.string(),
      oklch: z.string(),
      hex: z.string()
    })
  ),
  spacing: z.array(
    z.object({
      name: z.string().min(1),
      cssVariable: z.string().optional(),
      originalValue: z.string().optional(),
      px: z.number().nonnegative()
    })
  ),
  radii: z.array(
    z.object({
      name: z.string().min(1),
      cssVariable: z.string().optional(),
      originalValue: z.string().optional(),
      px: z.number().nonnegative()
    })
  ),
  typography: z.array(
    z
      .object({
        name: z.string().min(1),
        cssVariable: z.string().optional(),
        originalValue: z.string().optional(),
        family: z.string().optional(),
        size: z.number().nonnegative().optional(),
        lineHeight: z.number().nonnegative().optional(),
        weight: z.number().min(1).max(1000).optional(),
        letterSpacing: z.number().optional()
      })
      .refine(
        (token) =>
          token.family !== undefined ||
          token.size !== undefined ||
          token.lineHeight !== undefined ||
          token.weight !== undefined ||
          token.letterSpacing !== undefined,
        "must include at least one typography value"
      )
  ),
  shadows: z.array(
    z.object({
      name: z.string().min(1),
      cssVariable: z.string().optional(),
      originalValue: z.string().optional(),
      offsetX: z.number(),
      offsetY: z.number(),
      blur: z.number().nonnegative(),
      spread: z.number(),
      color: z.string()
    })
  )
});

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

export const computedStyleSchema = z.object({
  color: z.string(),
  backgroundColor: z.string(),
  borderColor: z.string(),
  fontFamily: z.string(),
  fontSize: z.string(),
  fontWeight: z.string(),
  lineHeight: z.string(),
  letterSpacing: z.string(),
  margin: z.string(),
  padding: z.string(),
  gap: z.string(),
  borderRadius: z.string(),
  boxShadow: z.string(),
  opacity: z.string(),
  cursor: z.string()
});

export const domSampleSchema = z.object({
  elementId: z.string(),
  selectorHint: z.string(),
  role: z.string().optional(),
  tagName: z.string(),
  textSample: z.string().optional(),
  boundingBox: boundingBoxSchema,
  computed: computedStyleSchema
});

export const observationRecordSchema = domSampleSchema.extend({
  routeId: z.string(),
  viewport: z.string(),
  state: stateSchema
});

export const pageCaptureSchema = z.object({
  routeId: z.string(),
  viewport: z.string(),
  state: stateSchema,
  screenshotPath: z.string(),
  capturedAt: z.string(),
  browser: z.object({
    name: z.string(),
    version: z.string()
  })
});

export const issueCategorySchema = z.enum([
  "token_misuse",
  "new_pattern_candidate",
  "accidental_regression",
  "acceptable_exception"
]);

export const issueSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const issuePropertySchema = z.enum([
  "color",
  "spacing",
  "radius",
  "typography",
  "shadow",
  "interaction",
  "component-pattern"
]);

export const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: issueCategorySchema,
  severity: issueSeveritySchema,
  confidence: z.number().min(0).max(1),
  routeId: z.string(),
  viewport: z.string(),
  state: stateSchema,
  elementId: z.string(),
  selectorHint: z.string(),
  property: issuePropertySchema,
  observedValue: z.string(),
  expectedValue: z.string().optional(),
  nearestToken: z.string().optional(),
  evidence: z.object({
    screenshotPath: z.string(),
    cropBox: boundingBoxSchema.optional(),
    tokenDistance: z.number().optional(),
    occurrenceCount: z.number().int().positive().optional(),
    relatedIssueIds: z.array(z.string()).default([])
  }),
  reasoning: z.string(),
  suggestedFix: z.object({
    type: z.string(),
    cssBefore: z.string().optional(),
    cssAfter: z.string().optional(),
    tsxBefore: z.string().optional(),
    tsxAfter: z.string().optional(),
    sourceFile: z.string().optional(),
    humanInstruction: z.string()
  }),
  aiEnriched: z.boolean().optional(),
  status: z.literal("open")
});

export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  configSummary: z.object({
    routes: z.number().int().nonnegative(),
    viewports: z.number().int().nonnegative(),
    states: z.array(stateSchema),
    tokenFiles: z.number().int().nonnegative()
  }),
  summary: z.object({
    totalIssues: z.number().int().nonnegative(),
    countsByCategory: z.record(issueCategorySchema, z.number().int().nonnegative()),
    countsBySeverity: z.record(issueSeveritySchema, z.number().int().nonnegative()),
    driftScore: z.number().min(0).max(100)
  }),
  tokens: z.object({
    counts: z.object({
      colors: z.number().int().nonnegative(),
      spacing: z.number().int().nonnegative(),
      radii: z.number().int().nonnegative(),
      typography: z.number().int().nonnegative(),
      shadows: z.number().int().nonnegative()
    }),
    sourceFiles: z.array(sourceFileSchema)
  }),
  pages: z.array(pageCaptureSchema),
  issues: z.array(issueSchema)
});

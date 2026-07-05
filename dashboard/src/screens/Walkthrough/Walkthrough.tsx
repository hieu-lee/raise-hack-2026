import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Mic2, Pause, Play, Volume2 } from "lucide-react";
import { ScreenshotViewer } from "../../components/ScreenshotViewer/ScreenshotViewer";
import { UnifiedDiff } from "../../components/UnifiedDiff/UnifiedDiff";
import { patchPreviewForFix } from "../../lib/patch";
import { severityOrder, sortIssues } from "../../lib/filtering/filtering";
import type { DashboardConnection } from "../../api/client";
import type { DriftIssue, DriftReport } from "../../types/report";
import "./Walkthrough.css";

type WalkthroughProps = {
  connection: DashboardConnection;
  report: DriftReport;
  resolveAssetUrl: (path: string) => string;
};

type WalkthroughStep =
  | {
      id: string;
      title: string;
      kicker: string;
      caption: string;
      action: string;
      metric?: { label: string; value: string | number };
      issue?: DriftIssue;
    }
  | {
      id: string;
      title: string;
      kicker: string;
      caption: string;
      action: string;
      metric?: { label: string; value: string | number };
      issue?: undefined;
    };

export function Walkthrough({ connection, report, resolveAssetUrl }: WalkthroughProps) {
  const steps = useMemo(() => buildWalkthrough(report), [report]);
  const [stepIndex, setStepIndex] = useState(0);
  const [replayState, setReplayState] = useState<"idle" | "playing">("idle");
  const [voiceState, setVoiceState] = useState<"idle" | "speaking" | "unsupported">("idle");
  const step = steps[stepIndex] ?? steps[0];
  const issue = step.issue;
  const patch = issue?.suggestedFix ? patchPreviewForFix(issue.suggestedFix) : undefined;
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);
  const proof = useMemo(() => proofMetrics(report), [report]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (voiceState !== "speaking") return;
    speak(step.caption, setVoiceState);
  }, [step.caption, voiceState]);

  useEffect(() => {
    if (replayState !== "playing") return;
    const next = window.setTimeout(() => {
      if (stepIndex >= steps.length - 1) {
        setReplayState("idle");
        return;
      }
      setStepIndex((current) => Math.min(steps.length - 1, current + 1));
    }, 2800);
    return () => window.clearTimeout(next);
  }, [replayState, stepIndex, steps.length]);

  const go = (nextIndex: number) => {
    window.speechSynthesis?.cancel();
    setReplayState("idle");
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextIndex)));
  };

  const toggleReplay = () => {
    window.speechSynthesis?.cancel();
    setVoiceState("idle");
    if (replayState === "playing") {
      setReplayState("idle");
      return;
    }
    if (stepIndex >= steps.length - 1) {
      setStepIndex(0);
    }
    setReplayState("playing");
  };

  const toggleVoice = () => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setVoiceState("unsupported");
      return;
    }
    if (voiceState === "speaking") {
      window.speechSynthesis.cancel();
      setVoiceState("idle");
      return;
    }
    setVoiceState("speaking");
  };

  return (
    <section className="walkthrough" aria-labelledby="walkthrough-title">
      <header className="walkthrough__hero">
        <div>
          <p className="walkthrough__eyebrow">Interactive design QA handoff</p>
          <h1 id="walkthrough-title">Replay the review in five minutes</h1>
          <p>
            The daily pain: designers and engineers lose intent in async handoff. This guided
            walkthrough turns a scan into a narrated evidence trail, fix preview, and review packet.
          </p>
          <div className="walkthrough__hero-actions">
            <button type="button" className="button button--primary" onClick={toggleReplay}>
              {replayState === "playing" ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              {replayState === "playing" ? "Pause demo reel" : "Play guided demo reel"}
            </button>
            <a className="button" href="#/issues">
              Inspect live evidence
            </a>
          </div>
          <div className="walkthrough__proof-strip" aria-label="What is real in this replay">
            <span>Real replay proof</span>
            <strong>Playwright screenshots</strong>
            <strong>Local token checks</strong>
            <strong>Source-aware diffs</strong>
            <strong>PR-ready export</strong>
          </div>
        </div>
        <div className="walkthrough__mode-card">
          <span>{connection.mode === "live" ? "Live run" : "Fixture replay"}</span>
          <strong>{report.projectName}</strong>
          <small>
            Run {report.runId} · {report.summary.totalIssues} findings ready
          </small>
        </div>
      </header>

      <section className="walkthrough__proof-board" aria-label="Proof and demo metrics">
        <ProofCard label="Before" value="One review meeting" detail="Screenshots, Slack notes, and subjective taste debate." />
        <ProofCard label="After" value="One async packet" detail={`${proof.criticalOrHigh} release-risk findings, screenshots, fix diffs, and PR text.`} />
        <ProofCard label="Demo mode" value="Cached replay" detail="Works without live AI, network, or a fresh scan during judging." />
        <ProofCard label="Limit" value="Voice is local TTS" detail="Transcript is the durable artifact; voice is progressive enhancement." />
        <ProofCard label="Run provenance" value={report.runId} detail={`${proof.pages} Chromium captures · ${proof.tokens} token file · ${report.createdAt.slice(0, 10)}`} />
      </section>

      <div className="walkthrough__stage">
        <aside className="walkthrough__rail" aria-label="Walkthrough steps">
          <div
            className="walkthrough__progress"
            role="progressbar"
            aria-label="Walkthrough progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <ol>
            {steps.map((candidate, index) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  aria-current={index === stepIndex ? "step" : undefined}
                  onClick={() => go(index)}
                >
                  <span>{index + 1}</span>
                  {candidate.kicker}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <article className="walkthrough__card" aria-live="polite">
          <div className="walkthrough__caption-bar">
            <div>
              <p className="walkthrough__eyebrow">Step {stepIndex + 1} of {steps.length}</p>
              <h2>{step.title}</h2>
            </div>
            <button
              type="button"
              className="button"
              onClick={toggleVoice}
              aria-pressed={voiceState === "speaking"}
            >
              {voiceState === "speaking" ? <Pause size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
              {voiceState === "speaking" ? "Pause voice" : "Play voice"}
            </button>
          </div>

          <div className="walkthrough__caption">
            <Mic2 size={18} aria-hidden />
            <div>
              <span>Narration transcript</span>
              <p>{voiceState === "unsupported" ? "Voice narration is unavailable in this browser. Caption text is shown here instead." : step.caption}</p>
            </div>
          </div>

          <div className="walkthrough__payoff" aria-label="Before and after workflow">
            <div>
              <span>Before</span>
              <strong>Subjective screenshot debate</strong>
            </div>
            <div>
              <span>After</span>
              <strong>{report.summary.totalIssues} evidence-backed findings across {proof.routes} routes</strong>
            </div>
          </div>

          <div className="walkthrough__source-split" aria-label="Deterministic and AI evidence">
            <div>
              <span>Deterministic evidence</span>
              <p>Chromium captures, crop boxes, token distance, observed values, expected tokens.</p>
            </div>
            <div>
              <span>AI assist layer</span>
              <p>Narrated rationale, source-aware fix wording, propagation/review handoff.</p>
            </div>
          </div>

          {step.metric ? (
            <div className="walkthrough__metric">
              <span>{step.metric.label}</span>
              <strong>{step.metric.value}</strong>
            </div>
          ) : null}

          {issue ? (
            <div className="walkthrough__evidence">
              <ScreenshotViewer
                alt={`${issue.title} screenshot evidence`}
                cropBox={issue.evidence?.cropBox}
                src={issue.evidence?.screenshotPath ? resolveAssetUrl(issue.evidence.screenshotPath) : undefined}
              />
              <dl>
                <div>
                  <dt>Observed</dt>
                  <dd>{issue.observedValue}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>{issue.expectedValue ?? "Needs review"}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(issue.confidence * 100)}%</dd>
                </div>
                <div>
                  <dt>Route</dt>
                  <dd>{issue.routeId}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{displaySource(issue.suggestedFix?.sourceFile ?? issue.selectorHint ?? "Report evidence")}</dd>
                </div>
                <div>
                  <dt>Screenshot</dt>
                  <dd>{issue.evidence?.screenshotPath ?? "Report evidence"}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {patch ? (
            <UnifiedDiff
              before={patch.before}
              after={patch.after}
              filePath={
                issue?.suggestedFix?.sourceFile
                  ? displaySource(issue.suggestedFix.sourceFile)
                  : undefined
              }
            />
          ) : null}

          <footer className="walkthrough__controls">
            <button type="button" className="button" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>
              <ChevronLeft size={15} aria-hidden />
              Back
            </button>
            <p>{step.action}</p>
            {stepIndex === steps.length - 1 ? (
              <a className="button button--primary" href="#/export">
                Open review packet
              </a>
            ) : (
              <button type="button" className="button button--primary" onClick={() => go(stepIndex + 1)}>
                Next
                <ChevronRight size={15} aria-hidden />
              </button>
            )}
          </footer>
        </article>
      </div>
    </section>
  );
}

function ProofCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="walkthrough__proof-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function buildWalkthrough(report: DriftReport): WalkthroughStep[] {
  const sorted = sortIssues(report.issues, "severity");
  const evidenceIssue = preferredEvidenceIssue(sorted);
  const fixIssue = preferredFixIssue(sorted) ?? evidenceIssue;
  const routeCount =
    report.configSummary?.routes ??
    new Set(report.pages?.map((page) => page.routeId).filter(Boolean)).size;
  const criticalCount = severityOrder
    .slice(0, 2)
    .reduce((sum, severity) => sum + (report.summary.countsBySeverity[severity] ?? 0), 0);

  return [
    {
      id: "evidence",
      kicker: "Captured regression",
      title: evidenceIssue?.title ?? "No drift found",
      caption: evidenceIssue
        ? `This PR would ship a ${evidenceIssue.severity} ${evidenceIssue.category.replaceAll("_", " ")} on ${evidenceIssue.routeId}: ${evidenceIssue.reasoning}`
        : "This run has no open drift findings, so the walkthrough becomes a clean baseline record.",
      action: "Start with the captured evidence: screenshot, token expectation, confidence, and source hint.",
      issue: evidenceIssue
    },
    {
      id: "triage",
      kicker: "Triage the risk",
      title: "Find the drift that blocks release",
      caption: `${report.summary.totalIssues} findings span ${routeCount} routes. ${criticalCount} are critical or high priority, so the walkthrough focuses attention before people argue over screenshots.`,
      action: "Use the risk summary to decide where review starts.",
      metric: { label: "Drift risk", value: 100 - report.summary.driftScore }
    },
    {
      id: "fix",
      kicker: "Preview the fix",
      title: fixIssue ? fixStepTitle(fixIssue) : "No patch needed",
      caption: fixIssue
        ? `Instead of another comment thread, reviewers get a concrete fix target: ${displaySource(fixIssue.suggestedFix?.sourceFile ?? fixIssue.selectorHint ?? "the affected selector")}.`
        : "Nothing needs a patch in this run.",
      action: "Use the diff as the handoff artifact for engineering review.",
      issue: fixIssue
    },
    {
      id: "pain",
      kicker: "What it replaces",
      title: "Async design QA loses intent",
      caption:
        "A designer posts a Figma link. An engineer ships close-enough CSS. A reviewer finds drift days later. DriftRadar turns that messy handoff into a replayable evidence trail.",
      action: "Use the replay to replace the meeting, not to add another review ritual.",
      metric: { label: "Open findings", value: report.summary.totalIssues }
    },
    {
      id: "packet",
      kicker: "Close the loop",
      title: "Replace the design QA meeting",
      caption:
        "The final artifact is not another meeting recording. It is a PR-ready packet with severity, route, evidence, and suggested fixes, so design QA can happen async without losing intent.",
      action: "Export the review packet when the team is ready.",
      metric: { label: "Review packet", value: "PR-ready" }
    }
  ];
}

function preferredEvidenceIssue(issues: DriftIssue[]): DriftIssue | undefined {
  return (
    issues.find((issue) => isScreenshotBacked(issue) && issue.title.includes("Focus ring")) ??
    issues.find(isScreenshotBacked) ??
    issues[0]
  );
}

function preferredFixIssue(issues: DriftIssue[]): DriftIssue | undefined {
  return (
    issues.find(
      (issue) =>
        isScreenshotBacked(issue) &&
        issue.title.includes("Focus ring") &&
        Boolean(issue.suggestedFix?.cssAfter || issue.suggestedFix?.tsxAfter)
    ) ??
    issues.find((issue) => isScreenshotBacked(issue) && Boolean(issue.suggestedFix?.cssAfter || issue.suggestedFix?.tsxAfter))
  );
}

function isScreenshotBacked(issue: DriftIssue): boolean {
  return Boolean(issue.evidence?.screenshotPath);
}

function fixStepTitle(issue: DriftIssue): string {
  if (issue.title.includes("Focus ring")) {
    return "Use the shared focus-ring token";
  }
  if (issue.category === "token_misuse") {
    return "Replace the hard-coded style with the design token";
  }
  return "Preview the source-aware fix";
}

function displaySource(source: string): string {
  const sampleAppIndex = source.indexOf("sample-app/");
  if (sampleAppIndex >= 0) {
    return source.slice(sampleAppIndex);
  }
  return source.replace(/^.*\/([^/]+\/[^/]+)$/, "$1");
}

function proofMetrics(report: DriftReport) {
  const routes =
    report.configSummary?.routes ??
    new Set(report.pages?.map((page) => page.routeId).filter(Boolean)).size;
  const pages = report.pages?.length ?? 0;
  const tokens = report.configSummary?.tokenFiles ?? report.tokens?.sourceFiles?.length ?? 0;
  const criticalOrHigh =
    (report.summary.countsBySeverity.critical ?? 0) + (report.summary.countsBySeverity.high ?? 0);
  return { criticalOrHigh, pages, routes, tokens };
}

function speak(text: string, setVoiceState: (state: "idle" | "speaking" | "unsupported") => void) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    setVoiceState("unsupported");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.onend = () => setVoiceState("idle");
  utterance.onerror = () => setVoiceState("idle");
  window.speechSynthesis.speak(utterance);
}

import { useEffect, useState } from "react";
import {
  DEFAULT_API_BASE_URL,
  assetUrlFor,
  type DashboardConnection,
  type DashboardData,
  loadDashboardData,
  runIdFromSearch
} from "./api/client";
import { AppShell } from "./layout/AppShell";
import { ExportScreen } from "./screens/Export";
import { IssueWorkbench } from "./screens/Issues/IssueWorkbench";
import { Overview } from "./screens/Overview/Overview";
import { RunLanding } from "./screens/RunLanding/RunLanding";
import "./App.css";

type Screen = "run" | "overview" | "issues" | "export";

const loadingConnection: DashboardConnection = {
  mode: "disconnected",
  apiBaseUrl: DEFAULT_API_BASE_URL,
  message: "Checking local API and fixture data."
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromHash(window.location.hash));
  const [data, setData] = useState<DashboardData>({ connection: loadingConnection });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let ignore = false;
    loadDashboardData({ runId: runIdFromSearch(window.location.search) }).then((nextData) => {
      if (!ignore) {
        setData(nextData);
        setLoading(false);
      }
    });
    return () => {
      ignore = true;
    };
  }, []);

  const assetUrl = (path: string) => assetUrlFor(data.connection, path) ?? "";
  const report = data.connection.mode !== "disconnected" ? data.report : undefined;

  return (
    <AppShell activeScreen={screen} connection={data.connection}>
      {screen === "run" ? (
        <RunLanding connection={data.connection} loading={loading} report={data.report} />
      ) : screen === "overview" && report ? (
        <Overview
          apiBaseUrl={data.connection.apiBaseUrl}
          mutationToken={data.connection.mutationToken}
          mode={data.connection.mode === "live" ? "live" : "fixture"}
          report={report}
        />
      ) : screen === "issues" && report ? (
        <IssueWorkbench
          apiBaseUrl={data.connection.apiBaseUrl}
          connectionMode={data.connection.mode}
          mutationToken={data.connection.mutationToken}
          report={report}
          resolveAssetUrl={assetUrl}
        />
      ) : screen === "export" && report ? (
        <ExportScreen
          apiBaseUrl={data.connection.apiBaseUrl}
          mode={data.connection.mode === "live" ? "live" : "fixture"}
          report={report}
        />
      ) : (
        <PlaceholderScreen screen={screen} />
      )}
    </AppShell>
  );
}

function PlaceholderScreen({ screen }: { screen: Exclude<Screen, "run"> }) {
  const copy = {
    overview: "Overview loads after a live or fixture report is available.",
    issues: "Issue workbench loads after a live or fixture report is available.",
    export: "Export loads PR-ready markdown from the backend or fixture."
  }[screen];

  return (
    <section className="placeholder-screen" aria-labelledby={`${screen}-title`}>
      <p className="placeholder-screen__eyebrow">Route ready</p>
      <h1 id={`${screen}-title`}>{titleCase(screen)}</h1>
      <p>{copy}</p>
    </section>
  );
}

function screenFromHash(hash: string): Screen {
  const screen = hash.replace(/^#\/?/, "");
  if (screen === "overview" || screen === "issues" || screen === "export") {
    return screen;
  }
  return "run";
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

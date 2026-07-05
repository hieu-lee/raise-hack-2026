import type { ReactNode } from "react";
import { Download, Home, LayoutDashboard, ListChecks, PlayCircle } from "lucide-react";
import type { DashboardConnection } from "../api/client";
import "./AppShell.css";

interface AppShellProps {
  activeScreen: string;
  connection: DashboardConnection;
  children: ReactNode;
}

const navItems = [
  { screen: "run", label: "Run", href: "#/", icon: PlayCircle },
  { screen: "overview", label: "Overview", href: "#/overview", icon: LayoutDashboard },
  { screen: "issues", label: "Issues", href: "#/issues", icon: ListChecks },
  { screen: "export", label: "Export", href: "#/export", icon: Download }
];

export function AppShell({ activeScreen, connection, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <a className="app-shell__brand" href="#/" aria-label="DriftRadar run landing">
          <span className="app-shell__mark">
            <Home size={14} aria-hidden />
          </span>
          <span>
            <strong>DriftRadar</strong>
          </span>
        </a>
        <nav className="app-shell__nav" aria-label="Dashboard">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.screen}
                href={item.href}
                aria-current={activeScreen === item.screen ? "page" : undefined}
                title={item.label}
              >
                <Icon size={16} aria-hidden />
                <span className="app-shell__nav-label">{item.label}</span>
              </a>
            );
          })}
        </nav>
        <ConnectionBadge connection={connection} />
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: DashboardConnection }) {
  const label = {
    live: "Live",
    fixture: "Fixture",
    "no-runs": "No runs",
    disconnected: "Offline"
  }[connection.mode];

  return (
    <span
      className={`connection-badge connection-badge--${connection.mode}`}
      title={connection.message}
    >
      {label}
    </span>
  );
}

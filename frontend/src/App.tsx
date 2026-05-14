import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { DetailPanel } from "./components/DetailPanel";
import { Legend } from "./components/Legend";
import { PinnedBar } from "./components/PinnedBar";
import { Toaster } from "./components/Toaster";
import { ForceGraph } from "./graph/ForceGraph";
import { useStore } from "./store";

interface HealthInfo {
  pbip: string;
  version: string;
}

export function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const theme = useStore((s) => s.theme);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/healthz")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ pbip: "(unknown)", version: "?" }));
    bootstrap();
  }, [bootstrap]);

  return (
    <div className="app">
      <Header pbipPath={health?.pbip ?? ""} />
      <div className="app-body">
        <Sidebar />
        <main className="canvas">
          {loading && <div className="overlay">Loading model…</div>}
          {error && (
            <div className="overlay error">
              <strong>Failed to load model:</strong> {error}
            </div>
          )}
          <PinnedBar />
          <ForceGraph />
          <Legend />
        </main>
        <DetailPanel />
      </div>
      <Toaster />
    </div>
  );
}

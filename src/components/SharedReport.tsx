"use client";

import { useEffect, useState } from "react";
import type { ExecutionReport } from "@/lib/types";
import ReportCard from "./ReportCard";

// 共有リンク（/report?r=…）を読み、サーバーで署名を確かめてから表示する
export default function SharedReport() {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "error"; message: string } | { phase: "ok"; report: ExecutionReport; verified: boolean; token: string }
  >({ phase: "loading" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("r");
    if (!token) {
      queueMicrotask(() => setState({ phase: "error", message: "This link has no report in it." }));
      return;
    }
    fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        setState({ phase: "ok", report: j.report, verified: j.verified, token });
      })
      .catch((e) => setState({ phase: "error", message: e.message }));
  }, []);

  if (state.phase === "loading") return <p className="animate-pulse text-sm text-ink-3">Verifying report…</p>;
  if (state.phase === "error") return <p className="text-sm text-crit">⛔ {state.message}</p>;
  return <ReportCard r={state.report} verified={state.verified} token={state.token} />;
}

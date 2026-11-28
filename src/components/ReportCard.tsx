"use client";

import { useState } from "react";
import type { ExecutionReport, Verdict } from "@/lib/types";

const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n: number | null, d = 2) =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(d)}%`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const VERDICT: Record<Verdict, { icon: string; label: string; cls: string }> = {
  good: { icon: "✓", label: "Fair", cls: "text-good" },
  caution: { icon: "⚠", label: "Caution", cls: "text-warn" },
  danger: { icon: "⛔", label: "Overpriced", cls: "text-crit" },
  unknown: { icon: "·", label: "No quote", cls: "text-ink-3" },
};

/** 最良執行レポート。購入直後の画面と、共有リンクのページの両方で使う */
export default function ReportCard({
  r,
  token,
  verified,
}: {
  r: ExecutionReport;
  token?: string; // 共有リンク用の署名付きトークン
  verified?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/report?r=${token}` : null;

  function download() {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fairfill-report-${r.orderId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <article className="space-y-5 rounded-xl border border-accent/50 bg-surface-1 p-5 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-3">Best execution report</p>
          <h3 className="mt-1 text-lg">
            Bought <span className="num">{usd(r.amountUsdc)}</span> of <span className="num">{r.ticker}</span> as{" "}
            <span className="num">{r.token.symbol}</span> via True Markets Gateway
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            Order <span className="num">{r.orderId}</span> · {r.status} · {new Date(r.executedAt).toUTCString()}
          </p>
        </div>
        {verified !== undefined && (
          <span className={`rounded-full border px-2.5 py-1 text-xs ${verified ? "border-good/50 text-good" : "border-crit/60 text-crit"}`}>
            {verified ? "✓ Issued by FairFill (signature verified)" : "⛔ Signature invalid — this report was modified"}
          </span>
        )}
      </header>

      {/* 主要な数字 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Fill price per share" value={usd(r.fillPricePerShare)} sub={`${pct(r.fillVsReferencePct)} vs reference`} />
        <Stat
          label="Saved vs the worst option"
          value={r.savedVsWorstUsd === null ? "—" : usd(r.savedVsWorstUsd)}
          sub={
            r.worst && r.savedVsWorstPct !== null
              ? `${r.savedVsWorstPct.toFixed(2)}% less than ${r.worst.symbol} via ${r.worst.venue} (${usd(r.worst.pricePerShare)}/sh)`
              : "No other quote to compare"
          }
          accent
        />
        <Stat
          label="vs the next-best option"
          value={r.diffVsNextBestPct === null ? "—" : pct(r.diffVsNextBestPct)}
          sub={
            r.nextBest
              ? r.diffVsNextBestPct! >= 0
                ? `${r.nextBest.symbol} via ${r.nextBest.venue} would have cost more (${usd(r.nextBest.pricePerShare)}/sh)`
                : `${r.nextBest.symbol} via ${r.nextBest.venue} was cheaper (${usd(r.nextBest.pricePerShare)}/sh)`
              : "No other quote to compare"
          }
        />
      </div>

      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <Row k="Received" v={`${r.tokensReceived.toFixed(6)} ${r.token.symbol} = ${r.sharesReceived.toFixed(6)} shares (1 token = ${r.token.multiplier.toFixed(4)} sh)`} />
        <Row
          k="Reference price"
          v={r.reference ? `${usd(r.reference.price)} · ${r.reference.label}${r.reference.stale ? " · stale" : ""}` : "None (no oracle)"}
        />
        <Row k="Pre-trade guard" v={`Live quote re-checked before signing; blocks ≥ ${r.guard.thresholdPct}% above reference`} />
        <Row
          k="Wallet"
          v={
            <>
              <span className="num">{short(r.wallet)}</span>
              {r.gatewayWallet && (
                <>
                  {" "}→ Gateway wallet{" "}
                  <a className="num text-accent underline" href={`https://solscan.io/account/${r.gatewayWallet}`} target="_blank" rel="noreferrer">
                    {short(r.gatewayWallet)}
                  </a>
                </>
              )}
            </>
          }
        />
      </dl>

      {/* 執行直前の全選択肢 */}
      <div className="overflow-x-auto">
        <p className="mb-2 text-xs text-ink-3">Every option at the moment of execution (same amount, fees included, per share)</p>
        <table className="w-full text-xs">
          <thead className="text-left text-ink-3">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-normal">Token</th>
              <th className="py-2 pr-3 font-normal">Venue</th>
              <th className="py-2 pr-3 text-right font-normal">Price / share</th>
              <th className="py-2 pr-3 text-right font-normal">vs reference</th>
              <th className="py-2 font-normal">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {r.options.map((o) => {
              const v = VERDICT[o.verdict];
              return (
                <tr key={`${o.symbol}-${o.venue}`} className={`border-b border-border/60 ${o.executed ? "bg-accent/10" : ""}`}>
                  <td className="num py-2 pr-3">
                    {o.symbol} <span className="text-ink-3">{o.issuer}</span>
                    {o.executed && <span className="ml-2 text-accent">executed</span>}
                  </td>
                  <td className="py-2 pr-3">{o.venue}</td>
                  <td className="num py-2 pr-3 text-right">{o.pricePerShare === null ? "—" : usd(o.pricePerShare)}</td>
                  <td className="num py-2 pr-3 text-right">{pct(o.overpayPct)}</td>
                  <td className={`py-2 ${v.cls}`}>
                    {v.icon} {v.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap gap-2">
        {shareUrl && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-white"
          >
            {copied ? "Link copied" : "Copy share link"}
          </button>
        )}
        {shareUrl && (
          <a href={shareUrl} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
            Open report page ↗
          </a>
        )}
        <button onClick={download} className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
          Download JSON
        </button>
      </footer>
    </article>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-good/40 bg-good/5" : "border-border bg-surface-2"}`}>
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`num mt-1 text-2xl ${accent ? "text-good" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-3">{sub}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-ink-3">{k}</dt>
      <dd className="text-ink-2">{v}</dd>
    </div>
  );
}

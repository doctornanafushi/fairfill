"use client";

import { useEffect, useState } from "react";
import type { CompareResult, CurveResult, ExecutionReport, QuoteOption, Verdict } from "@/lib/types";
import CurveChart from "./CurveChart";
import ReportCard from "./ReportCard";
import { useWallet, WalletPanel } from "./Wallet";

type Ticker = { ticker: string; name: string; tokens: string[] };

const PRESETS = [50, 100, 500, 1000, 5000];
const usd = (n: number, d = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

export default function Terminal() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [ticker, setTicker] = useState("AAPL");
  const [amount, setAmount] = useState(100);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [crv, setCrv] = useState<CurveResult | null>(null);
  const [loading, setLoading] = useState<"idle" | "compare" | "curve">("idle");
  const [error, setError] = useState<string | null>(null);
  const w = useWallet();

  useEffect(() => {
    fetch("/api/tickers")
      .then((r) => r.json())
      .then((j) => setTickers(j.tickers ?? []))
      .catch(() => {});
  }, []);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setError(null);
    setCmp(null);
    setCrv(null);
    setLoading("compare");
    try {
      const r = await fetch(`/api/compare?ticker=${encodeURIComponent(t)}&amount=${amount}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setCmp(j);
      // 価格曲線は数十回の見積もりが要るので、比較を出してから裏で取る
      setLoading("curve");
      const c = await fetch(`/api/curve?ticker=${encodeURIComponent(t)}`);
      const cj = await c.json();
      if (c.ok) setCrv(cj);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading("idle");
    }
  }

  const q = ticker.trim().toUpperCase();
  const known = tickers.find((x) => x.ticker === q || x.tokens.some((s) => s.toUpperCase() === q));

  return (
    <div className="space-y-6">
      <WalletPanel w={w} />
      {/* 入力 */}
      <form onSubmit={run} className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-3">Stock</span>
            <input
              list="tickers"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="num w-36 rounded-lg border border-border bg-surface-2 px-3 py-2 text-lg outline-none focus:border-accent"
              placeholder="AAPL"
              aria-label="Stock ticker"
            />
            <datalist id="tickers">
              {tickers.map((t) => (
                <option key={t.ticker} value={t.ticker}>
                  {t.name} — {t.tokens.join(", ")}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-3">Amount (USDC)</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="num w-36 rounded-lg border border-border bg-surface-2 px-3 py-2 text-lg outline-none focus:border-accent"
              aria-label="Amount in USDC"
            />
          </label>
          <div className="flex gap-1.5 pb-1">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setAmount(p)}
                className={`num rounded-md border px-2.5 py-1 text-xs ${
                  amount === p ? "border-accent text-ink" : "border-border text-ink-3 hover:text-ink-2"
                }`}
              >
                ${p.toLocaleString("en-US")}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading !== "idle"}
            className="ml-auto rounded-lg bg-accent px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {loading === "compare" ? "Comparing…" : "Compare prices"}
          </button>
        </div>
        {known && (
          <p className="mt-3 text-xs text-ink-3">
            {known.name} · tokens on Solana: <span className="num text-ink-2">{known.tokens.join(", ")}</span>
          </p>
        )}
      </form>

      {error && (
        <div role="alert" className="rounded-xl border border-crit/60 bg-crit/10 p-4 text-sm">
          ⛔ {error}
        </div>
      )}

      {loading === "compare" && <Skeleton label="Asking the AMM, Gateway and the price oracle…" />}

      {cmp && <CompareView r={cmp} w={w} />}

      {loading === "curve" && <Skeleton label="Sampling quotes at 7 order sizes to draw the price curve…" />}
      {crv && <CurveChart r={crv} />}
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-surface-1 p-6 text-sm text-ink-3">{label}</div>
  );
}

const VERDICT: Record<Verdict, { icon: string; label: string; cls: string }> = {
  good: { icon: "✓", label: "Fair", cls: "text-good border-good/50" },
  caution: { icon: "⚠", label: "Caution", cls: "text-warn border-warn/50" },
  danger: { icon: "⛔", label: "Overpriced", cls: "text-crit border-crit/60" },
  unknown: { icon: "·", label: "No quote", cls: "text-ink-3 border-border" },
};

function Badge({ v }: { v: Verdict }) {
  const s = VERDICT[v];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

type BuyState =
  | { phase: "idle" }
  | { phase: "confirm"; o: QuoteOption }
  | { phase: "buying"; o: QuoteOption }
  | { phase: "done"; o: QuoteOption; orderId: string; status: string; overpayPct: number | null; pricePerShare: number; report?: ExecutionReport; reportToken?: string }
  | { phase: "error"; o: QuoteOption; message: string };

function CompareView({ r, w }: { r: CompareResult; w: ReturnType<typeof useWallet> }) {
  const [buy, setBuy] = useState<BuyState>({ phase: "idle" });

  async function execute(o: QuoteOption) {
    setBuy({ phase: "buying", o });
    try {
      const res = await fetch("/api/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: r.ticker, symbol: o.token.symbol, amount: r.amountUsdc }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setBuy({
        phase: "done",
        o,
        orderId: j.orderId,
        status: j.status,
        overpayPct: j.overpayPct,
        pricePerShare: j.pricePerShare,
        report: j.report,
        reportToken: j.reportToken,
      });
      w.refresh();
    } catch (e: any) {
      setBuy({ phase: "error", o, message: e.message });
    }
  }

  const ref = r.reference;
  const rows = [...r.options].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {/* 基準価格 */}
        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <p className="text-xs text-ink-3">Reference price · {r.ticker}</p>
          <p className="num mt-2 text-3xl">{ref ? usd(ref.price) : "—"}</p>
          <p className="mt-2 text-xs text-ink-3">
            {ref ? ref.label : "No oracle available"}
            {ref?.stale && <span className="text-warn"> · stale (market closed?)</span>}
          </p>
        </div>
        {/* 推奨 */}
        <div className="rounded-xl border border-accent/50 bg-surface-1 p-5 md:col-span-2">
          <p className="text-xs text-ink-3">Best way to buy {usd(r.amountUsdc, 0)} of {r.ticker}</p>
          {r.best ? (
            <>
              <p className="mt-2 text-2xl">
                <span className="num">{r.best.token.symbol}</span>
                <span className="text-ink-3"> via </span>
                {r.best.venue}
              </p>
              <p className="mt-2 text-sm text-ink-2">
                Effective <span className="num">{usd(r.best.price!)}</span> per share
                {r.best.overpayPct !== null && <> · <span className="num">{pct(r.best.overpayPct)}</span> vs reference</>}
                {r.savedVsWorstUsd !== null && r.savedVsWorstUsd > 0.005 && (
                  <>
                    {" "}· saves <span className="num text-good">{usd(r.savedVsWorstUsd)}</span> vs the worst option
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="mt-2 text-lg text-crit">⛔ No fair option right now — better not to buy.</p>
          )}
        </div>
      </div>

      {r.warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-warn/40 bg-warn/5 p-4 text-sm text-ink-2">
          {r.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <BuyPanel buy={buy} r={r} onConfirm={execute} onClose={() => setBuy({ phase: "idle" })} />

      {/* 全選択肢 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface-1">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Token</th>
              <th className="px-4 py-3 font-normal">Venue</th>
              <th className="px-4 py-3 text-right font-normal">You receive</th>
              <th className="px-4 py-3 text-right font-normal">Price / share</th>
              <th className="px-4 py-3 text-right font-normal">vs reference</th>
              <th className="px-4 py-3 font-normal">Verdict</th>
              <th className="px-4 py-3 font-normal">Route</th>
              <th className="px-4 py-3 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <Row
                key={`${o.token.symbol}-${o.venue}`}
                o={o}
                best={o === r.best}
                action={<Action o={o} r={r} w={w} busy={buy.phase === "buying"} onBuy={() => setBuy({ phase: "confirm", o })} />}
              />
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-4 py-2.5 text-xs text-ink-3">
          Prices include fees and are per share: token amounts are converted with the on-chain share multiplier
          (Token-2022 ScaledUiAmount — dividends reinvested, splits). Gateway charges 0.5% and pays network fees. Thresholds: caution ≥ {r.thresholds.warnPct}%, overpriced ≥{" "}
          {r.thresholds.dangerPct}% above reference. Quotes only — nothing is executed.
        </p>
      </div>
    </section>
  );
}

function Row({ o, best, action }: { o: QuoteOption; best: boolean; action: React.ReactNode }) {
  return (
    <tr className={`border-b border-border/60 last:border-0 ${best ? "bg-accent/5" : ""}`}>
      <td className="px-4 py-3">
        <span className="num">{o.token.symbol}</span>
        <span className="ml-2 text-xs text-ink-3">{o.token.issuer}</span>
        {Math.abs(o.token.multiplier - 1) > 1e-9 && (
          <div className="num text-xs text-ink-3" title="Read on-chain from the Token-2022 ScaledUiAmount extension">
            1 token = {o.token.multiplier.toFixed(4)} sh
          </div>
        )}
        {best && <span className="ml-2 text-xs text-accent">best</span>}
      </td>
      <td className="px-4 py-3">{o.venue}</td>
      <td className="num px-4 py-3 text-right">
        {o.qtyOut === null ? "—" : `${o.qtyOut.toFixed(6)} ${o.token.symbol}`}
        {o.shares !== null && Math.abs(o.token.multiplier - 1) > 1e-9 && (
          <div className="text-xs text-ink-3">= {o.shares.toFixed(6)} shares</div>
        )}
      </td>
      <td className="num px-4 py-3 text-right">{o.price === null ? "—" : usd(o.price)}</td>
      <td className="num px-4 py-3 text-right">{pct(o.overpayPct)}</td>
      <td className="px-4 py-3">
        <Badge v={o.verdict} />
      </td>
      <td className="max-w-56 truncate px-4 py-3 text-xs text-ink-3" title={o.error ?? o.route}>
        {o.qtyOut === null ? <span className="text-crit">{o.error ?? "no quote"}</span> : o.route}
      </td>
      <td className="px-4 py-3 text-right">{action}</td>
    </tr>
  );
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function Action({ o, r, w, busy, onBuy }: { o: QuoteOption; r: CompareResult; w: ReturnType<typeof useWallet>; busy: boolean; onBuy: () => void }) {
  if (o.price === null) return null;
  if (o.venue === "Jupiter") {
    // FairFill が執行するのは Gateway だけ。AMM が最安のときは正直に Jupiter へ案内する
    return (
      <a
        href={`https://jup.ag/swap?sell=${USDC_MINT}&buy=${o.token.mint}`}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap text-xs text-ink-2 underline hover:text-ink"
      >
        Open in Jupiter ↗
      </a>
    );
  }
  const reason = !w.me
    ? "Connect your wallet first"
    : o.verdict === "danger"
      ? "Blocked: far above the reference price"
      : w.me.usdc < r.amountUsdc
        ? `Deposit at least ${r.amountUsdc} USDC first`
        : null;
  return (
    <button
      onClick={onBuy}
      disabled={!!reason || busy}
      title={reason ?? "Buy through True Markets Gateway"}
      className="whitespace-nowrap rounded-md bg-accent px-3 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      Buy
    </button>
  );
}

function BuyPanel({ buy, r, onConfirm, onClose }: { buy: BuyState; r: CompareResult; onConfirm: (o: QuoteOption) => void; onClose: () => void }) {
  if (buy.phase === "idle") return null;
  const o = buy.o;
  return (
    <div className="rounded-xl border border-accent/50 bg-surface-1 p-4 text-sm" role="status">
      {buy.phase === "confirm" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Buy <span className="num">{usd(r.amountUsdc, 2)}</span> of <span className="num">{o.token.symbol}</span> through
            True Markets Gateway at about <span className="num">{usd(o.price!)}</span> per share
            {o.overpayPct !== null && <> ({pct(o.overpayPct)} vs reference)</>}? FairFill re-checks the live quote against the
            reference price right before signing and stops if it moved too far.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-ink-2">Cancel</button>
            <button onClick={() => onConfirm(o)} className="rounded-md bg-accent px-3 py-1.5 text-white">Confirm purchase</button>
          </div>
        </div>
      )}
      {buy.phase === "buying" && <p className="animate-pulse text-ink-2">Re-checking the quote, signing and executing on Gateway…</p>}
      {buy.phase === "done" && buy.report && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-ink-2">Close</button>
          </div>
          <ReportCard r={buy.report} token={buy.reportToken} />
        </div>
      )}
      {buy.phase === "done" && !buy.report && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            ✓ Order <span className="num text-xs">{buy.orderId}</span> — status <span className="text-good">{buy.status}</span>.
            Filled at <span className="num">{usd(buy.pricePerShare)}</span> per share
            {buy.overpayPct !== null && <> ({pct(buy.overpayPct)} vs reference)</>}.
          </p>
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-ink-2">Close</button>
        </div>
      )}
      {buy.phase === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-crit">⛔ {buy.message}</p>
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-ink-2">Close</button>
        </div>
      )}
    </div>
  );
}

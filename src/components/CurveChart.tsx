"use client";

import { useMemo, useState } from "react";
import type { CurveResult } from "@/lib/types";

// 検証済みの系列色（dark）。系列の並び順で固定割り当て（順位で塗り替えない）
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

const W = 900;
const H = 360;
const M = { l: 60, r: 150, t: 20, b: 44 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US")}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(n >= 100 ? 0 : 2)}%`;

export default function CurveChart({ r }: { r: CurveResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const series = r.series.slice(0, 4); // 4系列まで（2トークン×2取引場所）
  const sizes = r.sizes;

  // y 範囲：極端な外れ値は上端に「↑」で示し、軸はつぶさない
  const { yMin, yMax } = useMemo(() => {
    const vals = series.flatMap((s) => s.points.map((p) => p.overpayPct)).filter((v): v is number => v !== null);
    const sane = vals.filter((v) => v < 30);
    const hi = Math.max(3, ...(sane.length ? sane : [3]));
    const lo = Math.min(-1, ...(vals.length ? vals : [-1]));
    return { yMin: Math.floor(lo) - 0.5, yMax: Math.ceil(hi * 1.15) };
  }, [series]);

  const lx0 = Math.log10(sizes[0]);
  const lx1 = Math.log10(sizes[sizes.length - 1]);
  const x = (v: number) => M.l + ((Math.log10(v) - lx0) / (lx1 - lx0)) * PW;
  const y = (v: number) => M.t + (1 - (Math.min(v, yMax) - yMin) / (yMax - yMin)) * PH;

  const yTicks = niceTicks(yMin, yMax, 5);

  // 線の右端ラベル：重ならないよう縦にずらす
  const endLabels = useMemo(() => {
    const items = series
      .map((s, i) => {
        const last = [...s.points].reverse().find((p) => p.overpayPct !== null);
        return last ? { i, key: s.key, yy: y(last.overpayPct!) } : null;
      })
      .filter((v): v is { i: number; key: string; yy: number } => v !== null)
      .sort((a, b) => a.yy - b.yy);
    for (let k = 1; k < items.length; k++) if (items[k].yy - items[k - 1].yy < 15) items[k].yy = items[k - 1].yy + 15;
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, yMin, yMax]);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    sizes.forEach((s, i) => {
      if (Math.abs(x(s) - px) < Math.abs(x(sizes[best]) - px)) best = i;
    });
    setHover(best);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">How the price moves with order size · {r.ticker}</h2>
            <p className="mt-1 text-xs text-ink-3">
              Effective price vs {r.reference ? r.reference.label : "reference"} · lower is better · order size on a log scale
            </p>
          </div>
          <button
            onClick={() => setShowTable((v) => !v)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-ink-2 hover:text-ink"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>

        {/* 凡例（2系列以上なので常に表示。Gateway は破線で二重に区別） */}
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              <svg width="26" height="10" aria-hidden>
                <line
                  x1="1" y1="5" x2="25" y2="5"
                  stroke={COLORS[i]} strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={s.venue === "Gateway" ? "5 4" : undefined}
                />
              </svg>
              <span className="num">{s.token.symbol}</span> · {s.venue}
            </span>
          ))}
        </div>

        {showTable ? (
          <DataTable r={r} />
        ) : (
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Price curve for ${r.ticker}`}>
              {/* グリッドと軸（控えめ） */}
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={M.l} x2={M.l + PW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
                  <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" className="num">
                    {fmtPct(t)}
                  </text>
                </g>
              ))}
              {sizes.map((s) => (
                <text key={s} x={x(s)} y={H - M.b + 18} textAnchor="middle" fontSize="11" fill="var(--text-muted)" className="num">
                  {fmtUsd(s)}
                </text>
              ))}
              <text x={M.l + PW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                Order size (USDC)
              </text>

              {/* 基準価格の線 */}
              {0 > yMin && 0 < yMax && (
                <g>
                  <line x1={M.l} x2={M.l + PW} y1={y(0)} y2={y(0)} stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="2 3" />
                  <text x={M.l + 4} y={y(0) - 5} fontSize="10" fill="var(--text-secondary)">
                    reference price
                  </text>
                </g>
              )}

              {/* 系列 */}
              {series.map((s, i) => {
                const pts = s.points.filter((p) => p.overpayPct !== null);
                const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.amountUsdc)},${y(p.overpayPct!)}`).join(" ");
                return (
                  <g key={s.key}>
                    <path
                      d={d} fill="none" stroke={COLORS[i]} strokeWidth="2"
                      strokeLinejoin="round" strokeLinecap="round"
                      strokeDasharray={s.venue === "Gateway" ? "6 4" : undefined}
                    />
                    {pts.map((p) =>
                      p.overpayPct! > yMax ? (
                        // 軸外の外れ値：上端に三角と値
                        <g key={p.amountUsdc}>
                          <path
                            d={`M${x(p.amountUsdc) - 5},${M.t + 9} L${x(p.amountUsdc) + 5},${M.t + 9} L${x(p.amountUsdc)},${M.t + 1} Z`}
                            fill={COLORS[i]} stroke="var(--surface-1)" strokeWidth="2"
                          />
                          <text x={x(p.amountUsdc) + 8} y={M.t + 10} fontSize="10" fill="var(--text-secondary)" className="num">
                            {fmtPct(p.overpayPct!)}
                          </text>
                        </g>
                      ) : (
                        <circle
                          key={p.amountUsdc}
                          cx={x(p.amountUsdc)} cy={y(p.overpayPct!)} r={4}
                          fill={COLORS[i]} stroke="var(--surface-1)" strokeWidth="2"
                        />
                      ),
                    )}
                  </g>
                );
              })}

              {/* 線の右端の直接ラベル */}
              {endLabels.map((l) => (
                <text key={l.key} x={M.l + PW + 10} y={l.yy + 4} fontSize="11" fill="var(--text-secondary)" className="num">
                  {l.key}
                </text>
              ))}

              {/* ホバー：縦の十字線 */}
              {hover !== null && (
                <line x1={x(sizes[hover])} x2={x(sizes[hover])} y1={M.t} y2={M.t + PH} stroke="var(--text-muted)" strokeWidth="1" />
              )}
              <rect
                x={M.l} y={M.t} width={PW} height={PH} fill="transparent"
                onMouseMove={onMove} onMouseLeave={() => setHover(null)}
              />
            </svg>

            {hover !== null && (
              <div
                className="pointer-events-none absolute top-2 rounded-lg border border-border bg-surface-2/95 p-3 text-xs shadow-lg"
                style={{ left: `${Math.min((x(sizes[hover]) / W) * 100 + 2, 62)}%` }}
              >
                <p className="num mb-1.5 text-ink">{fmtUsd(sizes[hover])} order</p>
                {series.map((s, i) => {
                  const p = s.points[hover];
                  return (
                    <p key={s.key} className="flex items-center gap-2 text-ink-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />
                      <span className="num w-28">{s.key}</span>
                      <span className="num text-ink">
                        {p.price === null ? "no quote" : `$${p.price.toFixed(2)}`}
                        {p.overpayPct !== null && <span className="text-ink-3"> ({fmtPct(p.overpayPct)})</span>}
                      </span>
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Analysis r={r} />
    </section>
  );
}

function DataTable({ r }: { r: CurveResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-ink-3">
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-normal">Series</th>
            {r.sizes.map((s) => (
              <th key={s} className="num py-2 pr-4 text-right font-normal">{fmtUsd(s)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.series.map((s) => (
            <tr key={s.key} className="border-b border-border/60">
              <td className="num py-2 pr-4 text-ink-2">{s.key}</td>
              {s.points.map((p) => (
                <td key={p.amountUsdc} className="num py-2 pr-4 text-right">
                  {p.price === null ? "—" : `$${p.price.toFixed(2)}`}
                  <div className="text-ink-3">{p.overpayPct === null ? "" : fmtPct(p.overpayPct)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analysis({ r }: { r: CurveResult }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface-1 p-5">
        <h3 className="text-sm font-medium">Where Gateway starts to win</h3>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          {r.crossovers.map((c) => (
            <li key={c.token}>
              <span className="num text-ink">{c.token}</span> — {c.note}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-surface-1 p-5">
        <h3 className="text-sm font-medium">Linear fit p(Δ) = α + βΔ</h3>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-ink-3">
            <tr>
              <th className="pb-1.5 font-normal">Series</th>
              <th className="pb-1.5 text-right font-normal">α (price at Δ→0)</th>
              <th className="pb-1.5 text-right font-normal">Implied depth α/β</th>
              <th className="pb-1.5 text-right font-normal">R²</th>
            </tr>
          </thead>
          <tbody>
            {r.series.map((s) => (
              <tr key={s.key} className="border-t border-border/60">
                <td className="num py-1.5 text-ink-2">{s.key}</td>
                <td className="num py-1.5 text-right">{s.fit ? `$${s.fit.alpha.toFixed(2)}` : "—"}</td>
                <td className="num py-1.5 text-right">
                  {s.fit?.depthUsdc ? `$${Math.round(s.fit.depthUsdc).toLocaleString("en-US")}` : "flat"}
                </td>
                <td className="num py-1.5 text-right">{s.fit?.r2 != null ? s.fit.r2.toFixed(3) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="mt-3 text-xs text-ink-3">
          <summary className="cursor-pointer text-ink-2">Why a straight line?</summary>
          <p className="mt-2 leading-relaxed">
            In a constant-product pool (x·y = k) with USDC reserve Y, stock reserve X and fee factor γ, spending Δ USDC returns
            X·γΔ/(Y+γΔ) tokens, so the average price is (Y+γΔ)/(γX) = p₀/γ + Δ/X — exactly linear in Δ. The intercept α is the
            fee-inclusive marginal price and α/β ≈ Y/γ estimates how much USDC sits on the other side of the pool.
            Concentrated-liquidity pools (CLMM / DLMM) behave like a CPMM with virtual reserves inside the active range and
            steepen once the order leaves it, which shows up as a lower R². Gateway quotes stay flat (β ≈ 0) because they are
            not priced off a single pool.
          </p>
        </details>
      </div>
    </div>
  );
}

function niceTicks(min: number, max: number, count: number) {
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

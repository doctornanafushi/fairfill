import "server-only";
import type { Crossover, CurveResult, CurveSeries, LinearFit, Venue } from "@/lib/types";
import { quoteOne } from "./compare";
import { tokensForTicker } from "./gateway";
import { referencePrice } from "./reference";
import { median, memo } from "./util";

export const DEFAULT_SIZES = [10, 30, 100, 300, 1000, 3000, 10000];
const cache = memo<CurveResult>(60 * 1000);

/**
 * 実効価格 p(Δ) を直線 α + βΔ で当てはめる（最小二乗）。
 *
 * 定数積 AMM（x·y = k、USDC 側準備金 Y、株側準備金 X、手数料込み係数 γ）で Δ USDC 買うと
 *   受取量 = X·γΔ / (Y + γΔ)  →  実効価格 = Δ / 受取量 = (Y + γΔ)/(γX) = p0/γ + Δ/X
 * となり、Δ に対して厳密に一次式。よって
 *   α ≈ p0/γ（手数料込みの限界価格）、β ≈ 1/X、α/β ≈ Y/γ ≈ USDC 側の深さ。
 * 集中流動性（CLMM/DLMM）では価格帯の中だけ「仮想準備金」の CPMM として振る舞うため、
 * 小さい Δ では直線に乗り、帯を抜けると傾きが急になる（＝決定係数 R² の低下として現れる）。
 */
export function fitLinear(points: { x: number; y: number }[]): LinearFit | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return {
    alpha,
    beta,
    depthUsdc: beta > 0 ? alpha / beta : null,
    r2,
    used: n,
  };
}

export function curve(ticker: string, sizes = DEFAULT_SIZES): Promise<CurveResult> {
  return cache(`${ticker.toUpperCase()}:${sizes.join(",")}`, async () => {
    const { ticker: T, tokens } = await tokensForTicker(ticker);
    if (!tokens.length) throw new Error(`No tokenized stock for ${ticker.toUpperCase()} on Solana`);
    const venues: Venue[] = ["Jupiter", "Gateway"];

    const [ref, series] = await Promise.all([
      referencePrice(T),
      Promise.all(
        tokens.flatMap((token) =>
          venues.map(async (venue): Promise<CurveSeries> => {
            const pts = [];
            for (const amountUsdc of sizes) {
              const q = await quoteOne(token, venue, amountUsdc);
              const shares = q.qtyOut ? q.qtyOut * token.multiplier : null; // 株数に換算
              pts.push({ amountUsdc, price: shares ? amountUsdc / shares : null, overpayPct: null as number | null });
            }
            return { key: `${token.symbol}·${venue}`, token, venue, points: pts, fit: null };
          }),
        ),
      ),
    ]);

    // 基準：オラクル、なければ「最小金額での見積もり」の中央値
    let reference = ref;
    if (!reference) {
      const small = series.map((s) => s.points[0]?.price).filter((p): p is number => !!p);
      if (small.length >= 3) reference = { price: median(small), source: "median", label: "Median of smallest quotes (provisional)", ageSec: null, stale: false };
    }

    for (const s of series) {
      for (const p of s.points) p.overpayPct = reference && p.price ? (p.price / reference.price - 1) * 100 : null;
      // 壊れた見積もり（基準の 1.5 倍超）は当てはめから外す
      const usable = s.points
        .filter((p) => p.price !== null && (!reference || p.price! < reference.price * 1.5))
        .map((p) => ({ x: p.amountUsdc, y: p.price! }));
      s.fit = fitLinear(usable);
    }

    // トークンごとに Jupiter の直線と Gateway の直線の交点＝損益分岐の金額
    const crossovers: Crossover[] = tokens.map((t) => {
      const j = series.find((s) => s.token.symbol === t.symbol && s.venue === "Jupiter")?.fit;
      const g = series.find((s) => s.token.symbol === t.symbol && s.venue === "Gateway")?.fit;
      if (!j || !g) return { token: t.symbol, breakEvenUsdc: null, note: "Not enough quotes to compare" };
      // 直線 j(Δ)=αj+βjΔ と g(Δ)=αg+βgΔ。g < j の範囲で Gateway が安い
      const maxSize = sizes[sizes.length - 1];
      const fmt = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
      if (g.alpha <= j.alpha && g.beta <= j.beta)
        return { token: t.symbol, breakEvenUsdc: 0, note: "Gateway is cheaper at every size" };
      if (g.alpha >= j.alpha && g.beta >= j.beta)
        return { token: t.symbol, breakEvenUsdc: null, note: "The AMM is cheaper at every tested size" };
      const x = (g.alpha - j.alpha) / (j.beta - g.beta);
      const extrapolated = x > maxSize ? " (extrapolated beyond tested sizes)" : "";
      return g.alpha > j.alpha
        ? { token: t.symbol, breakEvenUsdc: x, note: `Above ≈ ${fmt(x)}, Gateway beats the AMM${extrapolated}` }
        : { token: t.symbol, breakEvenUsdc: x, note: `Below ≈ ${fmt(x)}, Gateway beats the AMM${extrapolated}` };
    });

    return { ticker: T, reference, sizes, series, crossovers, fetchedAt: new Date().toISOString() };
  });
}

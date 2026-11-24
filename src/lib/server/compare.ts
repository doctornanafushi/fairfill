import "server-only";
import type { CompareResult, QuoteOption, Reference, TokenInfo, Venue, Verdict } from "@/lib/types";
import { gatewayBuyQuote, tokensForTicker } from "./gateway";
import { jupiterBuyQuote } from "./jupiter";
import { referencePrice } from "./reference";
import { median } from "./util";

export const WARN_PCT = Number(process.env.WARN_PCT ?? 2);
export const DANGER_PCT = Number(process.env.DANGER_PCT ?? 10);

export function verdictOf(overpayPct: number | null): Verdict {
  if (overpayPct === null || !isFinite(overpayPct)) return "unknown";
  if (overpayPct >= DANGER_PCT) return "danger";
  if (overpayPct >= WARN_PCT) return "caution";
  return "good";
}

/** 1つのトークン・取引場所・金額の見積もり */
export async function quoteOne(token: TokenInfo, venue: Venue, amountUsdc: number) {
  if (venue === "Jupiter") {
    const q = await jupiterBuyQuote(token, amountUsdc);
    return { qtyOut: q.qtyOut, route: q.route, error: q.error };
  }
  const q = await gatewayBuyQuote(token, amountUsdc);
  return { qtyOut: q.qtyOut, route: "True Markets Gateway", error: q.error };
}

/**
 * 見積もりの価格に払いすぎ率と判定を付ける。
 * 基準価格が取れないときは、見積もりの中央値を暫定基準にする（3件以上あるときだけ）。
 */
export function scoreOptions(
  raw: Omit<QuoteOption, "overpayPct" | "verdict">[],
  ref: Reference | null,
): { options: QuoteOption[]; reference: Reference | null } {
  let reference = ref;
  if (!reference) {
    const ps = raw.map((r) => r.price).filter((p): p is number => p !== null && isFinite(p));
    if (ps.length >= 3) {
      reference = { price: median(ps), source: "median", label: "Median of quotes (provisional)", ageSec: null, stale: false };
    }
  }
  const options = raw.map((r) => {
    const overpayPct = reference && r.price !== null ? (r.price / reference.price - 1) * 100 : null;
    return { ...r, overpayPct, verdict: verdictOf(overpayPct) };
  });
  return { options, reference };
}

export async function compare(ticker: string, amountUsdc: number): Promise<CompareResult> {
  const { ticker: T, tokens } = await tokensForTicker(ticker);
  if (!tokens.length) throw new Error(`No tokenized stock for ${ticker.toUpperCase()} on Solana`);

  const venues: Venue[] = ["Jupiter", "Gateway"];
  const [ref, raw] = await Promise.all([
    referencePrice(T),
    Promise.all(
      tokens.flatMap((token) =>
        venues.map(async (venue) => {
          const q = await quoteOne(token, venue, amountUsdc);
          const shares = q.qtyOut ? q.qtyOut * token.multiplier : null; // 生の数量 × 倍率 = 株数
          return {
            token,
            venue,
            amountUsdc,
            qtyOut: q.qtyOut,
            shares,
            price: shares ? amountUsdc / shares : null, // 1株あたり
            route: q.route,
            error: q.error,
          };
        }),
      ),
    ),
  ]);

  const { options, reference } = scoreOptions(raw, ref);

  // 推奨：危険でないもののうち最安（基準がなければ単純に最安）
  const priced = options.filter((o) => o.price !== null);
  const eligible = priced.filter((o) => o.verdict !== "danger").sort((a, b) => a.price! - b.price!);
  const best = eligible[0] ?? null;
  const worst = [...priced].sort((a, b) => b.price! - a.price!)[0] ?? null;
  const savedVsWorstUsd =
    best && worst && worst !== best ? amountUsdc * (1 - best.price! / worst.price!) : null;

  const warnings: string[] = [];
  for (const o of options.filter((o) => o.verdict === "danger")) {
    warnings.push(
      `${o.token.symbol} via ${o.venue} is ${o.overpayPct!.toFixed(1)}% above the reference price — likely thin or broken liquidity.`,
    );
  }
  if (!best && priced.length) warnings.push("Every quote is far from the reference price. Consider not buying right now.");
  if (reference?.stale) warnings.push("The reference price is stale (US market closed?). Tokenized stocks still trade 24/7, so compare with care.");
  if (reference?.source === "median") warnings.push("No oracle price available — using the median of quotes as a provisional reference.");

  return {
    ticker: T,
    amountUsdc,
    reference,
    options,
    best,
    savedVsWorstUsd,
    warnings,
    thresholds: { warnPct: WARN_PCT, dangerPct: DANGER_PCT },
    fetchedAt: new Date().toISOString(),
  };
}

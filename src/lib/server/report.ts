import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CompareResult, ExecutionReport, TokenInfo } from "@/lib/types";
import { DANGER_PCT } from "./compare";

const mac = (s: string) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", `report:${secret}`).update(s).digest("base64url");
};

/** 購入直前のスナップショット（compare の結果）と実際の約定からレポートを作る */
export function buildReport(input: {
  snapshot: CompareResult;
  token: TokenInfo;
  orderId: string;
  status: string;
  qtyOut: number;
  pricePerShare: number;
  wallet: string;
  gatewayWallet: string | null;
}): ExecutionReport {
  const { snapshot, token, pricePerShare } = input;
  const ref = snapshot.reference;
  const fillVsReferencePct = ref ? (pricePerShare / ref.price - 1) * 100 : null;

  // 執行した選択肢は、スナップショットの値ではなく実際の約定価格で置き換える
  const options = snapshot.options
    .map((o) => {
      const executed = o.token.symbol === token.symbol && o.venue === "Gateway";
      const price = executed ? pricePerShare : o.price;
      return {
        symbol: o.token.symbol,
        issuer: o.token.issuer,
        venue: o.venue,
        pricePerShare: price,
        overpayPct: executed ? fillVsReferencePct : o.overpayPct,
        verdict: o.verdict,
        executed,
      };
    })
    .sort((a, b) => (a.pricePerShare ?? Infinity) - (b.pricePerShare ?? Infinity));

  const others = options.filter((o) => !o.executed && o.pricePerShare !== null);
  const worstOpt = [...others].sort((a, b) => b.pricePerShare! - a.pricePerShare!)[0] ?? null;
  const nextBestOpt = others[0] ?? null;

  const worst = worstOpt ? { symbol: worstOpt.symbol, venue: worstOpt.venue, pricePerShare: worstOpt.pricePerShare! } : null;
  const nextBest = nextBestOpt
    ? { symbol: nextBestOpt.symbol, venue: nextBestOpt.venue, pricePerShare: nextBestOpt.pricePerShare! }
    : null;

  // 同じ金額で、最悪の選択肢だと何株しか買えなかったか → 得した金額と割合
  const savedVsWorstPct = worst && worst.pricePerShare > pricePerShare ? (1 - pricePerShare / worst.pricePerShare) * 100 : worst ? 0 : null;
  const savedVsWorstUsd = savedVsWorstPct !== null ? (input.snapshot.amountUsdc * savedVsWorstPct) / 100 : null;
  const diffVsNextBestPct = nextBest ? (nextBest.pricePerShare / pricePerShare - 1) * 100 : null;

  return {
    version: 1,
    orderId: input.orderId,
    status: input.status,
    executedAt: new Date().toISOString(),
    wallet: input.wallet,
    gatewayWallet: input.gatewayWallet,
    ticker: snapshot.ticker,
    token: { symbol: token.symbol, issuer: token.issuer, multiplier: token.multiplier },
    venue: "Gateway",
    amountUsdc: snapshot.amountUsdc,
    tokensReceived: input.qtyOut,
    sharesReceived: input.qtyOut * token.multiplier,
    fillPricePerShare: pricePerShare,
    reference: ref ? { price: ref.price, label: ref.label, stale: ref.stale } : null,
    fillVsReferencePct,
    guard: { checked: true, thresholdPct: DANGER_PCT },
    options,
    worst,
    savedVsWorstUsd,
    savedVsWorstPct,
    nextBest,
    diffVsNextBestPct,
  };
}

/** 共有リンク用：レポートを base64url にして HMAC で署名（改ざんされていないかを後で確かめられる） */
export function signReport(r: ExecutionReport): string {
  const body = Buffer.from(JSON.stringify(r)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verifyReport(token: string): { report: ExecutionReport; verified: boolean } | null {
  const [body, sig] = token.split(".");
  if (!body) return null;
  let report: ExecutionReport;
  try {
    report = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  let verified = false;
  try {
    const a = Buffer.from(mac(body));
    const b = Buffer.from(sig ?? "");
    verified = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    verified = false;
  }
  return { report, verified };
}

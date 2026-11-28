import type { NextRequest } from "next/server";
import { restrictedRegion, unauthorized, walletFrom } from "@/lib/server/auth";
import { compare } from "@/lib/server/compare";
import { tokensForTicker } from "@/lib/server/gateway";
import { buildReport, signReport } from "@/lib/server/report";
import { buyWithGateway, ensureUser } from "@/lib/server/trading";

export const maxDuration = 60;

// Gateway で買う。執行直前に見積もりを基準価格と照合し、外れていれば署名せずに止める
export async function POST(req: NextRequest) {
  const wallet = walletFrom(req);
  if (!wallet) return unauthorized();
  const blocked = restrictedRegion(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; symbol?: string; amount?: number };
  const amount = Number(body.amount);
  if (!body.ticker || !body.symbol || !(amount > 0) || amount > 10_000)
    return Response.json({ error: "ticker, symbol and amount (≤ 10,000) are required" }, { status: 400 });
  try {
    const { ticker, tokens } = await tokensForTicker(body.ticker);
    const token = tokens.find((t) => t.symbol === body.symbol);
    if (!token) return Response.json({ error: `${body.symbol} is not a token for ${ticker}` }, { status: 400 });
    const user = await ensureUser(wallet);
    // 執行の直前に、同じ金額での全選択肢を取っておく（最良執行レポート用）
    const snapshot = await compare(ticker, amount);
    const result = await buyWithGateway(user.userId, token, ticker, amount);
    const report = buildReport({
      snapshot,
      token,
      orderId: result.orderId,
      status: result.status,
      qtyOut: result.qtyOut,
      pricePerShare: result.pricePerShare,
      wallet,
      gatewayWallet: user.solanaAddress,
    });
    return Response.json({ ...result, report, reportToken: signReport(report) });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 400 });
  }
}

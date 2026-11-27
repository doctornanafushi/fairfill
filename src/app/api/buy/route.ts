import type { NextRequest } from "next/server";
import { restrictedRegion, unauthorized, walletFrom } from "@/lib/server/auth";
import { tokensForTicker } from "@/lib/server/gateway";
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
    const result = await buyWithGateway(user.userId, token, ticker, amount);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 400 });
  }
}

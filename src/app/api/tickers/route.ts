import { connection } from "next/server";
import { solanaStockTokens } from "@/lib/server/gateway";

// 入力補完用：ティッカー → 会社名とトークン一覧
export async function GET() {
  await connection();
  try {
    const tokens = await solanaStockTokens();
    const byTicker = new Map<string, { ticker: string; name: string; tokens: string[] }>();
    for (const t of tokens) {
      const e = byTicker.get(t.ticker) ?? { ticker: t.ticker, name: t.name.replace(/ xStock$/i, ""), tokens: [] };
      e.tokens.push(t.symbol);
      byTicker.set(t.ticker, e);
    }
    const list = [...byTicker.values()].sort((a, b) => b.tokens.length - a.tokens.length || a.ticker.localeCompare(b.ticker));
    return Response.json({ tickers: list });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

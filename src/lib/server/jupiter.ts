import "server-only";
import type { TokenInfo } from "@/lib/types";
import { USDC_MINT } from "./gateway";
import { rateLimiter } from "./util";

// lite-api は無料・キー不要。レート制限に引っかからないよう間隔を空ける
const limit = rateLimiter(400, 2);

export async function jupiterBuyQuote(token: TokenInfo, amountUsdc: number) {
  return limit(async () => {
    const url =
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${token.mint}` +
      `&amount=${Math.round(amountUsdc * 1e6)}&slippageBps=50`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || !j.outAmount) return { qtyOut: null, route: "", error: "no route" };
      const route = (j.routePlan ?? [])
        .map((r: any) => r.swapInfo?.label)
        .filter(Boolean)
        .join(" → ");
      return { qtyOut: Number(j.outAmount) / 10 ** token.decimals, route, error: undefined };
    }
    return { qtyOut: null, route: "", error: "rate limited" };
  });
}

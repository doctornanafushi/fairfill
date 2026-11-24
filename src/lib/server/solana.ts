import "server-only";
import { memo } from "./util";

/**
 * トークン化株のミント（Token-2022）から「1トークン = 何株か」の倍率を読む。
 *
 * xStocks も Ondo も ScaledUiAmount 拡張を使っていて、
 *   multiplier                       … 現在の倍率
 *   newMultiplier                    … 次の倍率
 *   newMultiplierEffectiveTimestamp  … 次の倍率に切り替わる時刻（過ぎていれば newMultiplier が有効）
 * を持つ。配当の再投資で少しずつ増え（PGx ≈ 1.026）、株式分割では一気に変わる（NFLXx = 10）。
 * Jupiter / Gateway が返す数量は生の数量なので、株数 = 数量 × 倍率。
 */
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const cache = memo<Map<string, number>>(10 * 60 * 1000);

type ScaledConfig = { multiplier: string; newMultiplier: string; newMultiplierEffectiveTimestamp: number };

export function effectiveMultiplier(c: ScaledConfig, nowSec = Date.now() / 1000): number {
  const m = Number(c.multiplier);
  const next = Number(c.newMultiplier);
  const at = Number(c.newMultiplierEffectiveTimestamp);
  const v = at && nowSec >= at ? next : m;
  return isFinite(v) && v > 0 ? v : 1;
}

export function getMultipliers(mints: string[]): Promise<Map<string, number>> {
  const key = [...mints].sort().join(",");
  return cache(key, async () => {
    const out = new Map<string, number>(mints.map((m) => [m, 1]));
    for (let i = 0; i < mints.length; i += 100) {
      const batch = mints.slice(i, i + 100);
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getMultipleAccounts",
          params: [batch, { encoding: "jsonParsed" }],
        }),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as any;
      const values: any[] = j?.result?.value ?? [];
      values.forEach((acc, k) => {
        const ext = (acc?.data?.parsed?.info?.extensions ?? []).find(
          (e: any) => e.extension === "scaledUiAmountConfig",
        );
        if (ext?.state) out.set(batch[k], effectiveMultiplier(ext.state));
      });
    }
    return out;
  });
}

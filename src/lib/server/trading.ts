import "server-only";
import type { TokenInfo } from "@/lib/types";
import { DANGER_PCT } from "./compare";
import { gatewayFetch, organizationId, USDC_MINT } from "./gateway";
import { referencePrice } from "./reference";
import { signerPublicKey, stamp } from "./signer";
import { memo, sleep } from "./util";

// ---------- ユーザー（ウォレットのアドレス = external_ref_id） ----------
export type GatewayUser = { userId: string; solanaAddress: string | null; raw: unknown };
const userCache = memo<GatewayUser>(60 * 60 * 1000);

/** 同じ external_ref_id なら同じユーザーが返る（冪等）。503 はウォレット準備中なので再送 */
export function ensureUser(walletPk: string): Promise<GatewayUser> {
  return userCache(walletPk, async () => {
    const org = await organizationId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { status, json } = await gatewayFetch(`/v1/account/organizations/${org}/users`, {
        method: "POST",
        body: { external_ref_id: walletPk, signer_public_key: signerPublicKey() },
      });
      if (status === 503) {
        await sleep(1500);
        continue;
      }
      const userId = json?.user_id ?? json?.id ?? json?.user?.id;
      if (!userId) throw new Error(`Create user failed: HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`);
      let solanaAddress = findSolanaAddress(json);
      let raw: unknown = json;
      // 作成時のレスポンスにアドレスがなければ、ユーザーを読み直して探す
      if (!solanaAddress) {
        const got = await gatewayFetch(`/v1/account/organizations/${org}/users/${userId}`, {});
        solanaAddress = findSolanaAddress(got.json);
        raw = { create: json, get: got.json, getStatus: got.status };
      }
      return { userId, solanaAddress, raw };
    }
    throw new Error("Gateway wallets are not ready yet (503). Try again in a moment.");
  });
}

/** レスポンスのどこかにある Solana ウォレットのアドレスを探す（形が変わっても拾えるように） */
function findSolanaAddress(o: any): string | null {
  if (!o || typeof o !== "object") return null;
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = findSolanaAddress(v);
      if (r) return r;
    }
    return null;
  }
  // 実際のレスポンス: wallets: [{ address, chain_family: "evm" | "solana" }]
  const chain = String(o.chain_family ?? o.chain ?? o.network ?? o.type ?? "").toLowerCase();
  if (chain.includes("solana") && typeof o.address === "string") return o.address;
  for (const [k, v] of Object.entries(o)) {
    if (/solana/i.test(k) && typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return v;
    if (typeof v === "object") {
      const r = findSolanaAddress(v);
      if (r) return r;
    }
  }
  return null;
}

// ---------- 残高 ----------
export type Balance = { symbol: string; amount: number; chain: string; mint?: string };

export async function balances(userId: string): Promise<{ list: Balance[]; usdc: number; raw: unknown }> {
  const { json } = await gatewayFetch("/v1/gateway/balances", { onBehalfOf: userId });
  const rows: any[] = Array.isArray(json) ? json : json?.balances ?? json?.items ?? [];
  const list: Balance[] = rows
    .map((b) => ({
      symbol: String(b.symbol ?? b.asset?.symbol ?? b.asset_symbol ?? "?"),
      amount: Number(b.amount ?? b.balance ?? b.qty ?? b.available ?? 0),
      chain: String(b.chain ?? b.asset?.chain ?? ""),
      mint: b.address ?? b.asset?.address ?? b.mint,
    }))
    .filter((b) => b.amount > 0);
  const usdc = list
    .filter((b) => b.symbol.toUpperCase() === "USDC" && (!b.chain || b.chain === "solana" || b.mint === USDC_MINT))
    .reduce((s, b) => s + b.amount, 0);
  return { list, usdc, raw: json };
}

// ---------- 購入（執行の直前に、もう一度見積もりを検証する） ----------
export type BuyResult = {
  orderId: string;
  status: string;
  qtyOut: number;
  pricePerShare: number;
  overpayPct: number | null;
  raw: unknown;
};

export async function buyWithGateway(userId: string, token: TokenInfo, ticker: string, amountUsdc: number): Promise<BuyResult> {
  // 1) 注文を作る（ここで見積もりと未署名ペイロードが返る）
  const { status, json } = await gatewayFetch("/v1/gateway/orders", {
    method: "POST",
    onBehalfOf: userId,
    body: { asset_id: token.assetId, qty: String(amountUsdc), qty_unit: "quote", side: "buy", type: "market" },
  });
  const orderId: string | undefined = json?.order_id || json?.id;
  const quote = json?.quote ?? {};
  if (!orderId) {
    const issues = (quote.issues ?? []).join(", ");
    throw new Error(issues ? `Gateway refused the order: ${issues}` : `Create order failed: HTTP ${status}`);
  }

  // 2) ガード：この見積もりが基準価格から大きく外れていたら、署名せずに止める
  const qtyOut = Number(quote.qty_out);
  const pricePerShare = amountUsdc / (qtyOut * token.multiplier);
  const ref = await referencePrice(ticker);
  const overpayPct = ref ? (pricePerShare / ref.price - 1) * 100 : null;
  if (!qtyOut || (overpayPct !== null && overpayPct >= DANGER_PCT)) {
    throw new Error(
      `Blocked by FairFill: this quote is ${overpayPct?.toFixed(1)}% above the reference price. Nothing was signed or executed.`,
    );
  }

  // 3) 未署名ペイロードを署名鍵でスタンプ → 執行
  const payloads: unknown[] = json?.payloads ?? [];
  const signatures = await Promise.all(
    payloads.map((p: any) => stamp(typeof p === "string" ? p : p?.payload ?? p?.unsigned_payload ?? JSON.stringify(p))),
  );
  const exec = await gatewayFetch(`/v1/gateway/orders/${orderId}/execute`, {
    method: "POST",
    onBehalfOf: userId,
    body: { signatures, auth_type: "api_key" },
  });
  if (exec.status >= 400) {
    const code = exec.json?.code ?? exec.json?.message ?? "";
    throw new Error(code === "quote_stale" ? "The quote expired. Please try again." : `Execute failed: HTTP ${exec.status} ${code}`);
  }

  // 4) 確定まで待つ（クロスチェーンだと pending が続くことがある）
  let final: any = exec.json;
  for (let i = 0; i < 20; i++) {
    const st = String(final?.status ?? "").toLowerCase();
    if (["complete", "completed", "filled", "failed", "rejected", "cancelled", "canceled"].includes(st)) break;
    await sleep(1500);
    final = (await gatewayFetch(`/v1/gateway/orders/${orderId}`, { onBehalfOf: userId })).json;
  }
  return { orderId, status: String(final?.status ?? "submitted"), qtyOut, pricePerShare, overpayPct, raw: final };
}

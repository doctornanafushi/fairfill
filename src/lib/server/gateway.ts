import "server-only";
import { readFileSync } from "node:fs";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { TokenInfo } from "@/lib/types";
import { memo, rateLimiter } from "./util";

const API = "https://api.truemarkets.co";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ---------- 組織 API キー ----------
// Vercel では TM_API_KEY_JSON（ファイルの中身そのもの）、手元では TM_KEY_FILE（パス）
type ApiKey = { key_id: string; private_key: import("node:crypto").JsonWebKey };
let apiKey: { id: string; key: KeyObject } | null = null;

function loadApiKey() {
  if (apiKey) return apiKey;
  const raw =
    process.env.TM_API_KEY_JSON ??
    (process.env.TM_KEY_FILE ? readFileSync(process.env.TM_KEY_FILE, "utf8") : null);
  if (!raw) throw new Error("TM_API_KEY_JSON または TM_KEY_FILE が設定されていません");
  const parsed = JSON.parse(raw) as ApiKey;
  apiKey = { id: parsed.key_id, key: createPrivateKey({ key: parsed.private_key, format: "jwk" }) };
  return apiKey;
}

// ---------- 組織トークン（1時間有効・リフレッシュなし → 55分で作り直す） ----------
let token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (token && Date.now() < token.exp) return token.value;
  const { id, key } = loadApiKey();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign("sha256", Buffer.from(`${id}.${timestamp}`), {
    key,
    dsaEncoding: "ieee-p1363", // r||s の 64 バイト
  }).toString("base64url");
  const res = await fetch(`${API}/v1/auth/api-key/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_id: id, timestamp, signature }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  const value = j.token ?? j.access_token ?? j.data?.token ?? j.data?.access_token;
  if (!res.ok || !value) throw new Error(`Gateway token ${res.status}`);
  token = { value, exp: Date.now() + 55 * 60 * 1000 };
  return value;
}

const limit = rateLimiter(250, 2);

export async function gatewayFetch(
  path: string,
  init: { method?: string; body?: unknown; onBehalfOf?: string } = {},
) {
  return limit(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getToken()}`,
      };
      if (init.onBehalfOf) headers["TM-On-Behalf-Of"] = init.onBehalfOf;
      const res = await fetch(`${API}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("X-RateLimit-Reset") ?? 1);
        await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
        continue;
      }
      if (res.status === 401) token = null; // トークン切れ → 次で作り直す
      const json = (await res.json().catch(() => ({}))) as any;
      return { status: res.status, json: json?.data ?? json };
    }
    return { status: 429, json: { message: "rate limited" } };
  });
}

// ---------- 資産一覧（10分キャッシュ） ----------
const assetsCache = memo<any[]>(10 * 60 * 1000);

export function getAssets(): Promise<any[]> {
  return assetsCache("assets", async () => {
    const res = await fetch(`${API}/v1/gateway/assets`, { cache: "no-store" });
    const j = (await res.json()) as { data: any[] };
    return j.data;
  });
}

/** トークン化株 → 元の株のティッカー（NVDAX → NVDA, AAPLON → AAPL, BRK.BX → BRK.B） */
export function underlyingTicker(a: { symbol?: string; issuer?: string }): string {
  const s = String(a.symbol ?? "").toUpperCase();
  if (a.issuer === "xstocks" && s.endsWith("X")) return s.slice(0, -1);
  if (a.issuer === "ondo" && s.endsWith("ON")) return s.slice(0, -2);
  if (a.issuer === "coinbase" && s.endsWith("C")) return s.slice(0, -1);
  return s;
}

export async function solanaStockTokens(): Promise<(TokenInfo & { ticker: string })[]> {
  const assets = await getAssets();
  return assets
    .filter((a) => a.chain === "solana" && a.asset_class === "stock" && a.address && a.tradeable !== false)
    .map((a) => ({
      ticker: underlyingTicker(a),
      symbol: String(a.symbol),
      issuer: String(a.issuer ?? "-"),
      assetId: String(a.id),
      mint: String(a.address),
      decimals: Number(a.decimals ?? 8),
      name: String(a.name ?? ""),
    }));
}

export async function tokensForTicker(ticker: string) {
  const t = ticker.toUpperCase();
  return (await solanaStockTokens()).filter((x) => x.ticker === t);
}

// ---------- 見積もり（注文を作るだけ。execute しないので資金は動かない） ----------
export async function gatewayBuyQuote(token: TokenInfo, amountUsdc: number) {
  const userId = process.env.TM_QUOTE_USER_ID;
  if (!userId) throw new Error("TM_QUOTE_USER_ID が設定されていません");
  const { status, json } = await gatewayFetch("/v1/gateway/orders", {
    method: "POST",
    onBehalfOf: userId,
    body: { asset_id: token.assetId, qty: String(amountUsdc), qty_unit: "quote", side: "buy", type: "market" },
  });
  const out = Number(json?.quote?.qty_out);
  if (!out) return { qtyOut: null, error: `Gateway ${status}` };
  return { qtyOut: out, error: undefined };
}

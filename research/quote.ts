// quote.ts — Gateway の見積もりだけを取る（execute しないので資金は動かない）
//
//   TM_KEY_FILE=~/.truemarkets/api-key.json npx tsx quote.ts NVDAx 10 100 1000 10000
//
//   引数1: 銘柄シンボル（大文字小文字は区別しない）  省略時 NVDAx
//   引数2以降: 注文額（USDC）                      省略時 10 100 1000 10000
//   環境変数 TM_CHAIN で対象チェーンを変更（省略時 solana）
//
// 注文作成 (POST /v1/gateway/orders) は見積もりと未署名ペイロードを返すだけで、
// /execute を呼ばない限り何も動かない。残高不足のときは order_id が空で quote.issues に理由が入る。
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const API = "https://api.truemarkets.co";
// quickstart で作ったユーザー。別ユーザーを使うなら TM_USER_ID で上書き
const USER_ID = process.env.TM_USER_ID ?? "24d9ab10-88fc-4ae8-82c6-8fc2c41e0921";
const CHAIN = process.env.TM_CHAIN ?? "solana";

const [symbolArg = "NVDAx", ...sizeArgs] = process.argv.slice(2);
const SIZES = sizeArgs.length ? sizeArgs : ["10", "100", "1000", "10000"];

const KEY_FILE = process.env.TM_KEY_FILE;
if (!KEY_FILE) {
  console.error("✗ TM_KEY_FILE が設定されていません");
  process.exit(1);
}
const apiKey = JSON.parse(readFileSync(KEY_FILE, "utf8"));
const privateKey = createPrivateKey({ key: apiKey.private_key, format: "jwk" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 組織トークンの発行（{key_id}.{timestamp} を ES256 で署名、r||s を base64url） ----
async function mintToken(): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign("sha256", Buffer.from(`${apiKey.key_id}.${timestamp}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363", // r と s をそのまま連結した 64 バイト
  }).toString("base64url");

  const res = await fetch(`${API}/v1/auth/api-key/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_id: apiKey.key_id, timestamp, signature }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ token ${res.status}`, JSON.stringify(json));
    console.error("  → quickstart.ts のトークン発行部分と送っている項目名を見比べてください");
    process.exit(1);
  }
  const token =
    json.token ?? json.access_token ?? json.data?.token ?? json.data?.access_token;
  if (!token) {
    console.error("✗ レスポンスにトークンが見つかりません。キー一覧:", Object.keys(json));
    process.exit(1);
  }
  return token;
}

// ---- 資産の検索 ----
async function findAsset(symbol: string) {
  const res = await fetch(`${API}/v1/gateway/assets`);
  const { data } = (await res.json()) as { data: any[] };
  const want = symbol.toLowerCase();
  const hit = data.find(
    (a) => a.chain === CHAIN && String(a.symbol ?? "").toLowerCase() === want,
  );
  if (!hit) {
    const near = data
      .filter((a) => String(a.symbol ?? "").toLowerCase().includes(want.replace(/x$/, "")))
      .map((a) => `${a.chain}:${a.symbol}`);
    console.error(`✗ ${CHAIN} 上に ${symbol} が見つかりません。近い候補: ${near.join(", ") || "なし"}`);
    process.exit(1);
  }
  return hit;
}

// ---- 見積もり（注文を作るだけ。execute はしない） ----
async function quote(token: string, assetId: string, usdc: string) {
  const res = await fetch(`${API}/v1/gateway/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "TM-On-Behalf-Of": USER_ID,
    },
    body: JSON.stringify({
      asset_id: assetId,
      qty: usdc,
      qty_unit: "quote", // USDC 建ての金額で指定
      side: "buy",
      type: "market",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const asset = await findAsset(symbolArg);
  console.log(`✓ asset   ${asset.symbol} (${asset.name})  ${asset.chain}  id=${asset.id}`);

  const token = await mintToken();
  console.log("✓ token");

  const results: any[] = [];
  for (const size of SIZES) {
    const { status, json } = await quote(token, asset.id, size);
    const body = json.data ?? json;
    const q = body.quote ?? {};
    console.log(`\n── ${size} USDC  → HTTP ${status}`);
    console.log(`   order_id : ${body.order_id || "(空：残高不足など。見積もりだけ返っている)"}`);
    console.log(`   payloads : ${Array.isArray(body.payloads) ? body.payloads.length : "-"}`);
    console.log(`   quote    : ${JSON.stringify(q, null, 2).replace(/\n/g, "\n              ")}`);
    if (status >= 400) console.log(`   error    : ${JSON.stringify(json)}`);
    results.push({ size_usdc: size, status, response: json });
    await sleep(1500); // レート制限よけ
  }

  // 生のレスポンスを保存（あとで AMM の見積もりと比べるため）
  const out = `quotes-${asset.symbol}-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ asset, user_id: USER_ID, results }, null, 2));
  console.log(`\n✓ 生データを ${out} に保存しました`);
  console.log("  ※ order_id が付いた注文も execute していないので、見積もりの期限（約2分）で失効します");
}

main().catch((e) => {
  console.error("✗", e?.message ?? e);
  process.exit(1);
});

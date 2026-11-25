import "server-only";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import bs58 from "bs58";

/**
 * Sign-In With Solana（簡易版）
 *  1. サーバーが HMAC 付きのノンスを発行（DB 不要のステートレス）
 *  2. ウォレットがログイン用メッセージに ed25519 で署名
 *  3. サーバーが署名を検証し、HMAC 付きのセッション Cookie を発行
 */
const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET (32+ chars) is not set");
  return s;
};
const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_SEC = 12 * 60 * 60;
export const COOKIE = "ff_session";

const mac = (s: string) => createHmac("sha256", SECRET()).update(s).digest("base64url");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function issueNonce(): string {
  const body = `${randomBytes(16).toString("base64url")}.${Date.now()}`;
  return `${body}.${mac(body)}`;
}

function checkNonce(nonce: string): boolean {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  return safeEq(mac(body), parts[2]) && Date.now() - Number(parts[1]) < NONCE_TTL_MS;
}

export function loginMessage(publicKey: string, nonce: string, issuedAt: string) {
  return [
    "Sign in to FairFill",
    "",
    `Wallet: ${publicKey}`,
    "",
    "Signing proves you own this wallet. It does not send a transaction or cost any fees.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

// 生の 32 バイト ed25519 公開鍵を SPKI(DER) に包んで node:crypto で検証する
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyLogin(input: { publicKey: string; message: string; signature: string }): boolean {
  const pk = Buffer.from(bs58.decode(input.publicKey));
  if (pk.length !== 32) return false;
  // メッセージの中身がこちらの形式どおりで、ノンスが本物かつ新しいことを確認
  const nonce = /Nonce: (\S+)/.exec(input.message)?.[1];
  const issuedAt = /Issued At: (\S+)/.exec(input.message)?.[1];
  if (!nonce || !issuedAt || !checkNonce(nonce)) return false;
  if (input.message !== loginMessage(input.publicKey, nonce, issuedAt)) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pk]), format: "der", type: "spki" });
  return verify(null, Buffer.from(input.message, "utf8"), key, Buffer.from(input.signature, "base64"));
}

export function createSession(publicKey: string): string {
  const body = Buffer.from(JSON.stringify({ pk: publicKey, exp: Date.now() + SESSION_TTL_SEC * 1000 })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readSession(value: string | undefined): { pk: string } | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig || !safeEq(mac(body), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as { pk: string; exp: number };
    return Date.now() < s.exp ? { pk: s.pk } : null;
  } catch {
    return null;
  }
}

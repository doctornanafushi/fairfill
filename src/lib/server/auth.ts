import "server-only";
import type { NextRequest } from "next/server";
import { COOKIE, readSession } from "./session";

/** リクエストの Cookie からログイン中のウォレットを取り出す（なければ null） */
export function walletFrom(req: NextRequest): string | null {
  return readSession(req.cookies.get(COOKIE)?.value)?.pk ?? null;
}

export const unauthorized = () => Response.json({ error: "Connect and sign in with your wallet first" }, { status: 401 });

// トークン化株は米国・英国の居住者には提供されていない（True Markets の制限）。
// Vercel が付けるアクセス元の国コードを見て、入金と購入を止める
const RESTRICTED = new Set(["US", "GB"]);
export function restrictedRegion(req: NextRequest): Response | null {
  const country = req.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (country && RESTRICTED.has(country))
    return Response.json(
      { error: "Tokenized stocks are not available to users in the United States or the United Kingdom." },
      { status: 451 },
    );
  return null;
}

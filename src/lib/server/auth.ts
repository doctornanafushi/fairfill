import "server-only";
import type { NextRequest } from "next/server";
import { COOKIE, readSession } from "./session";

/** リクエストの Cookie からログイン中のウォレットを取り出す（なければ null） */
export function walletFrom(req: NextRequest): string | null {
  return readSession(req.cookies.get(COOKIE)?.value)?.pk ?? null;
}

export const unauthorized = () => Response.json({ error: "Connect and sign in with your wallet first" }, { status: 401 });

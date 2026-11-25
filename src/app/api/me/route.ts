import type { NextRequest } from "next/server";
import { unauthorized, walletFrom } from "@/lib/server/auth";
import { balances, ensureUser } from "@/lib/server/trading";

// ログイン中のウォレットに対応する Gateway ユーザー（入金先アドレス）と残高
export async function GET(req: NextRequest) {
  const wallet = walletFrom(req);
  if (!wallet) return unauthorized();
  try {
    const user = await ensureUser(wallet);
    const bal = await balances(user.userId);
    return Response.json({
      wallet,
      userId: user.userId,
      depositAddress: user.solanaAddress,
      usdc: bal.usdc,
      balances: bal.list,
      rawBalances: bal.raw,
      rawUser: user.raw, // デバッグ用（アドレスや ID のみで、秘密情報は含まない）
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

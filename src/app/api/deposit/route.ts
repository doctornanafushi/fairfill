import type { NextRequest } from "next/server";
import { restrictedRegion, unauthorized, walletFrom } from "@/lib/server/auth";
import { buildDepositTx } from "@/lib/server/deposit";
import { ensureUser } from "@/lib/server/trading";

// 入金用の未署名トランザクションを返す（署名・送信はブラウザの Phantom）
export async function POST(req: NextRequest) {
  const wallet = walletFrom(req);
  if (!wallet) return unauthorized();
  const blocked = restrictedRegion(req);
  if (blocked) return blocked;
  const { amount } = (await req.json().catch(() => ({}))) as { amount?: number };
  if (!(Number(amount) > 0) || Number(amount) > 10_000)
    return Response.json({ error: "amount must be between 0 and 10,000 USDC" }, { status: 400 });
  try {
    const user = await ensureUser(wallet);
    if (!user.solanaAddress) throw new Error("Gateway did not return a Solana deposit address");
    const tx = await buildDepositTx(wallet, user.solanaAddress, Number(amount));
    return Response.json({ transaction: tx, to: user.solanaAddress });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

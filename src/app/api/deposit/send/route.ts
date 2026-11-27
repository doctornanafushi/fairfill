import type { NextRequest } from "next/server";
import { unauthorized, walletFrom } from "@/lib/server/auth";
import { sendAndConfirm } from "@/lib/server/deposit";

export const maxDuration = 60;

// Phantom で署名済みの入金取引を送信し、ブロックに入るまで再送しながら待つ
export async function POST(req: NextRequest) {
  if (!walletFrom(req)) return unauthorized();
  const { transaction } = (await req.json().catch(() => ({}))) as { transaction?: string };
  if (!transaction) return Response.json({ error: "transaction is required" }, { status: 400 });
  const r = await sendAndConfirm(transaction);
  return Response.json(r, { status: r.landed ? 200 : 409 });
}

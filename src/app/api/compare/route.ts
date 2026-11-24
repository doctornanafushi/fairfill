import type { NextRequest } from "next/server";
import { compare } from "@/lib/server/compare";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  const amount = Number(req.nextUrl.searchParams.get("amount") ?? 100);
  if (!ticker) return Response.json({ error: "ticker is required" }, { status: 400 });
  if (!(amount > 0) || amount > 1_000_000) return Response.json({ error: "amount must be 0–1,000,000" }, { status: 400 });
  try {
    return Response.json(await compare(ticker, amount));
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

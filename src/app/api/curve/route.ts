import type { NextRequest } from "next/server";
import { curve } from "@/lib/server/curve";

export const maxDuration = 60; // 見積もりを数十回取るので長めに

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) return Response.json({ error: "ticker is required" }, { status: 400 });
  try {
    return Response.json(await curve(ticker));
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

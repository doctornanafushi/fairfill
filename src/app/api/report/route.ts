import { verifyReport } from "@/lib/server/report";

// 共有リンクのレポートを復元し、FairFill が発行したもの（改ざんなし）かを確かめる
export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return Response.json({ error: "token is required" }, { status: 400 });
  const r = verifyReport(token);
  if (!r) return Response.json({ error: "Invalid report link" }, { status: 400 });
  return Response.json(r);
}

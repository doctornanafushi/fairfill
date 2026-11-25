import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, createSession, SESSION_TTL_SEC, verifyLogin } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { publicKey?: string; message?: string; signature?: string };
  if (!body.publicKey || !body.message || !body.signature)
    return Response.json({ error: "publicKey, message and signature are required" }, { status: 400 });
  let ok = false;
  try {
    ok = verifyLogin({ publicKey: body.publicKey, message: body.message, signature: body.signature });
  } catch {
    ok = false;
  }
  if (!ok) return Response.json({ error: "Signature verification failed" }, { status: 401 });

  const res = NextResponse.json({ publicKey: body.publicKey });
  res.cookies.set(COOKIE, createSession(body.publicKey), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}

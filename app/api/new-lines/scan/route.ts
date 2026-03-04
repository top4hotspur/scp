// app/api/new-lines/scan/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

function getNewLinesEndpoint(): string {
  // Your backend.ts output shape is:
  // custom.API.newLinesApi.endpoint = "https://.../dev/"
  const ep = (outputs as any)?.custom?.API?.newLinesApi?.endpoint;
  if (!ep) throw new Error("Missing outputs.custom.API.newLinesApi.endpoint in amplify_outputs.json");
  return String(ep).replace(/\/+$/, ""); // trim trailing slash
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const endpoint = getNewLinesEndpoint();

    const res = await fetch(`${endpoint}/new-lines/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: json?.error ?? `HTTP ${res.status}`, raw: json },
        { status: 500 }
      );
    }

    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
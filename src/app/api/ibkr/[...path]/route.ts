/**
 * IBKR Client Portal Gateway proxy
 *
 * Forwards GET requests to the local gateway (https://localhost:5000) so the
 * browser never touches it directly (avoids CORS + self-signed-cert errors).
 *
 * Usage: GET /api/ibkr/<anything>?<qs>
 *   → proxied to IBKR_GATEWAY_URL/v1/api/<anything>?<qs>
 */
import { NextRequest, NextResponse } from "next/server";
import https from "node:https";

const GATEWAY = (process.env.IBKR_GATEWAY_URL ?? "https://localhost:5000").replace(/\/$/, "");

// Self-signed cert on the local gateway — safe to ignore for localhost
const agent = new https.Agent({ rejectUnauthorized: false });

function gatewayGet(apiPath: string, qs: string): Promise<unknown> {
  const url = `${GATEWAY}/v1/api/${apiPath}${qs ? "?" + qs : ""}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw); // some endpoints return plain text
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(12_000, () => {
      req.destroy(new Error("Gateway request timed out"));
    });
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const apiPath = path.join("/");
  const qs = req.nextUrl.searchParams.toString();

  try {
    const data = await gatewayGet(apiPath, qs);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[IBKR proxy]", apiPath, message);
    return NextResponse.json(
      { error: message, gateway: GATEWAY },
      { status: 503 }
    );
  }
}

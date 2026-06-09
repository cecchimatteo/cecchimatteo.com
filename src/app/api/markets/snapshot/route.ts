/**
 * POST /api/markets/snapshot
 *
 * Body: { items: Array<{ symbol: string; conId: number }> }
 *
 * Ensures each item is subscribed to the TWS market-data stream, then
 * returns the current in-memory snapshot plus the gateway status.
 *
 * Returns:
 *   { status: GatewayStatus; quotes: StockQuote[] }
 */

import { ibkr } from "@/lib/ibkr-tws";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      items: Array<{ symbol: string; conId: number }>;
    };

    if (!Array.isArray(body?.items)) {
      return Response.json({ error: "items array required" }, { status: 400 });
    }

    // Ensure every item is subscribed (idempotent)
    for (const { symbol, conId } of body.items) {
      ibkr.subscribe(symbol, conId);
    }

    return Response.json({
      status: ibkr.status(),
      error:  ibkr.lastError(),
      quotes: ibkr.snapshot(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[markets/snapshot]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

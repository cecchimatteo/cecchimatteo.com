/**
 * GET /api/markets/lookup?symbol=AAPL
 *
 * Resolves a ticker symbol to an IBKR contract ID via the TWS API.
 * Looks for US-listed STK contracts (currency USD, exchange SMART).
 *
 * Returns:
 *   200  { conId: number; name: string }
 *   400  { error: "symbol required" }
 *   404  { error: "..." }           — symbol not found or no US contract
 *   503  { error: "..." }           — gateway not connected
 */

import { ibkr } from "@/lib/ibkr-tws";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }

  if (ibkr.status() !== "connected") {
    return Response.json(
      { error: "IB Gateway not connected. Check that IB Gateway is running on port 4002 and the API is enabled." },
      { status: 503 }
    );
  }

  const result = await ibkr.lookupContract(symbol);
  if (!result) {
    return Response.json(
      { error: `Symbol "${symbol}" not found or timed out. Make sure it is a valid US stock ticker.` },
      { status: 404 }
    );
  }

  return Response.json({ conId: result.conId, name: result.name });
}

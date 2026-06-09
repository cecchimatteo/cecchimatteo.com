/**
 * POST /api/markets/fundamentals
 *
 * Body: { items: Array<{ symbol: string; conId: number }> }
 *
 * Fetches market cap for each symbol via IBKR reqFundamentalData("ReportSnapshot").
 * Requires a Reuters/Refinitiv fundamental data subscription on the IBKR account.
 * Returns null for any symbol where data is unavailable or the subscription is absent.
 *
 * Processed in batches of 5 to stay within IBKR's request rate limits.
 *
 * Returns: Record<symbol, number | null>  (market cap in USD)
 */

import { ibkr } from "@/lib/ibkr-tws";

const BATCH_SIZE  = 5;
const BATCH_PAUSE = 500; // ms between batches

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      items: Array<{ symbol: string; conId: number }>;
    };

    if (!Array.isArray(body?.items)) {
      return Response.json({ error: "items array required" }, { status: 400 });
    }

    const out: Record<string, number | null> = {};

    for (let i = 0; i < body.items.length; i += BATCH_SIZE) {
      const batch = body.items.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async ({ symbol, conId }) => ({
          symbol,
          marketCap: await ibkr.lookupFundamentals(conId, symbol),
        }))
      );

      for (const { symbol, marketCap } of results) {
        out[symbol] = marketCap;
      }

      // Pause between batches — skip after the last one
      if (i + BATCH_SIZE < body.items.length) {
        await new Promise((r) => setTimeout(r, BATCH_PAUSE));
      }
    }

    return Response.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[fundamentals]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

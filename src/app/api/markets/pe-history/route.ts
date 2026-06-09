/**
 * GET /api/markets/pe-history?symbol=RY.TO&range=1y
 *
 * Computes historical trailing P/E using Yahoo Finance's chart API with
 * earnings events — a single call that returns both daily/weekly prices AND
 * quarterly actual EPS annotations (the same data Yahoo uses for its own
 * earnings markers on price charts).
 *
 * Strategy:
 *   1. Fetch 5 years of weekly prices + earnings events in one request.
 *   2. From the earnings events, build a sorted list of (reportDate, actualEPS).
 *   3. For each weekly price point, sum the 4 most recently REPORTED quarters
 *      → TTM EPS.  Divide price by TTM EPS → trailing P/E.
 *   4. Filter the result to the user-requested range before returning.
 *
 * Negative or zero TTM EPS periods are skipped (loss-making companies).
 * range: 1mo | 3mo | 6mo | 1y | 5y
 */

import { NextRequest } from "next/server";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getYahooCrumb(): Promise<{ cookie: string; crumb: string }> {
  const consentRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "follow",
    cache: "no-store",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawCookies: string[] = (consentRes.headers as any).getSetCookie?.()
    ?? [consentRes.headers.get("set-cookie") ?? ""];
  const cookie = rawCookies.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookie },
    cache: "no-store",
  });
  if (!crumbRes.ok) throw new Error(`Crumb failed: ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Invalid crumb");
  return { cookie, crumb };
}

export interface PEData {
  timestamps: number[]; // unix seconds
  peRatios:   number[]; // trailing P/E at each point
}

const RANGE_SECONDS: Record<string, number> = {
  "1mo":  30  * 86_400,
  "3mo":  90  * 86_400,
  "6mo":  180 * 86_400,
  "1y":   365 * 86_400,
  "5y":   5 * 365 * 86_400,
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const range  = request.nextUrl.searchParams.get("range") ?? "1y";
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  try {
    const { cookie, crumb } = await getYahooCrumb();

    // Always fetch 5Y weekly data so we have enough earnings history
    // even when the user only wants a 1M display.
    const url =
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=5y&interval=1wk&includePrePost=false&events=earnings` +
      `&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookie },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Yahoo chart API responded ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = json?.chart?.result?.[0];
    if (!result) return Response.json({ error: "no chart data" }, { status: 404 });

    /* ── Weekly price series ── */
    const timestamps: number[]          = result.timestamp ?? [];
    const closes: (number | null)[]     = result.indicators?.quote?.[0]?.close ?? [];

    /* ── Earnings events ── */
    // Keyed by timestamp string: { date, eps, epsEstimated, revenue, ... }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsRaw: Record<string, any> = result.events?.earnings ?? {};

    interface EarningsPoint { date: number; eps: number }

    const earnings: EarningsPoint[] = Object.values(earningsRaw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any): EarningsPoint | null => {
        const date = e.date as number | undefined;
        const eps  = e.eps  as number | undefined;
        if (date == null || eps == null || !isFinite(eps)) return null;
        return { date, eps };
      })
      .filter((e): e is EarningsPoint => e !== null)
      .sort((a, b) => a.date - b.date);

    if (earnings.length < 4) {
      return Response.json(
        { error: `insufficient earnings events (got ${earnings.length}, need 4)` },
        { status: 404 }
      );
    }

    /* ── Compute TTM P/E for each weekly price point ── */
    const allTs:  number[] = [];
    const allPEs: number[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const t     = timestamps[i];
      const price = closes[i];
      if (price == null || price <= 0 || !isFinite(price)) continue;

      // All earnings reported on or before this date
      const prior = earnings.filter((e) => e.date <= t);
      if (prior.length < 4) continue; // not enough history yet

      // TTM = sum of 4 most recently reported quarters
      const ttmEps = prior.slice(-4).reduce((s, e) => s + e.eps, 0);
      if (ttmEps <= 0) continue; // skip loss-making periods

      const pe = price / ttmEps;
      if (!isFinite(pe) || pe > 500) continue; // filter absurd values

      allTs.push(t);
      allPEs.push(parseFloat(pe.toFixed(2)));
    }

    if (allTs.length === 0) {
      return Response.json(
        { error: "could not compute P/E — no profitable quarters found in 5-year window" },
        { status: 404 }
      );
    }

    /* ── Filter to the requested display range ── */
    const cutoff = (Date.now() / 1_000) - (RANGE_SECONDS[range] ?? RANGE_SECONDS["1y"]);
    const filtered = allTs
      .map((t, i) => ({ t, pe: allPEs[i] }))
      .filter((x) => x.t >= cutoff);

    if (filtered.length < 2) {
      // Fall back to full 5Y data if the range filter leaves too little
      return Response.json({
        timestamps: allTs,
        peRatios:   allPEs,
      } satisfies PEData);
    }

    return Response.json({
      timestamps: filtered.map((x) => x.t),
      peRatios:   filtered.map((x) => x.pe),
    } satisfies PEData);

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pe-history]", symbol, message);
    return Response.json({ error: message }, { status: 502 });
  }
}

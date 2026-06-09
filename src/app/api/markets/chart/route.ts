/**
 * GET /api/markets/chart?symbol=RY.TO&range=1y
 *
 * Returns daily (or weekly for 5y) close prices for the given symbol.
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

export interface ChartData {
  timestamps: number[]; // unix seconds
  prices:     number[]; // adjusted close prices
  currency?:  string;
}

const INTERVAL: Record<string, string> = {
  "1mo": "1d",
  "3mo": "1d",
  "6mo": "1d",
  "1y":  "1d",
  "5y":  "1wk",
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const range  = request.nextUrl.searchParams.get("range") ?? "1y";
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const interval = INTERVAL[range] ?? "1d";

  try {
    const { cookie, crumb } = await getYahooCrumb();

    const url =
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${range}&interval=${interval}&includePrePost=false` +
      `&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookie },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Yahoo chart responded with ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any   = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = data?.chart?.result?.[0];
    if (!result) return Response.json({ error: "no chart data" }, { status: 404 });

    const rawTs: number[]          = result.timestamp ?? [];
    const rawClose: (number|null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const currency: string | undefined = result.meta?.currency;

    // Zip timestamps + closes, filter null entries
    const pairs = rawTs
      .map((t, i) => ({ t, p: rawClose[i] }))
      .filter((x): x is { t: number; p: number } => x.p != null && isFinite(x.p));

    return Response.json({
      timestamps: pairs.map((x) => x.t),
      prices:     pairs.map((x) => x.p),
      currency,
    } satisfies ChartData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[chart]", symbol, message);
    return Response.json({ error: message }, { status: 502 });
  }
}

/**
 * GET /api/markets/yahoo?symbols=VNM,EWA,...
 *
 * Server-side proxy to Yahoo Finance — returns market cap for each symbol.
 * Yahoo requires a session cookie + crumb; we fetch both on each call.
 */

import { NextRequest } from "next/server";

export interface YahooQuote {
  name?:      string;
  marketCap?: number;
}

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

  const cookie = rawCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookie },
    cache: "no-store",
  });

  if (!crumbRes.ok) throw new Error(`Crumb fetch failed: ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Invalid crumb response");

  return { cookie, crumb };
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols");
  if (!symbols) return Response.json({ error: "symbols required" }, { status: 400 });

  try {
    const { cookie, crumb } = await getYahooCrumb();

    const url =
      `https://query2.finance.yahoo.com/v7/finance/quote` +
      `?symbols=${encodeURIComponent(symbols)}` +
      `&crumb=${encodeURIComponent(crumb)}` +
      `&fields=shortName,longName,marketCap,totalAssets`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookie },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Yahoo Finance responded with ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const results: Record<string, unknown>[] = data?.quoteResponse?.result ?? [];

    const out: Record<string, YahooQuote> = {};
    for (const r of results) {
      const sym = r.symbol as string;
      if (!sym) continue;
      // Stocks → marketCap; ETFs → totalAssets (AUM)
      const cap = typeof r.marketCap === "number" ? r.marketCap
                : typeof r.totalAssets === "number" ? r.totalAssets
                : undefined;
      out[sym] = {
        name:      (r.shortName ?? r.longName ?? undefined) as string | undefined,
        marketCap: cap,
      };
    }

    return Response.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[yahoo]", message);
    return Response.json({ error: message }, { status: 502 });
  }
}

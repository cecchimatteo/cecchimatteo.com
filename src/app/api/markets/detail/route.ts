/**
 * GET /api/markets/detail?symbol=RY.TO
 *
 * Fetches an extended quote from Yahoo Finance for a single symbol.
 * Returns key financial metrics for the company snapshot panel.
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

export interface StockDetail {
  symbol:         string;
  name?:          string;
  exchange?:      string;
  currency?:      string;
  sector?:        string;
  industry?:      string;
  price?:         number;
  changePct?:     number;
  marketCap?:     number;
  pe?:            number;  // trailing P/E
  forwardPE?:     number;
  eps?:           number;  // trailing 12-month EPS
  high52?:        number;
  low52?:         number;
  dividendYield?: number;  // already as %, e.g. 4.21
  beta?:          number;
  avgVolume?:     number;
}

const FIELDS = [
  "shortName", "longName", "fullExchangeName", "currency",
  "sector", "industry",
  "regularMarketPrice", "regularMarketChangePercent",
  "marketCap", "trailingPE", "forwardPE", "epsTrailingTwelveMonths",
  "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
  "dividendYield", "trailingAnnualDividendYield",
  "beta", "averageDailyVolume3Month",
].join(",");

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  try {
    const { cookie, crumb } = await getYahooCrumb();

    const url =
      `https://query2.finance.yahoo.com/v7/finance/quote` +
      `?symbols=${encodeURIComponent(symbol)}` +
      `&crumb=${encodeURIComponent(crumb)}` +
      `&fields=${FIELDS}`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookie },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Yahoo responded with ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any    = data?.quoteResponse?.result?.[0];
    if (!r) return Response.json({ error: "symbol not found" }, { status: 404 });

    // dividendYield is returned as a decimal (0.042 = 4.2%) — convert to %
    const rawYield = r.dividendYield ?? r.trailingAnnualDividendYield;
    const dividendYield = typeof rawYield === "number" && rawYield > 0
      ? rawYield < 1 ? rawYield * 100 : rawYield  // guard against already-% values
      : undefined;

    const out: StockDetail = {
      symbol:        r.symbol,
      name:          r.shortName ?? r.longName,
      exchange:      r.fullExchangeName,
      currency:      r.currency,
      sector:        r.sector       || undefined,
      industry:      r.industry     || undefined,
      price:         r.regularMarketPrice,
      changePct:     r.regularMarketChangePercent,
      marketCap:     r.marketCap,
      pe:            r.trailingPE   || undefined,
      forwardPE:     r.forwardPE    || undefined,
      eps:           typeof r.epsTrailingTwelveMonths === "number" ? r.epsTrailingTwelveMonths : undefined,
      high52:        r.fiftyTwoWeekHigh,
      low52:         r.fiftyTwoWeekLow,
      dividendYield,
      beta:          r.beta         || undefined,
      avgVolume:     r.averageDailyVolume3Month,
    };

    return Response.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[detail]", symbol, message);
    return Response.json({ error: message }, { status: 502 });
  }
}

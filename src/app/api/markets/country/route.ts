/**
 * GET /api/markets/country?region=be
 *
 * Fetches all equity listings for a Yahoo Finance region code via their screener,
 * then computes:
 *   - totalMarketCap   : sum of all valid market caps (USD)
 *   - weightedChangePct: market-cap-weighted average of regularMarketChangePercent
 *   - stockCount       : total equities found
 *   - validCount       : equities with usable market cap + return data
 *
 * Paginates up to 1 000 results (sorted desc by market cap) so the bulk of any
 * country's market cap is always captured even for larger markets.
 */

import { NextRequest } from "next/server";

const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PAGE_SIZE = 250;
const MAX_PAGES = 4; // 1 000 stocks max

/* ── Yahoo crumb auth (same pattern as /api/markets/yahoo) ── */
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

export interface CountryStock {
  symbol:    string;
  name?:     string;
  sector?:   string;
  industry?: string;
  price?:    number; // local-currency market price
  change?:   number; // local-currency day change
  changePct: number; // % day change
  marketCap: number; // USD
}

export interface CountryAggregate {
  region:            string;
  stockCount:        number;
  validCount:        number;
  totalMarketCap:    number; // USD
  weightedChangePct: number; // percentage, e.g. 0.42 means +0.42 %
  quotes:            CountryStock[]; // sorted desc by market cap
}

export async function GET(request: NextRequest) {
  const region = request.nextUrl.searchParams.get("region")?.toLowerCase();
  if (!region) return Response.json({ error: "region required" }, { status: 400 });

  try {
    const { cookie, crumb } = await getYahooCrumb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allQuotes: any[] = [];
    let totalAvailable     = Infinity;

    for (let page = 0; page < MAX_PAGES && allQuotes.length < totalAvailable; page++) {
      const offset = page * PAGE_SIZE;

      const res = await fetch(
        `https://query2.finance.yahoo.com/v1/finance/screener` +
        `?formatted=false&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
        {
          method:  "POST",
          headers: {
            "User-Agent":   UA,
            "Cookie":       cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            offset,
            size:        PAGE_SIZE,
            sortField:   "intradaymarketcap",
            sortType:    "DESC",
            quoteType:   "EQUITY",
            topOperator: "AND",
            query: {
              operator: "AND",
              operands: [{ operator: "EQ", operands: ["region", region] }],
            },
            userId:     "",
            userIdType: "guid",
          }),
          cache: "no-store",
        }
      );

      if (!res.ok) throw new Error(`Screener responded with ${res.status}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any        = await res.json();
      const result           = data?.finance?.result?.[0];
      const quotes: unknown[]= result?.quotes ?? [];

      totalAvailable = result?.total ?? 0;
      allQuotes.push(...quotes);

      if (quotes.length < PAGE_SIZE) break; // last page
      if (page < MAX_PAGES - 1) await new Promise((r) => setTimeout(r, 250));
    }

    // Exclude foreign-stock wrappers that inflate the country aggregate:
    //   • CDRs / ADRs / GDRs — detected by name
    //   • NEO Exchange listings (exchange === "NEO" or symbol ends ".NE") —
    //     Canada's NEO Exchange is almost exclusively CDRs and BMO structured
    //     products tracking US equities; their market caps are the parent's.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isWrapper = (q: any): boolean => {
      const name = ((q.shortName ?? q.longName ?? "") as string).toUpperCase();
      const sym  = (q.symbol ?? "") as string;
      return (
        name.includes(" CDR") || name.includes("(CDR)") ||
        name.includes(" ADR") || name.includes("(ADR)") ||
        name.includes(" GDR") || name.includes("(GDR)") ||
        q.exchange === "NEO"  || sym.endsWith(".NE")
      );
    };

    // Only use stocks that have both a market cap and a daily return figure,
    // and are not foreign-stock wrappers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = allQuotes.filter((q: any) =>
      typeof q.marketCap                  === "number" && q.marketCap > 0 &&
      typeof q.regularMarketChangePercent === "number" &&
      !isWrapper(q)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalMarketCap    = valid.reduce((s: number, q: any) => s + q.marketCap, 0);
    const weightedChangePct = totalMarketCap > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? valid.reduce((s: number, q: any) => s + (q.marketCap / totalMarketCap) * q.regularMarketChangePercent, 0)
      : 0;

    // Build per-stock list sorted by market cap (largest first)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes: CountryStock[] = valid
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort((a: any, b: any) => b.marketCap - a.marketCap)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any): CountryStock => ({
        symbol:    q.symbol,
        name:      (q.shortName ?? q.longName ?? undefined) as string | undefined,
        sector:    (q.sector   || undefined) as string | undefined,
        industry:  (q.industry || undefined) as string | undefined,
        price:     typeof q.regularMarketPrice  === "number" ? q.regularMarketPrice  : undefined,
        change:    typeof q.regularMarketChange  === "number" ? q.regularMarketChange : undefined,
        changePct: q.regularMarketChangePercent,
        marketCap: q.marketCap,
      }));

    const out: CountryAggregate = {
      region,
      stockCount:        allQuotes.length,
      validCount:        valid.length,
      totalMarketCap,
      weightedChangePct,
      quotes,
    };

    return Response.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[country]", region, message);
    return Response.json({ error: message }, { status: 502 });
  }
}

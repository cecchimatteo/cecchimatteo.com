"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { Plus, X, Globe, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { CountryAggregate, CountryStock } from "@/app/api/markets/country/route";
import type { StockDetail } from "@/app/api/markets/detail/route";
import type { ChartData } from "@/app/api/markets/chart/route";
import type { PEData } from "@/app/api/markets/pe-history/route";

/* ── Types ── */
interface CountryItem { region: string; name: string; }

/* ── Country map (Yahoo Finance region codes) ── */
const COUNTRIES: CountryItem[] = [
  { region: "ar", name: "Argentina" },   { region: "au", name: "Australia" },
  { region: "at", name: "Austria" },     { region: "be", name: "Belgium" },
  { region: "br", name: "Brazil" },      { region: "ca", name: "Canada" },
  { region: "cl", name: "Chile" },       { region: "cn", name: "China" },
  { region: "co", name: "Colombia" },    { region: "dk", name: "Denmark" },
  { region: "fi", name: "Finland" },     { region: "fr", name: "France" },
  { region: "de", name: "Germany" },     { region: "gr", name: "Greece" },
  { region: "hk", name: "Hong Kong" },  { region: "in", name: "India" },
  { region: "id", name: "Indonesia" },   { region: "ie", name: "Ireland" },
  { region: "il", name: "Israel" },      { region: "it", name: "Italy" },
  { region: "jp", name: "Japan" },       { region: "kw", name: "Kuwait" },
  { region: "my", name: "Malaysia" },    { region: "mx", name: "Mexico" },
  { region: "nl", name: "Netherlands" }, { region: "nz", name: "New Zealand" },
  { region: "no", name: "Norway" },      { region: "pe", name: "Peru" },
  { region: "ph", name: "Philippines" }, { region: "pl", name: "Poland" },
  { region: "qa", name: "Qatar" },       { region: "sa", name: "Saudi Arabia" },
  { region: "sg", name: "Singapore" },   { region: "za", name: "South Africa" },
  { region: "kr", name: "South Korea" }, { region: "es", name: "Spain" },
  { region: "se", name: "Sweden" },      { region: "ch", name: "Switzerland" },
  { region: "tw", name: "Taiwan" },      { region: "th", name: "Thailand" },
  { region: "tr", name: "Turkey" },      { region: "ae", name: "UAE" },
  { region: "gb", name: "United Kingdom" }, { region: "us", name: "United States" },
  { region: "vn", name: "Vietnam" },
];
const LS_COUNTRIES = "markets_countries";

/* ── Formatters ── */
function fmtMktCap(v?: number | null): string {
  if (v == null || v <= 0) return "—";
  if (v >= 1_000_000_000_000) return "$" + (v / 1_000_000_000_000).toFixed(2) + "T";
  if (v >= 1_000_000_000)     return "$" + (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000)         return "$" + (v / 1_000_000).toFixed(1) + "M";
  return "$" + v.toLocaleString();
}

function fmtPrice(v?: number | null): string {
  if (v == null || v <= 0) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVolume(v?: number | null): string {
  if (v == null || v <= 0) return "—";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + "K";
  return v.toLocaleString();
}

function fmtPct(v?: number | null): { text: string; pos: boolean | null } {
  if (v == null) return { text: "—", pos: null };
  const sign = v > 0 ? "+" : "";
  return { text: `${sign}${v.toFixed(2)}%`, pos: v > 0 ? true : v < 0 ? false : null };
}

function chgClass(pos: boolean | null) {
  if (pos === true)  return "text-[#3CC78D]";
  if (pos === false) return "text-[#E04E58]";
  return "text-mute";
}

/* ── SVG Price Chart ── */
const RANGES = ["1mo", "3mo", "6mo", "1y", "5y"] as const;
type Range = typeof RANGES[number];

function PriceChart({
  timestamps, prices, range, lineColor, fmtYAxis,
}: {
  timestamps: number[];
  prices:     number[];
  range:      Range;
  lineColor?: string;             // override auto green/red
  fmtYAxis?:  (v: number) => string; // override Y-axis label formatter
}) {
  if (prices.length < 2) {
    return <div className="h-[130px] flex items-center justify-center text-[12px] text-mute">No data</div>;
  }

  const W = 520, H = 130;
  const PAD = { t: 10, r: 6, b: 22, l: 46 };
  const iW  = W - PAD.l - PAD.r;
  const iH  = H - PAD.t - PAD.b;

  const minP  = Math.min(...prices);
  const maxP  = Math.max(...prices);
  const prng  = maxP - minP || 1;
  const isPos = prices[prices.length - 1] >= prices[0];
  const color = lineColor ?? (isPos ? "#3CC78D" : "#E04E58");

  const cx = (i: number) => PAD.l + (i / (prices.length - 1)) * iW;
  const cy = (p: number) => PAD.t + (1 - (p - minP) / prng) * iH;

  const linePts = prices.map((p, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${cy(p).toFixed(1)}`).join(" ");
  const areaPts = `${linePts} L${cx(prices.length - 1).toFixed(1)},${(PAD.t + iH).toFixed(1)} L${PAD.l.toFixed(1)},${(PAD.t + iH).toFixed(1)} Z`;

  // 3 Y-axis ticks
  const yTicks = [0, 0.5, 1].map((t) => ({
    val:  minP + t * prng,
    yPos: PAD.t + (1 - t) * iH,
  }));

  const defaultFmtY = (v: number) =>
    v >= 10_000 ? (v / 1_000).toFixed(0) + "k"
    : v >= 1_000 ? (v / 1_000).toFixed(1) + "k"
    : v >= 100   ? v.toFixed(0)
    : v >= 10    ? v.toFixed(1)
    :              v.toFixed(2);
  const fmtY = fmtYAxis ?? defaultFmtY;

  const fmtDate = (ts: number) => {
    const d = new Date(ts * 1000);
    if (range === "5y") return String(d.getFullYear());
    if (range === "1y" || range === "6mo")
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 130 }}>
      <defs>
        <linearGradient id="chart-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Grid + Y labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={PAD.l} x2={W - PAD.r}
            y1={t.yPos} y2={t.yPos}
            stroke="var(--color-line)" strokeWidth="0.75"
          />
          <text
            x={PAD.l - 5} y={t.yPos + 3.5}
            textAnchor="end" fontSize="9.5"
            fill="var(--color-mute)"
          >{fmtY(t.val)}</text>
        </g>
      ))}

      {/* Area + line */}
      <path d={areaPts} fill="url(#chart-area)" />
      <path d={linePts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />

      {/* X labels */}
      <text x={PAD.l}       y={H - 4} fontSize="9.5" fill="var(--color-mute)">{fmtDate(timestamps[0])}</text>
      <text x={W - PAD.r}   y={H - 4} fontSize="9.5" fill="var(--color-mute)" textAnchor="end">{fmtDate(timestamps[timestamps.length - 1])}</text>
    </svg>
  );
}

/* ── Metric tile ── */
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">{label}</span>
      <span className="text-[14px] font-medium text-ink">{value}</span>
      {sub && <span className="text-[10px] text-mute">{sub}</span>}
    </div>
  );
}

/* ── Stock detail panel (right drawer) ── */
function StockDetailPanel({
  stock, detail, chartData, peData, chartRange, chartType,
  detailLoading, chartLoading, peLoading,
  onRangeChange, onChartTypeChange, onClose,
}: {
  stock:             CountryStock;
  detail:            StockDetail | null;
  chartData:         ChartData   | null;
  peData:            PEData      | null;
  chartRange:        Range;
  chartType:         "price" | "pe";
  detailLoading:     boolean;
  chartLoading:      boolean;
  peLoading:         boolean;
  onRangeChange:     (r: Range) => void;
  onChartTypeChange: (t: "price" | "pe") => void;
  onClose:           () => void;
}) {
  const name      = detail?.name      ?? stock.name;
  const price     = detail?.price     ?? stock.price;
  const changePct = detail?.changePct ?? stock.changePct;
  const pct       = fmtPct(changePct);
  const exchange  = detail?.exchange;
  const currency  = detail?.currency ?? chartData?.currency;
  const sector    = detail?.sector   ?? stock.sector;
  const industry  = detail?.industry ?? stock.industry;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-line">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[20px] font-bold tracking-wide text-ink">{stock.symbol}</span>
            {exchange && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface border border-line text-mute">
                {exchange}
              </span>
            )}
            {currency && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface border border-line text-mute">
                {currency}
              </span>
            )}
          </div>
          {name && <p className="text-[13px] text-mute mt-0.5 truncate">{name}</p>}
        </div>
        <div className="flex items-start gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[20px] font-semibold tabular-nums text-ink">
              {price ? fmtPrice(price) : "—"}
            </div>
            <div className={`text-[13px] tabular-nums ${chgClass(pct.pos)}`}>{pct.text}</div>
          </div>
          <button
            onClick={onClose}
            className="mt-1 text-mute hover:text-ink p-1 rounded hover:bg-surface transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Sector / industry breadcrumb */}
      {(sector || industry) && (
        <div className="px-6 py-2.5 border-b border-line flex items-center gap-1.5 text-[12px] text-mute">
          {sector && <span>{sector}</span>}
          {sector && industry && <span className="opacity-40">›</span>}
          {industry && <span>{industry}</span>}
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Chart */}
        <div className="px-6 pt-5 pb-3">
          {/* Chart type + range controls */}
          <div className="flex items-center justify-between mb-3">
            {/* Price / P/E toggle */}
            <div className="flex items-center gap-0.5 bg-surface rounded-md p-0.5">
              {(["price", "pe"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onChartTypeChange(t)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    chartType === t
                      ? "bg-bg text-ink shadow-sm"
                      : "text-mute hover:text-ink"
                  }`}
                >
                  {t === "price" ? "Price" : "P/E"}
                </button>
              ))}
            </div>

            {/* Range tabs */}
            <div className="flex items-center gap-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => onRangeChange(r)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    chartRange === r
                      ? "bg-accent text-white"
                      : "text-mute hover:text-ink hover:bg-surface"
                  }`}
                >
                  {r === "1mo" ? "1M" : r === "3mo" ? "3M" : r === "6mo" ? "6M" : r === "1y" ? "1Y" : "5Y"}
                </button>
              ))}
            </div>
          </div>

          {/* Price chart */}
          {chartType === "price" && (
            chartLoading ? (
              <div className="h-[130px] rounded-md bg-surface animate-pulse" />
            ) : chartData && chartData.prices.length > 1 ? (
              <PriceChart timestamps={chartData.timestamps} prices={chartData.prices} range={chartRange} />
            ) : (
              <div className="h-[130px] flex items-center justify-center text-[12px] text-mute">
                Chart unavailable
              </div>
            )
          )}

          {/* P/E chart */}
          {chartType === "pe" && (
            peLoading ? (
              <div className="h-[130px] rounded-md bg-surface animate-pulse" />
            ) : peData && peData.peRatios.length > 1 ? (
              <PriceChart
                timestamps={peData.timestamps}
                prices={peData.peRatios}
                range={chartRange}
                lineColor="#8B6FFF"
                fmtYAxis={(v) => v.toFixed(1) + "×"}
              />
            ) : (
              <div className="h-[130px] flex items-center justify-center text-center text-[12px] text-mute px-4">
                P/E history unavailable — company may have reported losses in this period
              </div>
            )
          )}
        </div>

        {/* Metrics */}
        <div className="px-6 py-4 border-t border-line">
          {detailLoading ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-2 w-14 rounded bg-surface animate-pulse" />
                  <div className="h-4 w-20 rounded bg-surface animate-pulse" />
                </div>
              ))}
            </div>
          ) : detail ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Metric label="Market Cap"  value={fmtMktCap(detail.marketCap)} />
              <Metric label="P/E (TTM)"   value={detail.pe       != null ? detail.pe.toFixed(1)       : "—"} />
              <Metric label="Fwd P/E"     value={detail.forwardPE != null ? detail.forwardPE.toFixed(1) : "—"} />
              <Metric label="EPS (TTM)"   value={detail.eps      != null
                ? (detail.eps >= 0 ? "" : "") + detail.eps.toFixed(2)
                : "—"}
              />
              <Metric label="52wk High"   value={fmtPrice(detail.high52)} />
              <Metric label="52wk Low"    value={fmtPrice(detail.low52)} />
              <Metric label="Div. Yield"  value={detail.dividendYield != null ? detail.dividendYield.toFixed(2) + "%" : "—"} />
              <Metric label="Beta"        value={detail.beta     != null ? detail.beta.toFixed(2)      : "—"} />
              <Metric label="Avg Volume"  value={fmtVolume(detail.avgVolume)} />
            </div>
          ) : (
            <p className="text-[12px] text-mute">Could not load financial data.</p>
          )}
        </div>

        {/* Footer link */}
        <div className="px-6 pb-6 pt-2">
          <a
            href={`https://finance.yahoo.com/quote/${encodeURIComponent(stock.symbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-mute hover:text-accent transition-colors"
          >
            View on Yahoo Finance <ExternalLink size={10} strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Stock sub-table (per country) ── */
function StockSubTable({
  quotes,
  onSelect,
}: {
  quotes:   CountryStock[];
  onSelect: (s: CountryStock) => void;
}) {
  return (
    <div className="border-t border-line/50">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-surface/60 border-b border-line/40">
            <th className="w-10 pl-9 pr-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">#</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">Symbol</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">Name / Industry</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">Price</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">Chg %</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.07em] font-semibold text-mute">Mkt Cap</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {quotes.map((stock, i) => {
            const pct    = fmtPct(stock.changePct);
            const isLast = i === quotes.length - 1;
            return (
              <tr
                key={stock.symbol}
                onClick={() => onSelect(stock)}
                className={`cursor-pointer hover:bg-surface/60 ${!isLast ? "border-b border-line/30" : ""}`}
              >
                <td className="pl-9 pr-3 py-2 tabular-nums text-mute">{i + 1}</td>
                <td className="px-3 py-2 font-semibold text-ink tracking-wide whitespace-nowrap">{stock.symbol}</td>
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="text-dim truncate" title={stock.name}>{stock.name ?? "—"}</div>
                  {stock.industry && (
                    <div className="text-[10px] text-mute truncate">{stock.industry}</div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-dim">{fmtPrice(stock.price)}</td>
                <td className={`px-3 py-2 tabular-nums ${chgClass(pct.pos)}`}>{pct.text}</td>
                <td className="px-3 py-2 tabular-nums text-dim whitespace-nowrap">{fmtMktCap(stock.marketCap)}</td>
                <td className="w-8" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page ── */
export default function MarketsPage() {
  const [countryItems,    setCountryItems]    = useState<CountryItem[]>([]);
  const [countryData,     setCountryData]     = useState<Record<string, CountryAggregate>>({});
  const [countrySelect,   setCountrySelect]   = useState("");
  const [fetchingCountry, setFetchingCountry] = useState<string | null>(null);
  const [expanded,        setExpanded]        = useState<string | null>(null);

  // Detail panel
  const [selectedStock,  setSelectedStock]  = useState<CountryStock | null>(null);
  const [stockDetail,    setStockDetail]    = useState<StockDetail   | null>(null);
  const [chartData,      setChartData]      = useState<ChartData     | null>(null);
  const [peData,         setPeData]         = useState<PEData        | null>(null);
  const [chartRange,     setChartRange]     = useState<Range>("1y");
  const [chartType,      setChartType]      = useState<"price" | "pe">("price");
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [chartLoading,   setChartLoading]   = useState(false);
  const [peLoading,      setPeLoading]      = useState(false);
  const lastSymbolRef = useRef<string | null>(null);

  /* ── Load from localStorage (default: Belgium + Canada) ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_COUNTRIES);
      setCountryItems(saved ? JSON.parse(saved) : [
        { region: "be", name: "Belgium" },
        { region: "ca", name: "Canada" },
      ]);
    } catch {
      setCountryItems([{ region: "be", name: "Belgium" }, { region: "ca", name: "Canada" }]);
    }
  }, []);

  /* ── Fetch aggregate + stocks for newly-added countries ── */
  useEffect(() => {
    if (countryItems.length === 0) return;
    const missing = countryItems.filter((c) => !countryData[c.region]);
    if (missing.length === 0) return;
    (async () => {
      for (const c of missing) {
        setFetchingCountry(c.region);
        try {
          const res = await fetch(`/api/markets/country?region=${c.region}`);
          if (res.ok) {
            const data = await res.json() as CountryAggregate;
            setCountryData((prev) => ({ ...prev, [c.region]: data }));
          }
        } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 300));
      }
      setFetchingCountry(null);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryItems]);

  /* ── Fetch detail + chart whenever stock or range changes ── */
  useEffect(() => {
    if (!selectedStock) { lastSymbolRef.current = null; return; }

    const symbolChanged = lastSymbolRef.current !== selectedStock.symbol;
    lastSymbolRef.current = selectedStock.symbol;

    // Only re-fetch detail when the stock actually changes
    if (symbolChanged) {
      setDetailLoading(true);
      setStockDetail(null);
      fetch(`/api/markets/detail?symbol=${encodeURIComponent(selectedStock.symbol)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d && setStockDetail(d as StockDetail))
        .catch(() => {})
        .finally(() => setDetailLoading(false));
    }

    // Always re-fetch price chart (symbol or range changed)
    setChartLoading(true);
    setChartData(null);
    fetch(`/api/markets/chart?symbol=${encodeURIComponent(selectedStock.symbol)}&range=${chartRange}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setChartData(d as ChartData))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock, chartRange]);

  /* ── Fetch P/E history when PE tab is active ── */
  useEffect(() => {
    if (!selectedStock || chartType !== "pe") return;
    setPeLoading(true);
    setPeData(null);
    fetch(`/api/markets/pe-history?symbol=${encodeURIComponent(selectedStock.symbol)}&range=${chartRange}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setPeData(d as PEData))
      .catch(() => {})
      .finally(() => setPeLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStock?.symbol, chartType, chartRange]);

  /* ── Handlers ── */
  function handleAddCountry() {
    if (!countrySelect) return;
    const country = COUNTRIES.find((c) => c.region === countrySelect);
    if (!country || countryItems.some((c) => c.region === countrySelect)) return;
    const next = [...countryItems, country];
    setCountryItems(next);
    try { localStorage.setItem(LS_COUNTRIES, JSON.stringify(next)); } catch { /* */ }
    setCountrySelect("");
  }

  function handleRemoveCountry(region: string) {
    const next = countryItems.filter((c) => c.region !== region);
    setCountryItems(next);
    setCountryData((prev) => { const n = { ...prev }; delete n[region]; return n; });
    if (expanded === region) setExpanded(null);
    try { localStorage.setItem(LS_COUNTRIES, JSON.stringify(next)); } catch { /* */ }
  }

  function handleSelectStock(stock: CountryStock) {
    if (selectedStock?.symbol === stock.symbol) {
      setSelectedStock(null); // toggle off
    } else {
      setChartRange("1y");       // reset range on new stock
      setChartType("price");     // reset to price chart
      setPeData(null);
      setSelectedStock(stock);
    }
  }

  const availableCountries = COUNTRIES.filter(
    (c) => !countryItems.some((ci) => ci.region === c.region)
  );
  const panelOpen = selectedStock !== null;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="px-12 py-10" style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Markets</h1>
            <p className="text-[13.5px] text-mute mt-1">
              {countryItems.length} countr{countryItems.length !== 1 ? "ies" : "y"} tracked
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={countrySelect}
              onChange={(e) => setCountrySelect(e.target.value)}
              className="h-8 pl-2.5 pr-7 text-[13.5px] bg-surface border border-line rounded-md text-dim focus:outline-none focus:border-line2"
            >
              <option value="">Add country…</option>
              {availableCountries.map((c) => (
                <option key={c.region} value={c.region}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddCountry}
              disabled={!countrySelect}
              className="h-8 px-3 text-[13.5px] font-medium bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Plus size={13} strokeWidth={2} /> Add
            </button>
          </div>
        </div>

        {/* ── Country table ── */}
        {countryItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Globe size={28} strokeWidth={1.25} className="text-mute" />
            <p className="text-[13.5px] text-mute">No countries tracked. Use the dropdown above to add one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="w-9" />
                  {["Country", "Stocks", "Wt. Return", "Total Mkt Cap", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] uppercase tracking-[0.07em] font-semibold text-mute whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countryItems.map((c, i) => {
                  const data      = countryData[c.region];
                  const loading   = fetchingCountry === c.region;
                  const pct       = data ? fmtPct(data.weightedChangePct) : null;
                  const isOpen    = expanded === c.region;
                  const hasBorder = i < countryItems.length - 1 || isOpen;
                  return (
                    <Fragment key={c.region}>
                      <tr
                        className={`group cursor-pointer select-none hover:bg-surface/60 ${hasBorder ? "border-b border-line/60" : ""}`}
                        onClick={() => setExpanded(isOpen ? null : c.region)}
                      >
                        <td className="pl-3 pr-0 py-3 text-mute">
                          {isOpen
                            ? <ChevronDown  size={14} strokeWidth={1.5} />
                            : <ChevronRight size={14} strokeWidth={1.5} className="opacity-40 group-hover:opacity-80 transition-opacity" />}
                        </td>
                        <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{c.name}</td>
                        <td className="px-4 py-3 tabular-nums text-dim">
                          {loading
                            ? <span className="text-mute animate-pulse">…</span>
                            : data ? data.validCount.toLocaleString() : <span className="text-mute">—</span>}
                        </td>
                        <td className={`px-4 py-3 tabular-nums font-medium ${pct ? chgClass(pct.pos) : "text-mute"}`}>
                          {loading ? <span className="animate-pulse">…</span> : pct ? pct.text : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-dim whitespace-nowrap">
                          {loading
                            ? <span className="text-mute animate-pulse">…</span>
                            : data ? fmtMktCap(data.totalMarketCap) : <span className="text-mute">—</span>}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleRemoveCountry(c.region)}
                            className="text-mute hover:text-[#E04E58] p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title={`Remove ${c.name}`}
                          >
                            <X size={13} strokeWidth={1.5} />
                          </button>
                        </td>
                      </tr>

                      {isOpen && data && (
                        <tr className={i < countryItems.length - 1 ? "border-b border-line/60" : ""}>
                          <td colSpan={6} className="p-0">
                            <StockSubTable quotes={data.quotes} onSelect={handleSelectStock} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-mute mt-3">
          Yahoo Finance screener · Top 1 000 equities by market cap · Click a country to expand · Click a stock for details
        </p>

      </div>

      {/* ── Detail panel backdrop ── */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setSelectedStock(null)}
        />
      )}

      {/* ── Detail panel ── */}
      <div
        className="fixed inset-y-0 right-0 z-50 w-[460px] bg-bg border-l border-line shadow-2xl flex flex-col"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(100%)", transition: "transform 280ms cubic-bezier(0.4,0,0.2,1)" }}
      >
        {selectedStock && (
          <StockDetailPanel
            stock={selectedStock}
            detail={stockDetail}
            chartData={chartData}
            peData={peData}
            chartRange={chartRange}
            chartType={chartType}
            detailLoading={detailLoading}
            chartLoading={chartLoading}
            peLoading={peLoading}
            onRangeChange={(r) => setChartRange(r)}
            onChartTypeChange={(t) => setChartType(t)}
            onClose={() => setSelectedStock(null)}
          />
        )}
      </div>
    </div>
  );
}

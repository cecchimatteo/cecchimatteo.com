/**
 * IBKR TWS API — singleton connection manager
 *
 * Creates ONE persistent socket connection to IB Gateway (port 4002 for paper
 * trading). In Next.js dev mode the module is kept alive across hot-reloads via
 * globalThis so we never open duplicate connections.
 *
 * Thread model: single Node.js event-loop — no concurrency issues.
 */

import { IBApi, EventName, IBApiTickType, SecType, MarketDataType } from "@stoqey/ib";

/* ── Public types ── */

export interface StockQuote {
  symbol:     string;
  conId:      number;
  last?:      number;
  bid?:       number;
  ask?:       number;
  high?:      number;
  low?:       number;
  open?:      number;
  prevClose?: number;
  volume?:    number;
  change?:    number;
  changePct?: number;
  updatedAt?: string; // ISO-8601
}

export type GatewayStatus = "connected" | "connecting" | "disconnected";

/* ── Config ── */

const TWS_HOST  = process.env.IBKR_TWS_HOST  ?? "127.0.0.1";
const TWS_PORT  = parseInt(process.env.IBKR_TWS_PORT ?? "4002", 10);
const CLIENT_ID = 47; // arbitrary — avoid clashing with your own TWS client

/* ── Connection class ── */

class IBKRConnection {
  private ib: IBApi;
  private _status: GatewayStatus = "connecting";
  private _error = "";

  // conId-keyed price cache
  private quotes    = new Map<number, StockQuote>();
  // symbol ↔ conId ↔ tickerId mappings
  private symToConId    = new Map<string, number>();
  private tickerToConId = new Map<number, number>();
  private conIdToTicker = new Map<number, number>();
  private nextTicker    = 2000;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ib = new IBApi({ host: TWS_HOST, port: TWS_PORT, clientId: CLIENT_ID });
    this.attachListeners();
    this.tryConnect();
  }

  /* ── Lifecycle ── */

  private tryConnect() {
    this._status = "connecting";
    console.log(`[IBKR] Connecting to ${TWS_HOST}:${TWS_PORT} (clientId=${CLIENT_ID})`);
    try { this.ib.connect(); }
    catch (e) {
      console.error("[IBKR] Connect threw:", e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(delayMs = 8_000) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.tryConnect();
    }, delayMs);
  }

  /* ── Event listeners ── */

  private attachListeners() {
    this.ib
      .on(EventName.connected, () => {
        console.log("[IBKR] Connected ✓");
        this._status = "connected";
        this._error  = "";
        // Use delayed market data (free) instead of requiring a live subscription
        this.ib.reqMarketDataType(MarketDataType.DELAYED);
        // Re-subscribe any symbols that were tracked before reconnect
        this.quotes.forEach((q) => this.doSubscribe(q.symbol, q.conId));
      })
      .on(EventName.disconnected, () => {
        console.log("[IBKR] Disconnected — will retry in 8 s");
        this._status = "disconnected";
        this.tickerToConId.clear(); // subscriptions are dead
        this.conIdToTicker.clear();
        this.scheduleReconnect();
      })
      .on(EventName.error, (err: Error, code: number) => {
        // Informational / subscription-gated codes — not real errors
        // 2104/2106/2158: farm connected; 10089: delayed data; 430: no fundamental data sub
        if (code === 2104 || code === 2106 || code === 2158 || code === 10089 || code === 430) return;
        console.error(`[IBKR] Error ${code}:`, err?.message);
        this._error = err?.message ?? String(code);
      })
      .on(EventName.tickPrice, (tickerId: number, field: number, price: number) => {
        const conId = this.tickerToConId.get(tickerId);
        if (conId == null || price <= 0) return;
        const q = this.quotes.get(conId) ?? {} as StockQuote;
        switch (field) {
          // Live tick types
          case IBApiTickType.LAST:          q.last      = price; break;
          case IBApiTickType.BID:           q.bid       = price; break;
          case IBApiTickType.ASK:           q.ask       = price; break;
          case IBApiTickType.HIGH:          q.high      = price; break;
          case IBApiTickType.LOW:           q.low       = price; break;
          case IBApiTickType.CLOSE:         q.prevClose = price; break;
          case IBApiTickType.OPEN:          q.open      = price; break;
          // Delayed tick types (sent when reqMarketDataType(DELAYED) is active)
          case IBApiTickType.DELAYED_LAST:  q.last      = price; break;
          case IBApiTickType.DELAYED_BID:   q.bid       = price; break;
          case IBApiTickType.DELAYED_ASK:   q.ask       = price; break;
          case IBApiTickType.DELAYED_HIGH:  q.high      = price; break;
          case IBApiTickType.DELAYED_LOW:   q.low       = price; break;
          case IBApiTickType.DELAYED_CLOSE: q.prevClose = price; break;
          case IBApiTickType.DELAYED_OPEN:  q.open      = price; break;
        }
        if (q.last != null && q.prevClose != null && q.prevClose > 0) {
          q.change    = parseFloat((q.last - q.prevClose).toFixed(4));
          q.changePct = parseFloat(((q.change / q.prevClose) * 100).toFixed(4));
        }
        q.updatedAt = new Date().toISOString();
        this.quotes.set(conId, q);
      })
      .on(EventName.tickSize, (tickerId: number, field?: IBApiTickType, value?: number) => {
        const conId = this.tickerToConId.get(tickerId);
        if (conId == null) return;
        if ((field === IBApiTickType.VOLUME || field === IBApiTickType.DELAYED_VOLUME) && value != null) {
          const q = this.quotes.get(conId);
          if (q) { q.volume = value; this.quotes.set(conId, q); }
        }
      });
  }

  /* ── Subscriptions ── */

  private doSubscribe(symbol: string, conId: number) {
    if (!this._status) return;
    const existing = this.conIdToTicker.get(conId);
    const tickerId = existing ?? this.nextTicker++;
    if (!existing) {
      this.tickerToConId.set(tickerId, conId);
      this.conIdToTicker.set(conId, tickerId);
    }
    this.ib.reqMktData(
      tickerId,
      { conId, symbol, secType: SecType.STK, currency: "USD", exchange: "SMART" },
      "", false, false
    );
  }

  subscribe(symbol: string, conId: number) {
    const existing = this.symToConId.get(symbol);
    if (existing === conId) return; // already subscribed
    this.symToConId.set(symbol, conId);
    const prev = this.quotes.get(conId);
    this.quotes.set(conId, { symbol, conId, ...prev });
    if (this._status === "connected") this.doSubscribe(symbol, conId);
  }

  unsubscribe(symbol: string) {
    const conId = this.symToConId.get(symbol);
    if (conId == null) return;
    const tickerId = this.conIdToTicker.get(conId);
    if (tickerId != null && this._status === "connected") {
      this.ib.cancelMktData(tickerId);
    }
    this.tickerToConId.delete(tickerId!);
    this.conIdToTicker.delete(conId);
    this.symToConId.delete(symbol);
    this.quotes.delete(conId);
  }

  /* ── Data ── */

  status(): GatewayStatus { return this._status; }
  lastError(): string     { return this._error; }

  snapshot(): StockQuote[] {
    return Array.from(this.quotes.values());
  }

  /* ── Contract lookup ── */

  lookupContract(symbol: string): Promise<{ conId: number; name: string } | null> {
    return new Promise((resolve) => {
      if (this._status !== "connected") { resolve(null); return; }

      const reqId = this.nextTicker++;
      let done    = false;

      const finish = (val: { conId: number; name: string } | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.ib.removeListener(EventName.contractDetails,    onDetails);
        this.ib.removeListener(EventName.contractDetailsEnd, onEnd);
        resolve(val);
      };

      const timer = setTimeout(() => finish(null), 12_000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDetails = (id: number, details: any) => {
        if (id !== reqId) return;
        finish({
          conId: details.contract?.conId ?? details.conId,
          name:  details.longName ?? symbol,
        });
      };

      const onEnd = (id: number) => {
        if (id === reqId) finish(null);
      };

      this.ib
        .on(EventName.contractDetails,    onDetails)
        .on(EventName.contractDetailsEnd, onEnd);

      this.ib.reqContractDetails(reqId, {
        symbol,
        secType:  SecType.STK,
        currency: "USD",
        exchange: "SMART",
      });
    });
  }

  /**
   * Fetch fundamental data (market cap) for a contract via ReportSnapshot.
   * Requires a Reuters/Refinitiv fundamental data subscription on the IBKR account.
   * Resolves to null if no subscription, timeout, or not connected.
   *
   * MKTCAP in the XML is in millions USD — we return the actual dollar value.
   */
  lookupFundamentals(conId: number, symbol: string): Promise<number | null> {
    return new Promise((resolve) => {
      if (this._status !== "connected") { resolve(null); return; }

      const reqId = this.nextTicker++;
      let done    = false;

      const finish = (cap: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.ib.removeListener(EventName.fundamentalData, onData);
        this.ib.removeListener(EventName.error,           onErr);
        resolve(cap);
      };

      const timer = setTimeout(() => finish(null), 8_000);

      const onData = (id: number, xml: string) => {
        if (id !== reqId) return;
        // MKTCAP field in ReportSnapshot XML is in millions USD
        const m = xml.match(/FieldName="MKTCAP"[^>]*>\s*([\d.]+)/);
        finish(m ? Math.round(parseFloat(m[1]) * 1_000_000) : null);
      };

      // Error code 430 = no fundamental data subscription — resolve immediately
      const onErr = (_err: Error, code: number, id: number) => {
        if (id === reqId) finish(null);
      };

      this.ib
        .on(EventName.fundamentalData, onData)
        .on(EventName.error,           onErr);

      this.ib.reqFundamentalData(reqId, {
        conId,
        symbol,
        secType:  SecType.STK,
        currency: "USD",
        exchange: "SMART",
      }, "ReportSnapshot");
    });
  }
}

/* ── Singleton — survives Next.js hot-reloads in dev ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__ibkrConn) g.__ibkrConn = new IBKRConnection();
export const ibkr: IBKRConnection = g.__ibkrConn;

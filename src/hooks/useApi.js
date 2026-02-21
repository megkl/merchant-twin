// src/hooks/useApi.js
// ─────────────────────────────────────────────────────────────────────────────
// WHERE EVERY API CALL HAPPENS — one file, fully documented
//
// All hooks call api/client.js which points to http://localhost:4000/api/v1
// The backend handles: DB persistence, AI (Claude), Safaricom integrations
//
// Usage in any component:
//   const { merchants, loading, refetch } = useMerchants();
//   const { logEvent } = useEventLogger();
//   const { analyze } = useAI();
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';

// ── 1. MERCHANTS — loaded at app start, refreshed after uploads/adds
export function useMerchants(filters = {}) {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      // API CALL → GET /api/v1/merchants?{filters}
      const data = await api.merchants.list(filters);
      setMerchants(data);
    } catch (e) {
      setError(e.message);
      console.warn('[useMerchants] Backend unavailable — using empty list. Start backend with: npm run dev');
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetch(); }, [fetch]);

  return { merchants, loading, error, refetch: fetch };
}

// ── 2. SINGLE MERCHANT with full profile
export function useMerchantProfile(merchantId) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!merchantId) return;
    setLoading(true);
    // API CALL → GET /api/v1/merchants/:id/profile
    api.merchants.profile(merchantId)
      .then(setProfile)
      .catch(e => console.warn('[useMerchantProfile]', e.message))
      .finally(() => setLoading(false));
  }, [merchantId]);

  return { profile, loading };
}

// ── 3. EVENT LOGGER — called every time user taps an action in App/USSD/Web
export function useEventLogger() {
  const log = useCallback(async (event) => {
    try {
      // API CALL → POST /api/v1/events
      // Payload: { merchant_id, merchant_name, action_key, action_label,
      //            channel, success, error_code, severity, escalated,
      //            session_id, retry_count, response_time_ms }
      await api.events.log(event);
    } catch (e) {
      console.warn('[useEventLogger] Could not persist event:', e.message);
    }
  }, []);

  return { log };
}

// ── 4. USSD SESSION TRACKING — called by USSD channel component
export function useUSSDSession(merchantId, phoneNumber) {
  const sessionRef = useRef(null);

  const startSession = useCallback(async (networkType) => {
    try {
      // API CALL → POST /api/v1/ussd/session/start
      const res = await api.ussd.startSession({ phoneNumber, merchantId, networkType });
      sessionRef.current = res.sessionId;
      return res.sessionId;
    } catch (e) {
      console.warn('[useUSSDSession] startSession:', e.message);
      return null;
    }
  }, [merchantId, phoneNumber]);

  const logInput = useCallback(async (input, menu, responseTimeMs) => {
    if (!sessionRef.current) return;
    try {
      // API CALL → POST /api/v1/ussd/session/input
      await api.ussd.logInput({ sessionId: sessionRef.current, input, menu, responseTimeMs });
    } catch (e) { /* silent */ }
  }, []);

  const logTimeout = useCallback(async (menu) => {
    if (!sessionRef.current) return;
    try {
      // API CALL → POST /api/v1/ussd/session/timeout
      await api.ussd.logTimeout({ sessionId: sessionRef.current, menu });
    } catch (e) { /* silent */ }
  }, []);

  const endSession = useCallback(async (finalAction, durationMs) => {
    if (!sessionRef.current) return;
    try {
      // API CALL → POST /api/v1/ussd/session/end
      await api.ussd.endSession({ sessionId: sessionRef.current, finalAction, durationMs });
      sessionRef.current = null;
    } catch (e) { /* silent */ }
  }, []);

  return { startSession, logInput, logTimeout, endSession, sessionId: sessionRef.current };
}

// ── 5. APP SESSION LOGGER — called by App channel on errors/crashes
export function useAppLogger() {
  const log = useCallback(async ({ merchantId, actionAttempted, errorType, errorMessage, networkType }) => {
    try {
      // API CALL → POST /api/v1/app/log
      return await api.app.log({ merchantId, actionAttempted, errorType, errorMessage, networkType });
    } catch (e) { return null; }
  }, []);

  const retry = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      // API CALL → POST /api/v1/app/retry
      await api.app.retry({ sessionId });
    } catch (e) { /* silent */ }
  }, []);

  return { log, retry };
}

// ── 6. ALERTS — pre-failure feed, auto-refreshed
export function useAlerts(filters = {}) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      // API CALL → GET /api/v1/alerts?resolved=false&{filters}
      const data = await api.alerts.list({ resolved: 'false', ...filters });
      setAlerts(data);
    } catch (e) {
      console.warn('[useAlerts]', e.message);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetch(); }, [fetch]);

  const resolve = useCallback(async (alertId) => {
    try {
      // API CALL → POST /api/v1/alerts/:id/resolve
      await api.alerts.resolve(alertId);
      fetch();
    } catch (e) { console.warn('[useAlerts resolve]', e.message); }
  }, [fetch]);

  return { alerts, loading, refetch: fetch, resolve };
}

// ── 7. AI — all AI calls go through backend (API key stays server-side)
export function useAI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = useCallback(async (merchantId, actionKey, ruleResult) => {
    setLoading(true); setError(null);
    try {
      // API CALL → POST /api/v1/ai/analyze
      // Body: { merchantId, actionKey, ruleResult }
      // Claude runs server-side — ANTHROPIC_API_KEY never leaves backend
      return await api.ai.analyze({ merchantId, actionKey, ruleResult });
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateSMS = useCallback(async (merchantId, failureCode) => {
    setLoading(true); setError(null);
    try {
      // API CALL → POST /api/v1/ai/sms
      return await api.ai.sms({ merchantId, failureCode });
    } catch (e) {
      setError(e.message); return null;
    } finally { setLoading(false); }
  }, []);

  const generateBriefing = useCallback(async (merchantId) => {
    setLoading(true); setError(null);
    try {
      // API CALL → POST /api/v1/ai/briefing
      // Also auto-creates a CRM ticket in the backend
      return await api.ai.briefing({ merchantId });
    } catch (e) {
      setError(e.message); return null;
    } finally { setLoading(false); }
  }, []);

  const fleetInsight = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // API CALL → POST /api/v1/ai/fleet
      return await api.ai.fleet();
    } catch (e) {
      setError(e.message); return null;
    } finally { setLoading(false); }
  }, []);

  const behaviourAnalysis = useCallback(async (merchantId) => {
    setLoading(true); setError(null);
    try {
      // API CALL → POST /api/v1/ai/behaviour
      return await api.ai.behaviour({ merchantId });
    } catch (e) {
      setError(e.message); return null;
    } finally { setLoading(false); }
  }, []);

  return { analyze, generateSMS, generateBriefing, fleetInsight, behaviourAnalysis, loading, error };
}

// ── 8. FLEET ANALYTICS — for dashboard panels
export function useFleetAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      // API CALL → GET /api/v1/analytics/fleet
      api.analytics.fleet(),
      // API CALL → GET /api/v1/analytics/demographics
      api.analytics.demographics(),
      // API CALL → GET /api/v1/analytics/demand
      api.analytics.demand(),
    ]).then(([fleet, demographics, demand]) => {
      setData({ fleet, demographics, demand });
    }).catch(e => {
      console.warn('[useFleetAnalytics]', e.message);
    }).finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

// ── 9. TRANSACTIONS — for merchant deep-dive
export function useTransactions(merchantId) {
  const [transactions, setTransactions] = useState([]);
  useEffect(() => {
    if (!merchantId) return;
    // API CALL → GET /api/v1/merchants/:id/transactions
    api.merchants.transactions(merchantId)
      .then(setTransactions)
      .catch(() => {});
  }, [merchantId]);
  return { transactions };
}

// ── 10. USSD SESSIONS — for merchant deep-dive
export function useUSSDHistory(merchantId) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    if (!merchantId) return;
    // API CALL → GET /api/v1/merchants/:id/sessions/ussd
    api.merchants.ussdSessions(merchantId)
      .then(setSessions)
      .catch(() => {});
  }, [merchantId]);
  return { sessions };
}

// ── 11. CRM TICKETS
export function useCRMTickets() {
  const [tickets, setTickets] = useState([]);
  const fetch = useCallback(async () => {
    try {
      // API CALL → GET /api/v1/crm/tickets
      setTickets(await api.crm.tickets());
    } catch (e) { console.warn('[useCRMTickets]', e.message); }
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  return { tickets, refetch: fetch };
}

// ── 12. GENERATE MERCHANTS
export function useMerchantGenerator() {
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async (count) => {
    setLoading(true);
    try {
      // API CALL → POST /api/v1/merchants/generate
      return await api.merchants.generate(count);
    } catch (e) {
      console.warn('[useMerchantGenerator]', e.message);
      return null;
    } finally { setLoading(false); }
  }, []);

  return { generate, loading };
}
// src/api/client.js
// Single API client for all backend calls.
// Import this in any component instead of calling fetch directly.
//
// Usage:
//   import api from './api/client';
//   const merchants = await api.merchants.list();
//   const result = await api.ai.analyze({ merchantId: 'M001', actionKey: 'SETTLE_FUNDS' });

const BASE = 'http://localhost:4000/api/v1';

async function req(method, path, body, isFile = false) {
  const opts = {
    method,
    headers: isFile ? {} : { 'Content-Type': 'application/json' },
    body: body ? (isFile ? body : JSON.stringify(body)) : undefined,
  };
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const api = {
  // ── Health
  health: () => req('GET', '/health'),

  // ── Merchants
  merchants: {
    list:     (filters = {}) => req('GET', '/merchants?' + new URLSearchParams(filters)),
    get:      (id)           => req('GET', `/merchants/${id}`),
    create:   (data)         => req('POST', '/merchants', data),
    update:   (id, data)     => req('PUT', `/merchants/${id}`, data),
    delete:   (id)           => req('DELETE', `/merchants/${id}`),
    profile:  (id)           => req('GET', `/merchants/${id}/profile`),
    ussdSessions: (id, limit) => req('GET', `/merchants/${id}/sessions/ussd?limit=${limit || 20}`),
    appSessions:  (id)        => req('GET', `/merchants/${id}/sessions/app`),
    transactions: (id, limit) => req('GET', `/merchants/${id}/transactions?limit=${limit || 50}`),
    tickets:      (id)        => req('GET', `/merchants/${id}/tickets`),
    generate: (count)        => req('POST', '/merchants/generate', { count }),
  },

  // ── Rules
  rules: {
    list:   ()               => req('GET', '/rules'),
    update: (actionKey, data) => req('PUT', `/rules/${actionKey}`, data),
  },

  // ── Events
  events: {
    log:  (event)            => req('POST', '/events', event),
    list: (filters = {})     => req('GET', '/events?' + new URLSearchParams(filters)),
  },

  // ── Alerts
  alerts: {
    list:    (filters = {})  => req('GET', '/alerts?' + new URLSearchParams(filters)),
    create:  (alert)         => req('POST', '/alerts', alert),
    resolve: (id)            => req('POST', `/alerts/${id}/resolve`),
  },

  // ── USSD Gateway
  ussd: {
    startSession:  (data) => req('POST', '/ussd/session/start', data),
    logInput:      (data) => req('POST', '/ussd/session/input', data),
    logTimeout:    (data) => req('POST', '/ussd/session/timeout', data),
    endSession:    (data) => req('POST', '/ussd/session/end', data),
    timeoutStats:  ()     => req('GET', '/ussd/stats/timeouts'),
  },

  // ── App Logger
  app: {
    log:    (data) => req('POST', '/app/log', data),
    retry:  (data) => req('POST', '/app/retry', data),
    trends: ()     => req('GET', '/app/trends'),
  },

  // ── Transactions
  transactions: {
    record: (data) => req('POST', '/transactions', data),
  },

  // ── Upload (CSV / Excel / JSON)
  upload: {
    merchants:   (formData) => req('POST', '/upload/merchants', formData, true),
    behaviours:  (formData) => req('POST', '/upload/behaviours', formData, true),
    rules:       (formData) => req('POST', '/upload/rules', formData, true),
    history:     ()         => req('GET', '/uploads'),
    template:    (type)     => `${BASE}/upload/${type}/template`,
  },

  // ── AI (runs server-side — API key never in browser)
  ai: {
    analyze:   (data) => req('POST', '/ai/analyze', data),
    sms:       (data) => req('POST', '/ai/sms', data),
    briefing:  (data) => req('POST', '/ai/briefing', data),
    fleet:     ()     => req('POST', '/ai/fleet', {}),
    behaviour: (data) => req('POST', '/ai/behaviour', data),
  },

  // ── Analytics
  analytics: {
    list:         (filters = {}) => req('GET', '/analytics?' + new URLSearchParams(filters)),
    fleet:        ()             => req('GET', '/analytics/fleet'),
    demographics: ()             => req('GET', '/analytics/demographics'),
    demand:       ()             => req('GET', '/analytics/demand'),
  },

  // ── CRM
  crm: {
    tickets:      (limit)         => req('GET', `/crm/tickets?limit=${limit || 50}`),
    createTicket: (data)          => req('POST', '/crm/tickets', data),
    updateStatus: (id, status, agentId) => req('PUT', `/crm/tickets/${id}/status`, { status, agent_id: agentId }),
  },

  // ── Notifications
  notifications: {
    sendSMS: (data) => req('POST', '/notifications/sms', data),
  },
};

export default api;
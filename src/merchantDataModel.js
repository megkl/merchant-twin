// ═══════════════════════════════════════════════════════════════════════════
// MERCHANT DATA MODEL  —  Step 1 of 4
// Safaricom LNM Merchant Digital Twin
//
// Responsibilities:
//   1. SCHEMA        — defines every field a merchant has (mirrors API payload)
//   2. REGISTRY      — the 5 curated mock merchants (covering all failure states)
//   3. GENERATOR     — produces random merchants for stress testing
//   4. MUTATIONS     — functions that update merchant state (SIM swap, PIN lock, etc.)
//   5. UTILITIES     — formatters and helpers used across all layers
//
// Consumed by:  failureRulesEngine.js  →  merchant-simulator.jsx
// ═══════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — SCHEMA DEFINITION
// Every field mirrors the Short Term Paybill API payload structure.
// "sensor" fields are the live values the twin reads and updates.
// ─────────────────────────────────────────────────────────────────────────────

export const MERCHANT_SCHEMA = {
  // ── Identity (from applicant_personal_details + applicant_identity_details)
  id:               { type: "string",  description: "Unique twin ID, e.g. M001" },
  first_name:       { type: "string",  description: "Applicant first name" },
  middle_name:      { type: "string",  description: "Applicant middle name" },
  last_name:        { type: "string",  description: "Applicant last name" },
  date_of_birth:    { type: "string",  description: "ISO date YYYY-MM-DD" },
  gender:           { type: "string",  description: "Male | Female" },
  nationality:      { type: "string",  description: "e.g. Kenyan" },
  document_type:    { type: "string",  description: "National ID | Passport" },
  document_number:  { type: "string",  description: "ID / passport number" },

  // ── Contact (from applicant_contact_details)
  phone_number:     { type: "string",  description: "Primary phone, e.g. 0704737162" },
  email:            { type: "string",  description: "Email address" },
  county:           { type: "string",  description: "e.g. Nairobi" },
  city:             { type: "string",  description: "e.g. Nairobi" },
  physical_address: { type: "string",  description: "e.g. Roysambu, Nairobi" },
  postal_address:   { type: "string",  description: "Box number" },
  postal_code:      { type: "string",  description: "e.g. 00100" },

  // ── Business (from application_business_details)
  business_name:    { type: "string",  description: "Registered business name" },
  business_category:{ type: "string",  description: "Retail | Hardware | Services | etc." },
  business_region:  { type: "string",  description: "e.g. Nairobi" },
  paybill:          { type: "string",  description: "M-PESA paybill number" },
  kra_pin:          { type: "string",  description: "KRA PIN e.g. A0098499583" },
  certificate_number:{ type: "string", description: "Business cert number" },
  product:          { type: "string",  description: "Short Term Paybill | Long Term Paybill" },
  duration:         { type: "string",  description: "e.g. 6 months" },
  application_status:{ type: "string", description: "approved | pending | suspended | frozen" },

  // ── Bank (from business_bank_details)
  bank:             { type: "string",  description: "Bank name e.g. Equity Bank" },
  bank_branch:      { type: "string",  description: "Branch name e.g. Kasarani" },
  bank_branch_code: { type: "string",  description: "Branch code" },
  bank_account_name:{ type: "string",  description: "Account name" },
  bank_account:     { type: "string",  description: "Account number" },
  source_of_funds:  { type: "string",  description: "Business income | Investments | etc." },
  purpose_of_funds: { type: "string",  description: "Business operations | etc." },
  expected_turnover:{ type: "string",  description: "Monthly turnover estimate" },

  // ── SENSOR FIELDS (live state — these are what the twin monitors) ──────────
  account_status:          { type: "string",  sensor: true, values: ["active","suspended","frozen"],       description: "Current account lifecycle state" },
  kyc_status:              { type: "string",  sensor: true, values: ["verified","pending","expired"],      description: "KYC verification status" },
  kyc_age_days:            { type: "number",  sensor: true, description: "Days since KYC was last verified" },
  sim_status:              { type: "string",  sensor: true, values: ["active","swapped","unregistered"],   description: "SIM card status" },
  sim_swap_days_ago:       { type: "number",  sensor: true, nullable: true, description: "Days since last SIM swap (null = never)" },
  pin_attempts:            { type: "number",  sensor: true, description: "Failed PIN attempts (0–3)" },
  pin_locked:              { type: "boolean", sensor: true, description: "True when PIN locked after 3 attempts" },
  start_key_status:        { type: "string",  sensor: true, values: ["valid","invalid","expired"],         description: "Merchant start key state" },
  balance:                 { type: "number",  sensor: true, description: "Available paybill balance in KES" },
  dormant_days:            { type: "number",  sensor: true, description: "Days since last transaction" },
  notifications_enabled:   { type: "boolean", sensor: true, description: "SMS/Push notifications active" },
  settlement_on_hold:      { type: "boolean", sensor: true, description: "Manual settlement hold applied" },
  operator_dormant_days:   { type: "number",  sensor: true, description: "Days since operator last used G2 system" },

  // ── UI / Display
  avatar:  { type: "string", description: "Emoji avatar for UI" },
  color:   { type: "string", description: "Brand color hex for UI" },
};

// Sensor field names — used by the twin loop to know what to watch
export const SENSOR_FIELDS = Object.entries(MERCHANT_SCHEMA)
  .filter(([, v]) => v.sensor)
  .map(([k]) => k);


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CURATED MERCHANT REGISTRY
// 5 merchants, each representing a distinct failure profile.
// Profile coverage:
//   M001 — Healthy (all sensors green, happy path)
//   M002 — Multi-failure (suspended + expired KYC + swapped SIM + locked PIN)
//   M003 — Partial (active but KYC pending + PIN near-lock)
//   M004 — Frozen + dormant + expired start key
//   M005 — Clean active, high balance, reference merchant
// ─────────────────────────────────────────────────────────────────────────────

export const MERCHANT_REGISTRY = [
  {
    // ── Profile: HEALTHY — all green, all happy paths pass
    id: "M001",
    first_name: "Kevin", middle_name: "Kithinji", last_name: "Njoroge",
    date_of_birth: "1990-03-15", gender: "Male",
    nationality: "Kenyan", document_type: "National ID", document_number: "34521987",
    phone_number: "0704737162", email: "kevin.njoroge@email.com",
    county: "Nairobi", city: "Nairobi", physical_address: "Roysambu, Nairobi",
    postal_address: "110", postal_code: "00100",
    business_name: "Njoroge General Store", business_category: "Retail",
    business_region: "Nairobi", paybill: "174379",
    kra_pin: "A0098499583", certificate_number: "CRT99593",
    product: "Short Term Paybill", duration: "6 months", application_status: "approved",
    bank: "Equity Bank", bank_branch: "Kasarani", bank_branch_code: "93884",
    bank_account_name: "Njoroge Store", bank_account: "0110399405862",
    source_of_funds: "Business income", purpose_of_funds: "Business operations",
    expected_turnover: "KES 500,000",
    // Sensors — all green
    account_status: "active", kyc_status: "verified", kyc_age_days: 180,
    sim_status: "active", sim_swap_days_ago: null,
    pin_attempts: 0, pin_locked: false,
    start_key_status: "valid", balance: 87450.50,
    dormant_days: 2, notifications_enabled: true,
    settlement_on_hold: false, operator_dormant_days: 2,
    avatar: "🛒", color: "#00a651",
  },
  {
    // ── Profile: MULTI-FAILURE — worst-case, triggers almost every rule
    id: "M002",
    first_name: "Amara", middle_name: "Wanjiku", last_name: "Kamau",
    date_of_birth: "1985-07-22", gender: "Female",
    nationality: "Kenyan", document_type: "National ID", document_number: "22145678",
    phone_number: "0711234567", email: "amara.kamau@email.com",
    county: "Kiambu", city: "Thika", physical_address: "Thika Town, Kiambu",
    postal_address: "45", postal_code: "01000",
    business_name: "Kamau Hardware & Supplies", business_category: "Hardware",
    business_region: "Central", paybill: "522533",
    kra_pin: "B0087654321", certificate_number: "CRT44123",
    product: "Short Term Paybill", duration: "6 months", application_status: "suspended",
    bank: "KCB Bank", bank_branch: "Thika", bank_branch_code: "12345",
    bank_account_name: "Kamau Hardware", bank_account: "1234567890123",
    source_of_funds: "Business income", purpose_of_funds: "Business operations",
    expected_turnover: "KES 200,000",
    // Sensors — multi-failure
    account_status: "suspended", kyc_status: "expired", kyc_age_days: 420,
    sim_status: "swapped", sim_swap_days_ago: 5,
    pin_attempts: 3, pin_locked: true,
    start_key_status: "invalid", balance: 32100.00,
    dormant_days: 60, notifications_enabled: false,
    settlement_on_hold: true, operator_dormant_days: 62,
    avatar: "🔧", color: "#e8521a",
  },
  {
    // ── Profile: PARTIAL — active but several sensors amber
    id: "M003",
    first_name: "Fatuma", middle_name: "Akinyi", last_name: "Odhiambo",
    date_of_birth: "1993-11-08", gender: "Female",
    nationality: "Kenyan", document_type: "National ID", document_number: "45678901",
    phone_number: "0722345678", email: "fatuma.odhiambo@email.com",
    county: "Kisumu", city: "Kisumu", physical_address: "Milimani, Kisumu",
    postal_address: "88", postal_code: "40100",
    business_name: "Fatuma Beauty & Salon", business_category: "Services",
    business_region: "Nyanza", paybill: "700234",
    kra_pin: "C0076543210", certificate_number: "CRT77890",
    product: "Short Term Paybill", duration: "6 months", application_status: "pending",
    bank: "Cooperative Bank", bank_branch: "Kisumu", bank_branch_code: "44455",
    bank_account_name: "Fatuma Salon", bank_account: "9876543210987",
    source_of_funds: "Business income", purpose_of_funds: "Salon operations",
    expected_turnover: "KES 150,000",
    // Sensors — amber
    account_status: "active", kyc_status: "pending", kyc_age_days: 15,
    sim_status: "active", sim_swap_days_ago: null,
    pin_attempts: 2, pin_locked: false,
    start_key_status: "valid", balance: 5600.25,
    dormant_days: 0, notifications_enabled: true,
    settlement_on_hold: false, operator_dormant_days: 0,
    avatar: "💇", color: "#be123c",
  },
  {
    // ── Profile: FROZEN + DORMANT — compliance hold + expired start key
    id: "M004",
    first_name: "Brian", middle_name: "Kipchoge", last_name: "Rotich",
    date_of_birth: "1988-05-30", gender: "Male",
    nationality: "Kenyan", document_type: "National ID", document_number: "56789012",
    phone_number: "0733456789", email: "brian.rotich@email.com",
    county: "Uasin Gishu", city: "Eldoret", physical_address: "Huruma Estate, Eldoret",
    postal_address: "200", postal_code: "30100",
    business_name: "Rotich Electronics Hub", business_category: "Electronics",
    business_region: "Rift Valley", paybill: "303030",
    kra_pin: "D0065432109", certificate_number: "CRT55678",
    product: "Short Term Paybill", duration: "6 months", application_status: "frozen",
    bank: "Absa Bank", bank_branch: "Eldoret", bank_branch_code: "77766",
    bank_account_name: "Rotich Electronics", bank_account: "0987654321098",
    source_of_funds: "Business income", purpose_of_funds: "Electronics retail",
    expected_turnover: "KES 1,200,000",
    // Sensors — critical
    account_status: "frozen", kyc_status: "verified", kyc_age_days: 390,
    sim_status: "active", sim_swap_days_ago: null,
    pin_attempts: 0, pin_locked: false,
    start_key_status: "expired", balance: 234500.00,
    dormant_days: 95, notifications_enabled: true,
    settlement_on_hold: true, operator_dormant_days: 95,
    avatar: "📱", color: "#6b21a8",
  },
  {
    // ── Profile: CLEAN ACTIVE — high-volume merchant, reference case
    id: "M005",
    first_name: "Grace", middle_name: "Muthoni", last_name: "Waweru",
    date_of_birth: "1995-02-14", gender: "Female",
    nationality: "Kenyan", document_type: "National ID", document_number: "67890123",
    phone_number: "0744567890", email: "grace.waweru@email.com",
    county: "Nakuru", city: "Nakuru", physical_address: "Section 58, Nakuru",
    postal_address: "77", postal_code: "20100",
    business_name: "Waweru Fresh Groceries", business_category: "Grocery",
    business_region: "Rift Valley", paybill: "899573",
    kra_pin: "E0054321098", certificate_number: "CRT33456",
    product: "Short Term Paybill", duration: "6 months", application_status: "approved",
    bank: "NCBA Bank", bank_branch: "Nakuru", bank_branch_code: "55566",
    bank_account_name: "Waweru Groceries", bank_account: "1122334455667",
    source_of_funds: "Business income", purpose_of_funds: "Grocery operations",
    expected_turnover: "KES 800,000",
    // Sensors — all green
    account_status: "active", kyc_status: "verified", kyc_age_days: 90,
    sim_status: "active", sim_swap_days_ago: null,
    pin_attempts: 0, pin_locked: false,
    start_key_status: "valid", balance: 12300.75,
    dormant_days: 0, notifications_enabled: true,
    settlement_on_hold: false, operator_dormant_days: 0,
    avatar: "🥦", color: "#0ea5e9",
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — MERCHANT GENERATOR
// Generates random merchants with varied sensor states for stress testing.
// Uses weighted probability so failures are realistically distributed —
// not every field is bad, not every field is good.
// ─────────────────────────────────────────────────────────────────────────────

const FIRST_NAMES  = ["Wanjiru","Otieno","Mwangi","Achieng","Kamau","Njeri","Omondi","Mutua","Chebet","Wairimu","Kiptoo","Auma","Karanja","Adhiambo","Ndung'u","Moraa","Kiprotich","Nyambura","Odhiambo","Gathoni"];
const LAST_NAMES   = ["Njoroge","Kamau","Odhiambo","Rotich","Waweru","Kariuki","Otieno","Muthoni","Koech","Kimani","Akinyi","Wekesa","Gichuki","Simiyu","Muigai","Jeptoo","Muriithi","Onyango","Barasa","Kinyua"];
const BUSINESSES   = ["Supermarket","Hardware","Pharmacy","Electronics","Salon","Boutique","Bookshop","Restaurant","Bakery","Chemist","Agrovet","Butchery","Cybercafe","M-PESA Agent","Stationery"];
const COUNTIES     = ["Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Thika","Kiambu","Machakos","Nyeri","Meru"];
const BANKS        = ["Equity Bank","KCB Bank","Cooperative Bank","NCBA Bank","Absa Bank","Standard Chartered","DTB Bank","Family Bank","Prime Bank"];
const AVATARS      = ["🛒","🔧","💊","📱","💇","👗","📚","🍽️","🥐","💉","🌾","🥩","💻","📲","📎"];
const COLORS       = ["#00a651","#e8521a","#be123c","#6b21a8","#0ea5e9","#d97706","#059669","#dc2626","#7c3aed","#0284c7"];

// Weighted random pick — weight array must sum to 1
function weightedPick(options, weights) {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < options.length; i++) {
    sum += weights[i];
    if (r <= sum) return options[i];
  }
  return options[options.length - 1];
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randId() { return "GEN-" + Math.random().toString(36).slice(2, 7).toUpperCase(); }
function randPhone() { return "07" + randInt(10,99) + String(randInt(100000,999999)); }
function randPaybill() { return String(randInt(100000, 999999)); }
function randKRA() { return ["A","B","C","D","E"][randInt(0,4)] + String(randInt(1000000000,9999999999)); }
function randCert() { return "CRT" + randInt(10000,99999); }
function randAccount() { return String(randInt(1000000000000,9999999999999)); }
function randBranchCode() { return String(randInt(10000,99999)); }

export function generateMerchant(overrides = {}) {
  const idx = randInt(0, FIRST_NAMES.length - 1);
  const bizIdx = randInt(0, BUSINESSES.length - 1);
  const countyIdx = randInt(0, COUNTIES.length - 1);
  const bankIdx = randInt(0, BANKS.length - 1);
  const avatarIdx = randInt(0, AVATARS.length - 1);

  const firstName = FIRST_NAMES[idx];
  const lastName = LAST_NAMES[randInt(0, LAST_NAMES.length - 1)];

  // Sensor generation — weighted to reflect real-world distribution
  // (based on call center demand data Oct–Dec 2025)

  const account_status = weightedPick(
    ["active", "suspended", "frozen"],
    [0.65, 0.25, 0.10]   // 65% active, 25% suspended, 10% frozen
  );

  const kyc_status = weightedPick(
    ["verified", "pending", "expired"],
    [0.60, 0.20, 0.20]
  );

  const kyc_age_days = kyc_status === "expired"
    ? randInt(366, 500)
    : kyc_status === "pending"
    ? randInt(1, 30)
    : randInt(30, 364);

  const sim_status = weightedPick(
    ["active", "swapped", "unregistered"],
    [0.75, 0.20, 0.05]
  );

  const sim_swap_days_ago = sim_status === "swapped"
    ? randInt(1, 60)
    : null;

  const pin_attempts = weightedPick([0, 1, 2, 3], [0.55, 0.20, 0.15, 0.10]);
  const pin_locked = pin_attempts >= 3;

  const start_key_status = weightedPick(
    ["valid", "invalid", "expired"],
    [0.65, 0.20, 0.15]
  );

  const dormant_days = weightedPick(
    [randInt(0, 29), randInt(30, 59), randInt(60, 89), randInt(90, 150)],
    [0.55, 0.20, 0.15, 0.10]
  );

  const operator_dormant_days = Math.max(0, dormant_days + randInt(-10, 10));

  const balance = weightedPick(
    [0, randInt(100, 5000), randInt(5001, 50000), randInt(50001, 500000)],
    [0.05, 0.30, 0.45, 0.20]
  );

  const notifications_enabled = Math.random() > 0.20; // 80% have it on
  const settlement_on_hold = account_status !== "active" ? Math.random() > 0.40 : Math.random() > 0.90;

  const county = COUNTIES[countyIdx];
  const bank = BANKS[bankIdx];
  const bizType = BUSINESSES[bizIdx];

  return {
    id: randId(),
    first_name: firstName,
    middle_name: FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)],
    last_name: lastName,
    date_of_birth: `${randInt(1970, 2000)}-${String(randInt(1,12)).padStart(2,"0")}-${String(randInt(1,28)).padStart(2,"0")}`,
    gender: Math.random() > 0.5 ? "Male" : "Female",
    nationality: "Kenyan",
    document_type: "National ID",
    document_number: String(randInt(10000000, 99999999)),
    phone_number: randPhone(),
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
    county, city: county,
    physical_address: `${county} Town, ${county}`,
    postal_address: String(randInt(1, 999)),
    postal_code: String(randInt(10000, 99999)),
    business_name: `${lastName} ${bizType}`,
    business_category: bizType,
    business_region: county,
    paybill: randPaybill(),
    kra_pin: randKRA(),
    certificate_number: randCert(),
    product: "Short Term Paybill",
    duration: weightedPick(["3 months","6 months","12 months"], [0.20, 0.60, 0.20]),
    application_status: account_status === "active" ? "approved"
      : account_status === "suspended" ? "suspended" : "frozen",
    bank, bank_branch: county,
    bank_branch_code: randBranchCode(),
    bank_account_name: `${lastName} ${bizType}`,
    bank_account: randAccount(),
    source_of_funds: "Business income",
    purpose_of_funds: "Business operations",
    expected_turnover: `KES ${(randInt(50,2000) * 1000).toLocaleString()}`,
    // Sensors
    account_status, kyc_status, kyc_age_days,
    sim_status, sim_swap_days_ago,
    pin_attempts, pin_locked,
    start_key_status, balance, dormant_days,
    notifications_enabled, settlement_on_hold,
    operator_dormant_days,
    avatar: AVATARS[avatarIdx],
    color: COLORS[randInt(0, COLORS.length - 1)],
    // Mark as generated
    _generated: true,
    _generated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Generate a batch of N random merchants
export function generateMerchantBatch(n = 10) {
  return Array.from({ length: n }, () => generateMerchant());
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — STATE MUTATIONS
// Pure functions: take a merchant + parameters → return updated merchant copy.
// Never mutate directly — always return a new object.
// The twin loop calls these when real events occur.
// ─────────────────────────────────────────────────────────────────────────────

// Apply a SIM swap event
export function applySimSwap(merchant) {
  return {
    ...merchant,
    sim_status: "swapped",
    sim_swap_days_ago: 0,
    notifications_enabled: false,  // notifications break on swap
    _last_mutation: "SIM_SWAP",
    _mutated_at: new Date().toISOString(),
  };
}

// Record a failed PIN attempt (locks at 3)
export function applyPinAttempt(merchant) {
  const attempts = merchant.pin_attempts + 1;
  return {
    ...merchant,
    pin_attempts: attempts,
    pin_locked: attempts >= 3,
    _last_mutation: "PIN_ATTEMPT",
    _mutated_at: new Date().toISOString(),
  };
}

// Reset PIN (after shop visit)
export function applyPinReset(merchant) {
  return {
    ...merchant,
    pin_attempts: 0,
    pin_locked: false,
    _last_mutation: "PIN_RESET",
    _mutated_at: new Date().toISOString(),
  };
}

// Suspend account
export function applyAccountSuspend(merchant, reason = "MANUAL") {
  return {
    ...merchant,
    account_status: "suspended",
    settlement_on_hold: true,
    _last_mutation: "ACCOUNT_SUSPEND",
    _suspend_reason: reason,
    _mutated_at: new Date().toISOString(),
  };
}

// Reactivate account
export function applyAccountReactivate(merchant) {
  return {
    ...merchant,
    account_status: "active",
    settlement_on_hold: false,
    dormant_days: 0,
    operator_dormant_days: 0,
    _last_mutation: "ACCOUNT_REACTIVATE",
    _mutated_at: new Date().toISOString(),
  };
}

// Freeze account (compliance)
export function applyAccountFreeze(merchant) {
  return {
    ...merchant,
    account_status: "frozen",
    settlement_on_hold: true,
    _last_mutation: "ACCOUNT_FREEZE",
    _mutated_at: new Date().toISOString(),
  };
}

// KYC renewal
export function applyKycRenewal(merchant) {
  return {
    ...merchant,
    kyc_status: "pending",
    kyc_age_days: 0,
    _last_mutation: "KYC_RENEWAL",
    _mutated_at: new Date().toISOString(),
  };
}

// KYC approval
export function applyKycApproval(merchant) {
  return {
    ...merchant,
    kyc_status: "verified",
    kyc_age_days: 0,
    _last_mutation: "KYC_APPROVED",
    _mutated_at: new Date().toISOString(),
  };
}

// Advance time (age sensors by N days — for simulation tick)
export function advanceDays(merchant, days = 1) {
  const newKycAge = merchant.kyc_age_days + days;
  const newDormant = merchant.dormant_days + days;
  const newOpDormant = merchant.operator_dormant_days + days;
  const newSwapAge = merchant.sim_swap_days_ago !== null
    ? merchant.sim_swap_days_ago + days
    : null;

  // Auto-trigger state changes based on thresholds
  let updated = {
    ...merchant,
    kyc_age_days: newKycAge,
    dormant_days: newDormant,
    operator_dormant_days: newOpDormant,
    sim_swap_days_ago: newSwapAge,
    _last_mutation: "TIME_ADVANCE",
    _mutated_at: new Date().toISOString(),
  };

  // KYC expires at 365 days
  if (newKycAge >= 365 && merchant.kyc_status === "verified") {
    updated.kyc_status = "expired";
  }

  // Account suspends at 60 days dormant
  if (newDormant >= 60 && merchant.account_status === "active") {
    updated.account_status = "suspended";
    updated.settlement_on_hold = true;
  }

  // Start key expires after 18 months inactive (simulate via 540 days)
  if (newDormant >= 540 && merchant.start_key_status === "valid") {
    updated.start_key_status = "expired";
  }

  return updated;
}

// Record a successful transaction (resets dormancy)
export function applyTransaction(merchant, amount = 0) {
  return {
    ...merchant,
    balance: merchant.balance + amount,
    dormant_days: 0,
    operator_dormant_days: 0,
    _last_mutation: "TRANSACTION",
    _mutated_at: new Date().toISOString(),
  };
}

// Apply settlement (deduct balance)
export function applySettlement(merchant) {
  return {
    ...merchant,
    balance: 0,
    dormant_days: 0,
    _last_mutation: "SETTLEMENT",
    _mutated_at: new Date().toISOString(),
  };
}

// Reset start key
export function applyStartKeyReset(merchant) {
  return {
    ...merchant,
    start_key_status: "valid",
    _last_mutation: "START_KEY_RESET",
    _mutated_at: new Date().toISOString(),
  };
}

// Toggle notifications
export function applyNotificationToggle(merchant) {
  return {
    ...merchant,
    notifications_enabled: !merchant.notifications_enabled,
    _last_mutation: "NOTIF_TOGGLE",
    _mutated_at: new Date().toISOString(),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — UTILITIES
// Shared helpers used across Step 2 (rules) and Step 3 (simulator)
// ─────────────────────────────────────────────────────────────────────────────

// Format KES currency
export function formatKES(amount) {
  return "KES " + Number(amount).toLocaleString("en-KE", { minimumFractionDigits: 2 });
}

// Full merchant display name
export function merchantDisplayName(merchant) {
  return `${merchant.first_name} ${merchant.last_name}`;
}

// Get sensor health summary (counts of red / amber / green sensors)
export function getSensorHealth(merchant) {
  const red = [], amber = [], green = [];

  if (merchant.account_status !== "active") red.push("account_status");
  else green.push("account_status");

  if (merchant.kyc_status === "expired") red.push("kyc_status");
  else if (merchant.kyc_status === "pending") amber.push("kyc_status");
  else green.push("kyc_status");

  if (merchant.pin_locked) red.push("pin_locked");
  else if (merchant.pin_attempts >= 2) amber.push("pin_attempts");
  else green.push("pin_attempts");

  if (merchant.start_key_status !== "valid") red.push("start_key_status");
  else green.push("start_key_status");

  if (merchant.sim_status === "unregistered") red.push("sim_status");
  else if (merchant.sim_status === "swapped") amber.push("sim_status");
  else green.push("sim_status");

  if (merchant.dormant_days >= 60) red.push("dormant_days");
  else if (merchant.dormant_days >= 30) amber.push("dormant_days");
  else green.push("dormant_days");

  if (!merchant.notifications_enabled) amber.push("notifications");
  else green.push("notifications");

  if (merchant.settlement_on_hold) red.push("settlement_on_hold");
  else green.push("settlement_on_hold");

  if (merchant.operator_dormant_days >= 90) red.push("operator_dormant");
  else if (merchant.operator_dormant_days >= 60) amber.push("operator_dormant");
  else green.push("operator_dormant");

  return { red, amber, green, score: green.length / (red.length + amber.length + green.length) };
}

// Get overall risk tier
export function getRiskTier(merchant) {
  const { red, amber } = getSensorHealth(merchant);
  if (red.length >= 3 || merchant.account_status === "frozen") return "CRITICAL";
  if (red.length >= 1 || amber.length >= 3) return "HIGH";
  if (amber.length >= 1) return "MEDIUM";
  return "HEALTHY";
}

export const RISK_TIER_STYLE = {
  CRITICAL: { color: "#ef4444", bg: "#1f0000", label: "🔴 CRITICAL" },
  HIGH:     { color: "#f97316", bg: "#1f0a00", label: "🟠 HIGH" },
  MEDIUM:   { color: "#eab308", bg: "#1f1800", label: "🟡 MEDIUM" },
  HEALTHY:  { color: "#4ade80", bg: "#001408", label: "🟢 HEALTHY" },
};

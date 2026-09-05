import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList,
  Sankey, Rectangle, Layer
} from "recharts";
import Papa from "papaparse";
import {
  Plus, Trash2, Upload, TrendingUp, TrendingDown, Wallet, PiggyBank,
  LineChart as LineChartIcon, ArrowUpRight, ArrowDownRight, X, Download,
  ChevronRight, ChevronLeft, Circle, Shield, ShieldCheck, CalendarDays, AlertTriangle,
  Users, Info, CheckCircle2, Home, Gem, Building2, Landmark, Globe, Target, Flame, Snowflake, Mountain,
  Scroll, FileText, HeartHandshake, Scale, ClipboardCheck
} from "lucide-react";

/* ---------------------------------------------------------
   WEALTH VITALITY — local-first personal finance dashboard
   Design tokens:
   bg      #101820  (deep ink navy)
   surface #17212B  (panel)
   surface2 #1E2A38  (raised panel)
   line    #2A3949  (hairline)
   text    #EAE7E0  (paper)
   muted   #8A93A0  (slate)
   gold    #C9A227  (accent / vitality)
   green   #4FA37B  (positive)
   red     #C1554A  (negative)
   Display: Fraunces (serif, characterful) — headers, big numbers
   Body: Inter — UI text
   Mono: JetBrains Mono — all data/numbers in tables
--------------------------------------------------------- */

const FONTS_LINK = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

const LS_KEY = "wealth_vitality_data_v1";

const fmtTHB = (n) =>
  (n < 0 ? "-" : "") + "฿" + Math.abs(Math.round(n)).toLocaleString("en-US");

const fmtCompact = (n) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}฿${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}฿${(abs / 1e3).toFixed(0)}K`;
  return fmtTHB(n);
};

const uid = () => Math.random().toString(36).slice(2, 10);

// Extracts a numeric APR from strings like "3.2" or "MRR-1.5%" -> falls back to 0
const parseAPR = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.abs(n);
};

const DEBT_FREE_MONTH_NAMES = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const DEBT_SIM_MAX_MONTHS = 600; // 50 years — a hard cap for the simulation loop

/**
 * Simulates a debt payoff plan (snowball or avalanche) with a fixed total monthly
 * budget (sum of all minimum payments + extra payment). As each debt is cleared,
 * its minimum payment is automatically redirected to the next debt in priority order.
 * Supports per-debt interestType: "reducing" (ลดต้นลดดอก — interest on remaining balance,
 * the standard method) or "flat" (คงที่ — interest fixed on the original principal every month).
 */
function simulateDebtPayoff(liabilities, extraPayment, strategy) {
  const debts = liabilities
    .filter((l) => l.status !== "Closed" && l.status !== "Paid" && Number(l.currentBalance) > 0)
    .map((l) => ({
      id: l.id,
      name: l.name,
      balance: Number(l.currentBalance) || 0,
      originalAmount: Number(l.originalAmount || l.currentBalance) || 0,
      apr: parseAPR(l.interestRate),
      minPayment: Number(l.monthlyPayment) || 0,
      interestType: l.interestType === "flat" ? "flat" : "reducing",
    }));

  if (!debts.length) {
    return { months: 0, totalInterest: 0, schedule: [{ month: 0, balance: 0 }], payoffMonth: {}, feasible: true, order: [], capped: false };
  }

  const sortFn = strategy === "avalanche" ? (a, b) => b.apr - a.apr : (a, b) => a.balance - b.balance;
  const order = [...debts].sort(sortFn).map((d) => d.id);

  const totalBudget = debts.reduce((s, d) => s + d.minPayment, 0) + Number(extraPayment || 0);
  const totalStartBalance = debts.reduce((s, d) => s + d.balance, 0);
  const schedule = [{ month: 0, balance: totalStartBalance }];
  const payoffMonth = {};
  let totalInterest = 0;
  let month = 0;

  const monthlyInterestOf = (d) => (d.interestType === "flat" ? d.originalAmount * (d.apr / 100 / 12) : d.balance * (d.apr / 100 / 12));

  // Feasibility check: budget must cover at least this month's interest, otherwise balance never shrinks
  const firstMonthInterest = debts.reduce((s, d) => s + monthlyInterestOf(d), 0);
  const feasible = totalBudget > firstMonthInterest || firstMonthInterest === 0;

  while (debts.some((d) => d.balance > 0.5) && month < DEBT_SIM_MAX_MONTHS) {
    month++;
    debts.forEach((d) => {
      if (d.balance > 0) {
        const interest = monthlyInterestOf(d);
        d.balance += interest;
        totalInterest += interest;
      }
    });

    let remaining = totalBudget;
    debts.forEach((d) => {
      if (d.balance > 0) {
        const pay = Math.min(d.minPayment, d.balance);
        d.balance -= pay;
        remaining -= pay;
        if (d.balance <= 0.5 && !payoffMonth[d.id]) payoffMonth[d.id] = month;
      }
    });

    const active = debts.filter((d) => d.balance > 0.5).sort(sortFn);
    for (const d of active) {
      if (remaining <= 0) break;
      const pay = Math.min(remaining, d.balance);
      d.balance -= pay;
      remaining -= pay;
      if (d.balance <= 0.5 && !payoffMonth[d.id]) payoffMonth[d.id] = month;
    }

    schedule.push({ month, balance: Math.max(debts.reduce((s, d) => s + Math.max(d.balance, 0), 0), 0) });
    if (!feasible && month >= 24) break; // stop early if plan clearly can't pay down principal
  }

  const capped = month >= DEBT_SIM_MAX_MONTHS && debts.some((d) => d.balance > 0.5);
  return { months: month, totalInterest, schedule, payoffMonth, feasible, order, capped };
}

// Extracts a 4-digit year from a free-text birth date (e.g. "15/03/2533") and computes age,
// respecting the explicit AD/BE toggle. Falls back to legacy birthYear field if no date given.
function calcAgeFromBirthDate(birthDate, calendarSystem, fallbackBirthYear) {
  const str = String(birthDate ?? "").trim();
  const toAdYear = (y) => (calendarSystem === "be" ? y - 543 : y);
  const ageFromExactDate = (adYear, month1to12, day) => {
    const bDate = new Date(adYear, month1to12 - 1, day);
    const today = new Date();
    let age = today.getFullYear() - bDate.getFullYear();
    const hadBirthdayThisYear =
      today.getMonth() > bDate.getMonth() || (today.getMonth() === bDate.getMonth() && today.getDate() >= bDate.getDate());
    if (!hadBirthdayThisYear) age--;
    return age >= 0 && age < 130 ? age : null;
  };

  // DD/MM/YYYY or D-M-YYYY etc.
  let m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const age = ageFromExactDate(toAdYear(parseInt(m[3], 10)), parseInt(m[2], 10), parseInt(m[1], 10));
    if (age !== null) return age;
  }
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const age = ageFromExactDate(toAdYear(parseInt(m[1], 10)), parseInt(m[2], 10), parseInt(m[3], 10));
    if (age !== null) return age;
  }
  // Fall back to year-only (±1 year imprecision, since exact birth month/day is unknown)
  const yearOnly = str.match(/(\d{4})/);
  if (yearOnly) {
    const n = parseInt(yearOnly[1], 10);
    const adYear = toAdYear(n);
    const age = new Date().getFullYear() - adYear;
    if (age >= 0 && age < 130) return age;
  }
  return calcAge(fallbackBirthYear);
}

function addMonthsToDate(baseDate, months) {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + months);
  return d;
}

// year: "be" (พ.ศ., default for Thai UI) or "ad" (ค.ศ.)
function formatDebtFreeDate(months, { capped = false, feasible = true, yearSystem = "be" } = {}) {
  if (!months) return "ปลอดหนี้แล้ว";
  if (capped || !feasible || months >= DEBT_SIM_MAX_MONTHS) return "เกิน 50 ปี — ควรเพิ่มเงินโปะ";
  const d = addMonthsToDate(new Date(), months);
  const year = yearSystem === "ad" ? d.getFullYear() : d.getFullYear() + 543;
  const yearLabel = yearSystem === "ad" ? "ค.ศ." : "พ.ศ.";
  return `${DEBT_FREE_MONTH_NAMES[d.getMonth()]} ${year} (${yearLabel})`;
}

/**
 * Estimates remaining installments and payoff date for a SINGLE debt using only its
 * own minimum payment (no pooled extra payment) — a standalone amortization estimate,
 * used to auto-fill "วันที่ครบกำหนด" when the user hasn't entered one.
 */
function estimateStandalonepayoff(liability) {
  const balance = Number(liability.currentBalance || 0);
  const payment = Number(liability.monthlyPayment || 0);
  const apr = parseAPR(liability.interestRate);
  const original = Number(liability.originalAmount || liability.currentBalance || 0);
  if (balance <= 0) return { months: 0, date: null, feasible: true };
  if (payment <= 0) return { months: null, date: null, feasible: false };

  let months;
  if (liability.interestType === "flat") {
    const flatInterest = original * (apr / 100 / 12);
    const principalPortion = payment - flatInterest;
    if (principalPortion <= 0) return { months: null, date: null, feasible: false };
    months = Math.ceil(balance / principalPortion);
  } else {
    const r = apr / 100 / 12;
    if (r === 0) {
      months = Math.ceil(balance / payment);
    } else {
      const monthlyInterest = balance * r;
      if (payment <= monthlyInterest) return { months: null, date: null, feasible: false };
      months = Math.ceil(Math.log(payment / (payment - monthlyInterest)) / Math.log(1 + r));
    }
  }
  if (months > DEBT_SIM_MAX_MONTHS) return { months: null, date: null, feasible: false };
  return { months, date: addMonthsToDate(new Date(), months), feasible: true };
}

const MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_TH = { Jan: "ม.ค.", Feb: "ก.พ.", Mar: "มี.ค.", Apr: "เม.ย.", May: "พ.ค.", Jun: "มิ.ย.", Jul: "ก.ค.", Aug: "ส.ค.", Sep: "ก.ย.", Oct: "ต.ค.", Nov: "พ.ย.", Dec: "ธ.ค." };
const PIE_COLORS_CF = ["#C9A227", "#8A6FBF", "#5B84B1", "#4FA37B", "#C1554A", "#3FA7A0", "#B0885A", "#7E9CD8", "#D98E73", "#6FBF9E"];

const RELATIONSHIP_OPTIONS = ["Primary Member", "คู่สมรส", "พ่อแม่", "ลูก", "พี่น้อง", "ญาติ", "อื่นๆ"];
const GENDER_OPTIONS = ["ชาย", "หญิง", "อื่นๆ"];
const MARITAL_STATUS_OPTIONS = ["โสด", "สมรสจดทะเบียน", "สมรสไม่จดทะเบียน", "หย่า"];
const GENERATIONS = {
  G1: { label: "G1 — ผู้ก่อตั้ง", color: "#C9A227" },
  G2: { label: "G2 — รุ่นทายาท", color: "#5B84B1" },
  G3: { label: "G3 — รุ่นหลาน", color: "#8A6FBF" },
  G4: { label: "G4 — รุ่นเหลน", color: "#4FA37B" },
};

const CASHIN_CATEGORIES = [
  { key: "เงินเดือน", emoji: "💼" },
  { key: "รายได้ธุรกิจ", emoji: "🏢" },
  { key: "เงินปันผล", emoji: "📈" },
  { key: "ดอกเบี้ย", emoji: "💰" },
  { key: "ค่าเช่า", emoji: "🏠" },
  { key: "กำไรจากการขายสินทรัพย์", emoji: "📊" },
  { key: "ค่าลิขสิทธิ์/ค่าที่ปรึกษา", emoji: "📝" },
  { key: "เงินคืนภาษี", emoji: "🧾" },
  { key: "เงินจากทรัสต์/กองมรดก", emoji: "🏛️" },
  { key: "ของขวัญ/มรดกที่ได้รับ", emoji: "🎁" },
  { key: "เงินกู้ยืมที่ได้รับ", emoji: "🤝" },
  { key: "อื่นๆ", emoji: "✨" },
];
const CASHOUT_CATEGORIES = [
  { key: "ที่อยู่อาศัย", emoji: "🏠", label: "Housing" },
  { key: "สาธารณูปโภค", emoji: "💡", label: "Utilities" },
  { key: "อาหาร", emoji: "🍽️", label: "Food & Dining" },
  { key: "การเดินทาง", emoji: "🚗", label: "Transportation" },
  { key: "สุขภาพ/การแพทย์", emoji: "🏥", label: "Healthcare" },
  { key: "การศึกษา", emoji: "🎓", label: "Education" },
  { key: "ช้อปปิ้ง/เสื้อผ้า", emoji: "🛍️", label: "Shopping" },
  { key: "บันเทิง/พักผ่อน", emoji: "🎬", label: "Entertainment" },
  { key: "ท่องเที่ยว", emoji: "✈️", label: "Travel" },
  { key: "ดูแลส่วนตัว", emoji: "💆", label: "Personal Care" },
  { key: "สมาชิก/Subscription", emoji: "📱", label: "Subscriptions" },
  { key: "สนับสนุนครอบครัว", emoji: "👨‍👩‍👧", label: "Family Support" },
  { key: "บริจาค/การกุศล", emoji: "🤲", label: "Charity" },
  { key: "ค่าธรรมเนียมวิชาชีพ", emoji: "⚖️", label: "Professional Fees" },
  { key: "ค่าใช้จ่ายธุรกิจ", emoji: "🏢", label: "Business Expense" },
  { key: "ชำระหนี้", emoji: "🔥", label: "Debt Payment" },
  { key: "ลงทุน", emoji: "📈", label: "Investment" },
  { key: "ประกัน", emoji: "🛡️", label: "Insurance" },
  { key: "ภาษี", emoji: "🏛️", label: "Tax" },
  { key: "ค่าใช้จ่ายประจำวัน", emoji: "🧺", label: "Living Expenses (ทั่วไป)" },
  { key: "อื่นๆ", emoji: "🛒", label: "Other" },
];
// Categories where cash leaves the account but net worth is unaffected (it becomes an asset, or reduces a matching liability)
const NET_WORTH_NEUTRAL_FLOW_CATEGORIES = ["ลงทุน", "ชำระหนี้"];
// Used for the Annual Summary — splits expense flow categories into fixed (recurring, contractual) vs variable (discretionary).
// Anything not listed here defaults to Variable and can be overridden per-category in the CASH OUT breakdown.
const FIXED_EXPENSE_FLOW_CATEGORIES = ["ชำระหนี้", "ประกัน", "ภาษี", "ที่อยู่อาศัย", "การศึกษา", "สมาชิก/Subscription"];
const VARIABLE_EXPENSE_FLOW_CATEGORIES = [
  "สาธารณูปโภค", "อาหาร", "การเดินทาง", "สุขภาพ/การแพทย์", "ช้อปปิ้ง/เสื้อผ้า", "บันเทิง/พักผ่อน",
  "ท่องเที่ยว", "ดูแลส่วนตัว", "สนับสนุนครอบครัว", "บริจาค/การกุศล", "ค่าธรรมเนียมวิชาชีพ",
  "ค่าใช้จ่ายธุรกิจ", "ค่าใช้จ่ายประจำวัน", "อื่นๆ",
];
// A transaction's fixed/variable classification: a user-set override for its flowCategory wins (set via the CASH OUT
// breakdown in the กระแสเงินสด tab), otherwise falls back to the flowCategory's default bucket
function isFixedExpenseTx(t, categoryOverrides = {}) {
  if (t.flowCategory && categoryOverrides[t.flowCategory]) return categoryOverrides[t.flowCategory] === "fixed";
  return FIXED_EXPENSE_FLOW_CATEGORIES.includes(t.flowCategory);
}

function flowCategoryEmoji(list, key) {
  return (list.find((c) => c.key === key) || {}).emoji || "•";
}

const FAMILY_ROLES = {
  admin: { emoji: "👑", label: "Family Administrator", sublabel: "ผู้จัดการข้อมูล Family Office", color: "#C9A227" },
  financial: { emoji: "💰", label: "Financial Decision Maker", sublabel: "ผู้ตัดสินใจเรื่องการเงิน", color: "#4FA37B" },
  member: { emoji: "👤", label: "Family Member", sublabel: "สมาชิกทั่วไป", color: "#5B84B1" },
  dependent: { emoji: "👶", label: "Dependent", sublabel: "ผู้พึ่งพิง", color: "#8A6FBF" },
  viewer: { emoji: "👁", label: "Viewer", sublabel: "ดูข้อมูลอย่างเดียว", color: "#8A93A0" },
};

// Accepts a birth year in either AD or BE (Buddhist Era, > 2400) and returns current age
function calcAge(birthYearRaw) {
  const n = parseInt(String(birthYearRaw ?? "").replace(/[^0-9]/g, ""), 10);
  if (!n || n < 1900) return null;
  const adYear = n > 2400 ? n - 543 : n;
  const age = new Date().getFullYear() - adYear;
  return age >= 0 && age < 130 ? age : null;
}

// Given a stock/fund with optional lot-level purchase history, returns the effective units + weighted-average
// cost — computed from remaining (unsold) lots when lots exist, otherwise falls back to the item's own
// units/avgPrice fields (so items without lot tracking keep working exactly as before).
function holdingFromLots(item) {
  const lots = item.lots || [];
  if (!lots.length) return { units: Number(item.units || 0), avgPrice: Number(item.avgPrice || 0) };
  let units = 0;
  let cost = 0;
  lots.forEach((l) => {
    const remaining = Number(l.remainingUnits ?? l.units ?? 0);
    units += remaining;
    cost += remaining * Number(l.pricePerUnit || 0);
  });
  return { units, avgPrice: units > 0 ? cost / units : 0 };
}

// FIFO sale: consumes the oldest lots first for the requested unitsSold, returns the updated lots array,
// the cost basis of the units sold, and a breakdown of which lots were consumed (for the sale record).
function sellFIFO(lots, unitsSold) {
  const sorted = [...lots].sort((a, b) => new Date(a.date) - new Date(b.date));
  let remaining = unitsSold;
  let costBasis = 0;
  const consumed = [];
  const updated = sorted.map((l) => {
    const lotRemaining = Number(l.remainingUnits ?? l.units ?? 0);
    if (remaining <= 0 || lotRemaining <= 0) return l;
    const take = Math.min(remaining, lotRemaining);
    costBasis += take * Number(l.pricePerUnit || 0);
    consumed.push({ lotId: l.id, unitsFromLot: take, costPerUnit: Number(l.pricePerUnit || 0) });
    remaining -= take;
    return { ...l, remainingUnits: lotRemaining - take };
  });
  return { updatedLots: updated, costBasis, consumed, shortfall: Math.max(remaining, 0) };
}


const todayStr = () => new Date().toISOString().slice(0, 10);

// XIRR — money-weighted annualized return from irregular-dated cash flows (Newton-Raphson with bisection fallback).
// cashflows: [{date: Date, amount: number}] — negative = money out (invested), positive = money in (returned)
function calcXIRR(cashflows) {
  const flows = cashflows.filter((cf) => cf.date && Number.isFinite(cf.amount)).sort((a, b) => a.date - b.date);
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const d0 = flows[0].date;
  const npv = (rate) =>
    flows.reduce((sum, cf) => {
      const days = (cf.date - d0) / (1000 * 60 * 60 * 24);
      return sum + cf.amount / Math.pow(1 + rate, days / 365);
    }, 0);

  // Tolerance scales with the size of the cash flows — a fixed "$1" tolerance is meaningless when flows are
  // in the hundreds of thousands, and can let bisection/Newton settle on a rate that's numerically "close to
  // zero NPV" but economically nonsensical (a false root).
  const scale = flows.reduce((s, f) => s + Math.abs(f.amount), 0) || 1;
  const tol = scale * 1e-7;

  // Bisection first — for a monotonic NPV curve (the normal case: outflows then inflows) this is guaranteed
  // to converge to the one real root within the bounds, unlike Newton-Raphson which can jump to a false root
  // when the cash flow pattern is irregular (e.g. several outflows clustered right before a single terminal inflow).
  let lo = -0.99,
    hi = 10;
  let rate = null;
  if (npv(lo) * npv(hi) <= 0) {
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const v = npv(mid);
      if (Math.abs(v) < tol) {
        rate = mid;
        break;
      }
      if (npv(lo) * v < 0) hi = mid;
      else lo = mid;
    }
    if (rate === null) rate = (lo + hi) / 2;
  }

  // Polish with a few Newton-Raphson steps from the bisection result (or from 0.1 if bisection found no sign
  // change at all) — but only accept the refined value if it actually improves on (or matches) the bisection answer.
  let refined = rate !== null ? rate : 0.1;
  for (let i = 0; i < 20; i++) {
    const f = npv(refined);
    const df = (npv(refined + 1e-6) - f) / 1e-6;
    if (Math.abs(df) < 1e-9) break;
    const next = refined - f / df;
    if (!Number.isFinite(next) || next < -0.999) break;
    if (Math.abs(next - refined) < 1e-9) {
      refined = next;
      break;
    }
    refined = next;
  }
  if (Number.isFinite(refined) && Math.abs(npv(refined)) < tol) rate = refined;

  return rate;
}

const monthLabel = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
};

/* ---------------- default seed data ---------------- */
const seedData = () => ({
  assets: [],
  liabilities: [
    {
      id: uid(), name: "สินเชื่อบ้าน", lender: "ธนาคารกสิกรไทย", category: "บ้าน",
      originalAmount: 3000000, currentBalance: 2100000, interestRate: "3.2",
      monthlyPayment: 22000, startDate: "2021-04-01", termMonths: 240, endYear: "2041",
      mrtaInsurance: "", notes: "", nextPaymentDate: "", status: "Active", interestType: "reducing", borrower: "", hasCollateral: "", collateralAsset: "",
    },
  ],
  debtSettings: { strategy: "snowball", extraPayment: 0 },
  cashAccounts: [
    { id: uid(), name: "TTB", subCategory: "Cash", amount: 250000, currency: "THB", fxToThb: 1, yieldPct: 0 },
    { id: uid(), name: "KBANK", subCategory: "Cash", amount: 76737, currency: "THB", fxToThb: 1, yieldPct: 0 },
    { id: uid(), name: "KTB Global", subCategory: "Savings", amount: 2529.58, currency: "USD", fxToThb: 33.15, yieldPct: 2.25 },
    { id: uid(), name: "KTB Global", subCategory: "Savings (JPY)", amount: 1068822, currency: "JPY", fxToThb: 0.228, yieldPct: 0 },
  ],
  domesticFunds: [
    { id: uid(), name: "KFUSIndex", symbol: "KFUSINDFXRMF", subCategory: "Retirement Funds", units: 4198.66, avgPrice: 9.65, currentPrice: 12.89, dividendYr: 0, dcaMonth: 0, targetPct: 3 },
    { id: uid(), name: "Gold -RMF-A", symbol: "GOLD-RMF-A", subCategory: "Retirement Funds", units: 1342.03, avgPrice: 24.22, currentPrice: 24.21, dividendYr: 0, dcaMonth: 0, targetPct: 3 },
    { id: uid(), name: "EastspringUS500", symbol: "ES-US500RMF", subCategory: "Retirement Funds", units: 1074.88, avgPrice: 26.05, currentPrice: 41.33, dividendYr: 0, dcaMonth: 0, targetPct: 3 },
    { id: uid(), name: "One Global equity", symbol: "ONE-UGERMF-A", subCategory: "Retirement Funds", units: 2707.47, avgPrice: 19.94, currentPrice: 18.25, dividendYr: 0, dcaMonth: 0, targetPct: 1 },
    { id: uid(), name: "ES-China Op", symbol: "ES-CORMF", subCategory: "Retirement Funds", units: 2979.46, avgPrice: 17.79, currentPrice: 11.76, dividendYr: 0, dcaMonth: 0, targetPct: 1 },
    { id: uid(), name: "ES-GOLDSRMF", symbol: "ES-GOLDSRMF", subCategory: "Retirement Funds", units: 9145.87, avgPrice: 20.48, currentPrice: 20.83, dividendYr: 0, dcaMonth: 5000, targetPct: 7 },
    { id: uid(), name: "ES-US500RMF", symbol: "ES-US500RMF", subCategory: "Retirement Funds", units: 19567.84, avgPrice: 34.02, currentPrice: 40.41, dividendYr: 0, dcaMonth: 20000, targetPct: 50 },
    { id: uid(), name: "ES-US500", symbol: "ES-US500RMF", subCategory: "Mutual Funds", units: 5364.45, avgPrice: 42.23, currentPrice: 44.41, dividendYr: 0, dcaMonth: 23400, targetPct: 15 },
    { id: uid(), name: "ES-GQG", symbol: "ES-GQG", subCategory: "Mutual Funds", units: 4314.96, avgPrice: 24.02, currentPrice: 25.22, dividendYr: 0, dcaMonth: 7200, targetPct: 7 },
    { id: uid(), name: "ES-GINFRA-A", symbol: "ES-GINFRA-A", subCategory: "Mutual Funds", units: 4008.62, avgPrice: 17.85, currentPrice: 18.52, dividendYr: 0, dcaMonth: 5400, targetPct: 5 },
  ],
  offshoreStocks: [
    { id: uid(), name: "Vanguard S&P 500", symbol: "VOO", subCategory: "Stocks", units: 95.49, avgPrice: 599.3, currentPrice: 704.2, dividendYr: 644.58, dcaMonth: 0, targetPct: 30, lots: [], sales: [] },
    { id: uid(), name: "Microsoft", symbol: "MSFT", subCategory: "Stocks", units: 100, avgPrice: 396.68, currentPrice: 496.37, dividendYr: 728, dcaMonth: 0, targetPct: 15, lots: [], sales: [] },
    { id: uid(), name: "Ast Spacemobile", symbol: "ASTS", subCategory: "Stocks", units: 300, avgPrice: 81.67, currentPrice: 59.88, dividendYr: 707.2, dcaMonth: 0, targetPct: 5, lots: [], sales: [] },
    { id: uid(), name: "Broadcom", symbol: "AVGO", subCategory: "Stocks", units: 155.06, avgPrice: 321.53, currentPrice: 355.59, dividendYr: 221.15, dcaMonth: 0, targetPct: 10, lots: [], sales: [] },
    { id: uid(), name: "Alphabet Inc Class A", symbol: "GOOG", subCategory: "Stocks", units: 165.15, avgPrice: 304.51, currentPrice: 342, dividendYr: 44.13, dcaMonth: 0, targetPct: 10, lots: [], sales: [] },
    { id: uid(), name: "Rocket Lab USA", symbol: "RKLB", subCategory: "Stocks", units: 230, avgPrice: 54.18, currentPrice: 66.18, dividendYr: 0, dcaMonth: 0, targetPct: 6, lots: [], sales: [] },
    { id: uid(), name: "Intuitive Machines", symbol: "LUNR", subCategory: "Stocks", units: 400, avgPrice: 19.92, currentPrice: 16.11, dividendYr: 0, dcaMonth: 0, targetPct: 2.28, lots: [], sales: [] },
    { id: uid(), name: "EOS Energy", symbol: "EOSE", subCategory: "Stocks", units: 1550, avgPrice: 5.08, currentPrice: 3.34, dividendYr: 0, dcaMonth: 0, targetPct: 1, lots: [], sales: [] },
    { id: uid(), name: "Redwire", symbol: "RDW", subCategory: "Stocks", units: 60, avgPrice: 9.73, currentPrice: 11.27, dividendYr: 0, dcaMonth: 0, targetPct: 0.5, lots: [], sales: [] },
    { id: uid(), name: "Archer Aviation", symbol: "ACHR", subCategory: "Stocks", units: 1500, avgPrice: 8.7, currentPrice: 5.9, dividendYr: 0, dcaMonth: 0, targetPct: 2, lots: [], sales: [] },
  ],
  realEstate: [
    { id: uid(), name: "Home", subCategory: "Residential", purchasePrice: 3800000, currentValue: 3800000, rentalIncomeYr: 0 },
    { id: uid(), name: "Land", subCategory: "Land", purchasePrice: 4411500, currentValue: 4600000, rentalIncomeYr: 0 },
  ],
  preciousMetals: [
    { id: uid(), name: "Gold", subCategory: "Gold", qty: 3, avgCost: 38000, marketPrice: 70000 },
  ],
  businessEquity: [
    { id: uid(), name: "คลินิกแพทย์ศิริพงษ์", subCategory: "คลินิก", ownershipPct: 100, avgCost: 3500000, currentValue: 3500000, dividendYr: 0 },
    { id: uid(), name: "Wellvera", subCategory: "Startup Shares", ownershipPct: 80, avgCost: 850000, currentValue: 850000, dividendYr: 0 },
    { id: uid(), name: "NFW Global trading", subCategory: "Private Equity", ownershipPct: 15, avgCost: 500000, currentValue: 500000, dividendYr: 0 },
  ],
  portfolioSettings: { netWorthGoal: 65000000, usdThbRate: 33.15, stockApiKey: "" },
  transactions: (() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const d = (day) => new Date(y, m, Math.min(day, 27)).toISOString().slice(0, 10);
    return [
      { id: uid(), date: d(30), type: "รายรับ", flowCategory: "เงินเดือน", category: "เงินเดือนประจำ", amount: 150000, note: "" },
      { id: uid(), date: d(20), type: "รายรับ", flowCategory: "รายได้ธุรกิจ", category: "รายได้คลินิก", amount: 100000, note: "" },
      { id: uid(), date: d(15), type: "รายรับ", flowCategory: "เงินปันผล", category: "ปันผลหุ้น", amount: 80000, note: "" },
      { id: uid(), date: d(3), type: "รายรับ", flowCategory: "ค่าเช่า", category: "ค่าเช่าอาคาร", amount: 50000, note: "" },
      { id: uid(), date: d(8), type: "รายรับ", flowCategory: "ดอกเบี้ย", category: "ดอกเบี้ยเงินฝาก", amount: 20000, note: "" },
      { id: uid(), date: d(12), type: "รายรับ", flowCategory: "อื่นๆ", category: "รายได้อื่นๆ", amount: 50000, note: "" },
      { id: uid(), date: d(2), type: "รายจ่าย", flowCategory: "ค่าใช้จ่ายประจำวัน", category: "ค่าใช้จ่ายบ้าน", amount: 120000, note: "" },
      { id: uid(), date: d(5), type: "รายจ่าย", flowCategory: "ชำระหนี้", category: "ผ่อนบ้าน", amount: 50000, note: "" },
      { id: uid(), date: d(18), type: "เงินออม", flowCategory: "ลงทุน", category: "DCA กองทุน", amount: 80000, note: "" },
      { id: uid(), date: d(10), type: "รายจ่าย", flowCategory: "ประกัน", category: "เบี้ยประกัน", amount: 20000, note: "" },
      { id: uid(), date: d(25), type: "รายจ่าย", flowCategory: "ภาษี", category: "ภาษีเงินได้", amount: 30000, note: "" },
      { id: uid(), date: d(22), type: "รายจ่าย", flowCategory: "อื่นๆ", category: "ค่าใช้จ่ายเบ็ดเตล็ด", amount: 20000, note: "" },
    ];
  })(),
  cashflowPlan: { เงินเข้า: 500000, ค่าใช้จ่าย: 200000, ชำระหนี้: 50000, ลงทุน: 100000 },
  cashflowSettings: { openingCashOverrides: {}, minCashBuffer: 500000, categoryExpenseType: {} },
  netWorthHistory: Array.from({ length: 6 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return { date: d.toISOString().slice(0, 10), value: 2600000 + i * 130000 + (i % 2 === 0 ? 40000 : -20000) };
  }),
  // Yearly snapshots (พ.ศ.) for long-term growth comparison — from the user's own historical tracking sheet
  netWorthSnapshots: [
    { id: uid(), year: 2567, totalAssets: 7794538, totalLiabilities: 9015161 },
    { id: uid(), year: 2568, totalAssets: 10375401, totalLiabilities: 8214141 },
    { id: uid(), year: 2569, totalAssets: 15724773, totalLiabilities: 6638763 },
  ],
  // FX remittance log for offshore investment tax tracking (เงินโอนเข้า-ออกต่างประเทศ)
  fxRemittances: [
    { id: uid(), date: "2026-08-31", direction: "out", amount: 2792996.81, currency: "THB", purpose: "Dime", note: "" },
    { id: uid(), date: "2026-08-31", direction: "in", amount: 201927.87, currency: "THB", purpose: "Dime", note: "" },
    { id: uid(), date: "2026-08-31", direction: "out", amount: 1151636.32, currency: "THB", purpose: "Webull", note: "" },
    { id: uid(), date: "2025-08-31", direction: "out", amount: 3405507.74, currency: "THB", purpose: "Dime", note: "" },
    { id: uid(), date: "2025-08-31", direction: "out", amount: 124000, currency: "THB", purpose: "Webull", note: "" },
    { id: uid(), date: "2024-08-31", direction: "out", amount: 609709.96, currency: "THB", purpose: "Dime", note: "" },
  ],
  // Cash sitting uninvested at each offshore broker (e.g. proceeds from a sale that hasn't been reinvested
  // or remitted back to Thailand yet) — keyed by broker name, amount in USD
  offshoreBrokerCash: {},
  // Override for "years of protection needed" in the insurance adequacy calc — null means auto-estimate from youngest child's age
  insuranceNeedsYearsOverride: null,
  insurancePolicies: [
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "ทรัพย์บำนาญ 60 (1)", type: "ประกันบำนาญ", policyNumber: "นิว", startDate: "2020-08-31", maturityDate: "2078-08-31", sumAssured: 644330, cashSurrenderValue: 527062, paymentMonth: "Aug", premium: 100000, beneficiary: "ฝ้าย/มิ้นท์", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "ทรัพย์บำนาญ 60 (2)", type: "ประกันบำนาญ", policyNumber: "นิว", startDate: "2022-05-30", maturityDate: "2078-05-30", sumAssured: 1000000, cashSurrenderValue: 257000, paymentMonth: "May", premium: 100660, beneficiary: "ฝ้าย", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "Health Fit DD", type: "ประกันสุขภาพ IPD", policyNumber: "นิว", startDate: "", maturityDate: "", sumAssured: 0, cashSurrenderValue: 0, paymentMonth: "May", premium: 24040, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "ธนทวี 15/8", type: "ประกันสะสมทรัพย์", policyNumber: "นิว", startDate: "2020-01-31", maturityDate: "2035-01-31", sumAssured: 500000, cashSurrenderValue: 589505, paymentMonth: "Jan", premium: 120000, beneficiary: "ฝ้าย/มิ้นท์", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "TL fit firm 18/5 (ปันผล)", type: "ประกันสะสมทรัพย์", policyNumber: "นิว", startDate: "2023-06-29", maturityDate: "2041-06-29", sumAssured: 400000, cashSurrenderValue: 212000, paymentMonth: "Jun", premium: 131760, beneficiary: "ฝ้าย", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "TLI", policyName: "คุ้มครองโรคร้าย", type: "โรคร้ายแรง", policyNumber: "นิว", startDate: "", maturityDate: "", sumAssured: 0, cashSurrenderValue: 0, paymentMonth: "Jun", premium: 8540, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "AIA", policyName: "AIA easy 10/10", type: "Term Life", policyNumber: "นิว", startDate: "2024-09-21", maturityDate: "2034-09-21", sumAssured: 1500000, cashSurrenderValue: 0, paymentMonth: "Sep", premium: 8055, beneficiary: "ฝ้าย", status: "Active" },
    { id: uid(), owner: "นิว (New)", company: "AIA", policyName: "lifetime/21", type: "Term Life", policyNumber: "นิว", startDate: "2000-07-18", maturityDate: "2087-07-01", sumAssured: 210000, cashSurrenderValue: 0, paymentMonth: "Jan", premium: 501, beneficiary: "ฝ้าย", status: "Active" },
    { id: uid(), owner: "ฝ้าย (Fai)", company: "Allianz", policyName: "Max saving 18/8 ฝ้าย", type: "ประกันสะสมทรัพย์", policyNumber: "ฝ้าย", startDate: "2021-03-16", maturityDate: "2039-03-16", sumAssured: 295859, cashSurrenderValue: 386096, paymentMonth: "-", premium: 0, beneficiary: "นิว", status: "ปิดวงเงินสำเร็จ" },
    { id: uid(), owner: "ฝ้าย (Fai)", company: "TLI", policyName: "ทรัพย์บำนาญ 60 ฝ้าย", type: "ประกันบำนาญ", policyNumber: "ฝ้าย", startDate: "", maturityDate: "2077-08-30", sumAssured: 1000000, cashSurrenderValue: 298000, paymentMonth: "Aug", premium: 113790, beneficiary: "นิว", status: "Active" },
    { id: uid(), owner: "ฝ้าย (Fai)", company: "TLI", policyName: "Health Fit DD", type: "ประกันสุขภาพ IPD", policyNumber: "ฝ้าย", startDate: "", maturityDate: "", sumAssured: 0, cashSurrenderValue: 0, paymentMonth: "Aug", premium: 26920, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "Kids", company: "AIA", policyName: "UNL - มิ้นท์", type: "ประกันสุขภาพ IPD", policyNumber: "มิ้นท์", startDate: "2025-03-13", maturityDate: "2119-03-13", sumAssured: 5000000, cashSurrenderValue: 13270, paymentMonth: "Monthly", premium: 121931, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "Kids", company: "AIA", policyName: "UNL - โรส", type: "ประกันสุขภาพ IPD", policyNumber: "โรส", startDate: "2025-03-13", maturityDate: "2121-03-13", sumAssured: 5000000, cashSurrenderValue: 13270, paymentMonth: "Monthly", premium: 120260, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "Kids", company: "AIA", policyName: "UNL - แพทริค", type: "ประกันสุขภาพ IPD", policyNumber: "แพทริค", startDate: "2025-03-13", maturityDate: "2125-03-13", sumAssured: 5000000, cashSurrenderValue: 13270, paymentMonth: "Monthly", premium: 126538, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "Kids", company: "Allianz", policyName: "กรุงศรี saver 20/10 มิ้นท์", type: "ประกันสะสมทรัพย์", policyNumber: "มิ้นท์", startDate: "2022-07-25", maturityDate: "2042-07-25", sumAssured: 414670, cashSurrenderValue: 121251, paymentMonth: "Jul", premium: 50000, beneficiary: "-", status: "Active" },
    { id: uid(), owner: "Kids", company: "Allianz", policyName: "กรุงศรี saver 20/10 โรส", type: "ประกันสะสมทรัพย์", policyNumber: "โรส", startDate: "2022-07-25", maturityDate: "2042-07-25", sumAssured: 414670, cashSurrenderValue: 121251, paymentMonth: "Jul", premium: 50000, beneficiary: "-", status: "Active" },
  ],
  coverageTargets: [
    { id: uid(), label: "ความคุ้มครองชีวิต (เสียชีวิต)", current: 4254330, target: 15000000, unit: "บาท" },
    { id: uid(), label: "เงินออมเมื่อครบกำหนด", current: 1467500, target: 2000000, unit: "บาท" },
    { id: uid(), label: "รายได้หลังเกษียณต่อปี", current: 399650, target: 500000, unit: "บาท" },
    { id: uid(), label: "วงเงิน IPD ต่อปี", current: 30000000, target: 30000000, unit: "บาท" },
    { id: uid(), label: "ความคุ้มครองโรคร้ายแรง", current: 2000000, target: 3000000, unit: "บาท" },
    { id: uid(), label: "วงเงินรักษาอุบัติเหตุ", current: 150000, target: 200000, unit: "บาท" },
    { id: uid(), label: "เงินชดเชยรายวันนอนโรงพยาบาล", current: 500, target: 2000, unit: "บาท/วัน" },
  ],
  insuranceNotes: [
    { id: uid(), icon: "claim", title: "แจ้งเคลม", detail: "กรณีผู้เอาประกันเสียชีวิต ผู้รับผลประโยชน์ต้องแจ้งบริษัทภายใน 14 วันนับจากวันเสียชีวิต" },
    { id: uid(), icon: "home", title: "Home Insurance", detail: "วงเงิน / 2 — คุ้มครอง นิว และ ฝ้าย" },
    { id: uid(), icon: "clinic", title: "Clinic Insurance", detail: "คุ้มครอง Clinic แล้ว" },
    { id: uid(), icon: "coop", title: "ประกันหนี้สหกรณ์", detail: "วงเงิน 1,000,000 บาท — คุ้มครองแล้ว" },
    { id: uid(), icon: "estimate", title: "ประมาณการ", detail: "รายจ่ายต่อเดือนเมื่อปลอดภาระหนี้ ≈ 80,000 บาท/เดือน" },
  ],
  customBills: [
    { id: uid(), name: "ค่าน้ำค่าไฟบ้าน", category: "สาธารณูปโภค", amount: 6000, month: "Monthly", dueDay: 5 },
    { id: uid(), name: "ค่าเทอมลูก", category: "การศึกษา", amount: 45000, month: "May", dueDay: 15 },
  ],
  billStatus: {},
  familyMembers: [
    {
      id: uid(), fullNameTh: "", fullNameEn: "", nickname: "นิว", relationship: "Primary Member", familyRole: "admin", gender: "",
      generation: "G1", maritalStatus: "สมรสจดทะเบียน", idNumber: "",
      birthYear: "", birthDate: "", birthDateCalendar: "ad", bloodType: "", medicalConditions: "", emergencyContactName: "", emergencyContactPhone: "",
      notes: "", isAssetHolder: true,
    },
    {
      id: uid(), fullNameTh: "", fullNameEn: "", nickname: "ฝ้าย", relationship: "คู่สมรส", familyRole: "financial", gender: "",
      generation: "G1", maritalStatus: "สมรสจดทะเบียน", idNumber: "",
      birthYear: "", birthDate: "", birthDateCalendar: "ad", bloodType: "", medicalConditions: "", emergencyContactName: "", emergencyContactPhone: "",
      notes: "", isAssetHolder: true,
    },
  ],
  estateWill: {
    exists: "", type: "", dateCreated: "", lastReviewed: "", location: "",
    executorName: "", executorContact: "", poaFinancial: "", poaHealthcare: "", livingWill: "", notes: "",
  },
  estateHeirs: [],
  estateBusinessSuccession: [],
  estateBeneficiaryReview: {},
  estateNextReviewDate: "",
  estateChecklist: {},
});

function loadData() {
  const defaults = seedData();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // merge with defaults so any newly-added fields (e.g. insurancePolicies)
      // don't crash the app when reading data saved by an older version
      return {
        assets: parsed.assets ?? defaults.assets,
        liabilities: parsed.liabilities ?? defaults.liabilities,
        cashAccounts: parsed.cashAccounts ?? defaults.cashAccounts,
        domesticFunds: parsed.domesticFunds ?? defaults.domesticFunds,
        offshoreStocks: parsed.offshoreStocks ?? defaults.offshoreStocks,
        realEstate: parsed.realEstate ?? defaults.realEstate,
        preciousMetals: parsed.preciousMetals ?? defaults.preciousMetals,
        businessEquity: parsed.businessEquity ?? defaults.businessEquity,
        portfolioSettings: parsed.portfolioSettings ?? defaults.portfolioSettings,
        debtSettings: parsed.debtSettings ?? defaults.debtSettings,
        transactions: parsed.transactions ?? defaults.transactions,
        netWorthHistory: parsed.netWorthHistory ?? defaults.netWorthHistory,
        insurancePolicies: parsed.insurancePolicies ?? defaults.insurancePolicies,
        coverageTargets: parsed.coverageTargets ?? defaults.coverageTargets,
        insuranceNotes: parsed.insuranceNotes ?? defaults.insuranceNotes,
        customBills: parsed.customBills ?? defaults.customBills,
        billStatus: parsed.billStatus ?? defaults.billStatus,
        familyMembers: parsed.familyMembers ?? defaults.familyMembers,
        estateWill: parsed.estateWill ?? defaults.estateWill,
        estateHeirs: parsed.estateHeirs ?? defaults.estateHeirs,
        estateBusinessSuccession: parsed.estateBusinessSuccession ?? defaults.estateBusinessSuccession,
        estateBeneficiaryReview: parsed.estateBeneficiaryReview ?? defaults.estateBeneficiaryReview,
        estateNextReviewDate: parsed.estateNextReviewDate ?? defaults.estateNextReviewDate,
        estateChecklist: parsed.estateChecklist ?? defaults.estateChecklist,
        netWorthSnapshots: parsed.netWorthSnapshots ?? defaults.netWorthSnapshots,
        fxRemittances: parsed.fxRemittances ?? defaults.fxRemittances,
        offshoreBrokerCash: parsed.offshoreBrokerCash ?? defaults.offshoreBrokerCash,
        insuranceNeedsYearsOverride: parsed.insuranceNeedsYearsOverride ?? defaults.insuranceNeedsYearsOverride,
        cashflowPlan: parsed.cashflowPlan ?? defaults.cashflowPlan,
        cashflowSettings: parsed.cashflowSettings ?? defaults.cashflowSettings,
      };
    }
  } catch (e) {}
  return defaults;
}

/* ---------------- small UI atoms ---------------- */

function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ background: "#17212B", borderColor: "#2A3949" }}
    >
      {children}
    </div>
  );
}

function StatCard({ label, value, delta, deltaLabel, icon: Icon, accent = "#C9A227" }) {
  const positive = delta >= 0;
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs tracking-wide uppercase" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
          {label}
        </span>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: `${accent}22` }}
        >
          <Icon size={15} color={accent} />
        </div>
      </div>
      <div
        style={{ fontFamily: "Fraunces", color: "#EAE7E0", fontSize: "1.9rem", fontWeight: 500, lineHeight: 1 }}
      >
        {value}
      </div>
      {delta !== undefined && (
        <div className="flex items-center gap-1 text-xs" style={{ fontFamily: "JetBrains Mono", color: positive ? "#4FA37B" : "#C1554A" }}>
          {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {Math.abs(delta).toFixed(1)}% <span style={{ color: "#8A93A0", fontFamily: "Inter" }}>{deltaLabel}</span>
        </div>
      )}
    </Card>
  );
}

// A single-row, space-efficient alternative to stacking multiple StatCards — icon + number + label inline, always horizontal
function CompactStatRow({ items }) {
  return (
    <Card className="p-4">
      <div className="flex items-stretch justify-around flex-wrap gap-y-3">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 px-3" style={{ borderLeft: i > 0 ? "1px solid #1E2A38" : "none" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${it.accent || "#C9A227"}22` }}>
              <it.icon size={13} color={it.accent || "#C9A227"} />
            </div>
            <div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#EAE7E0", lineHeight: 1.1 }}>{it.value}</div>
              <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>{it.label}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const ASSET_CATEGORY_EMOJI = {
  เงินสด: "💵",
  กองทุนในประเทศ: "📗",
  หุ้นต่างประเทศ: "📈",
  อสังหาริมทรัพย์: "🏘️",
  โลหะมีค่า: "🪙",
  หุ้นธุรกิจส่วนตัว: "🏢",
  สินทรัพย์อื่นๆ: "◆",
  ยานพาหนะ: "🚗",
  คริปโต: "🪙",
};

// Donut chart with a big center number + a legend list of (icon, label, amount, %) — used for Asset Allocation / Net Position
function DonutLegendCard({ title, hint, centerValue, centerLabel, items }) {
  const total = items.reduce((s, it) => s + it.value, 0);
  const nonZero = items.filter((it) => it.value > 0);
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>{title}</div>
        {hint && <span style={{ fontSize: "10.5px", color: "#8A93A0" }}>{hint}</span>}
      </div>
      {nonZero.length ? (
        <div className="flex items-center gap-6 flex-wrap">
          <div style={{ position: "relative", width: 176, height: 176, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={nonZero} dataKey="value" nameKey="label" innerRadius={60} outerRadius={86} paddingAngle={2}>
                  {nonZero.map((it, i) => (
                    <Cell key={i} fill={it.color} stroke="#101820" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
                  labelStyle={{ color: "#EAE7E0" }}
                  itemStyle={{ color: "#EAE7E0" }}
                  formatter={(v) => fmtTHB(v)}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col items-center justify-center" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <div style={{ fontFamily: "Fraunces", fontSize: "1.35rem", fontWeight: 600, color: "#EAE7E0" }}>{centerValue}</div>
              <div style={{ fontSize: "10px", color: "#8A93A0", marginTop: 2 }}>{centerLabel}</div>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-2" style={{ minWidth: 200 }}>
            {nonZero.map((it, i) => (
              <div key={i} className="flex items-center justify-between text-sm gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color, flexShrink: 0 }} />
                  <span style={{ flexShrink: 0 }}>{it.emoji}</span>
                  <span className="truncate">{it.label}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0" style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }}>
                  <span style={{ color: "#8A93A0" }}>{fmtTHB(it.value)}</span>
                  <span style={{ color: "#EAE7E0", minWidth: 40, textAlign: "right" }}>{total ? ((it.value / total) * 100).toFixed(1) : 0}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState text="ยังไม่มีข้อมูล" />
      )}
    </Card>
  );
}

// Same donut-with-legend visual as DonutLegendCard, but legend rows include the Net-Worth-neutral badge
// and the Fixed/Variable toggle — merges what used to be 2 separate cards (donut summary + toggle list) into 1
function CashOutDonutCard({ cfCashOut, cfBreakdownOut, categoryExpenseType, updateSettings }) {
  const rows = CASHOUT_CATEGORIES.filter((c) => cfBreakdownOut[c.key]).map((c, i) => ({
    ...c,
    value: cfBreakdownOut[c.key],
    color: c.key === "ลงทุน" ? "#4FA37B" : PIE_COLORS_CF[i % PIE_COLORS_CF.length],
  }));
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>รายจ่ายไปไหนบ้าง · Outgoing</div>
        <span style={{ fontSize: "10.5px", color: "#8A93A0" }}>บาท + %</span>
      </div>
      <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 14 }}>
        💡 "ลงทุน" นับเป็นเงินออม ไม่กระทบ Net Worth และไม่มี Fixed/Variable ซ้ำ · แตะ Fixed/Variable หมวดอื่นเพื่อกำหนด (ใช้คำนวณ Emergency Fund หน้าภาพรวม)
      </div>
      {rows.length ? (
        <div className="flex flex-col gap-5">
          <div className="flex justify-center">
            <div style={{ position: "relative", width: 168, height: 168, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={rows} dataKey="value" nameKey="key" innerRadius={56} outerRadius={82} paddingAngle={2}>
                    {rows.map((r, i) => (
                      <Cell key={i} fill={r.color} stroke="#101820" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
                    labelStyle={{ color: "#EAE7E0" }}
                    itemStyle={{ color: "#EAE7E0" }}
                    formatter={(v) => fmtTHB(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col items-center justify-center" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <div style={{ fontFamily: "Fraunces", fontSize: "1.35rem", fontWeight: 600, color: "#EAE7E0" }}>{fmtCompact(cfCashOut)}</div>
                <div style={{ fontSize: "10px", color: "#8A93A0", marginTop: 2 }}>รวมรายจ่าย</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((c) => {
              const neutral = NET_WORTH_NEUTRAL_FLOW_CATEGORIES.includes(c.key);
              const isFixed = categoryExpenseType[c.key] ? categoryExpenseType[c.key] === "fixed" : FIXED_EXPENSE_FLOW_CATEGORIES.includes(c.key);
              return (
                <div key={c.key} className="flex items-center justify-between text-sm flex-wrap gap-y-1.5 gap-x-2">
                  <span className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                    {c.emoji} {c.key}
                    <span
                      className="px-1.5 py-0.5 rounded-full"
                      style={{ background: neutral ? "#5B84B122" : "#C1554A22", color: neutral ? "#5B84B1" : "#C1554A", fontSize: "9.5px" }}
                      title={neutral ? "ไม่กระทบ Net Worth" : "กระทบ Net Worth"}
                    >
                      {neutral ? "Net Worth ไม่เปลี่ยน" : "รายจ่ายจริง"}
                    </span>
                    {c.key === "ลงทุน" ? (
                      <span
                        className="px-1.5 py-0.5 rounded-full"
                        style={{ background: "#C9A22722", color: "#C9A227", fontSize: "9px", fontWeight: 600 }}
                        title="นับเป็นเงินออม/ลงทุนอยู่แล้ว ไม่ต้องกำหนด Fixed/Variable ซ้ำ"
                      >
                        Savings & Investment
                      </span>
                    ) : (
                      <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid #2A3949" }}>
                        <button
                          onClick={() => updateSettings("cashflowSettings", { categoryExpenseType: { ...categoryExpenseType, [c.key]: "fixed" } })}
                          className="px-1.5 py-0.5"
                          style={{ background: isFixed ? "#C9A227" : "transparent", color: isFixed ? "#101820" : "#8A93A0", fontSize: "9px", fontWeight: 600 }}
                        >
                          Fixed
                        </button>
                        <button
                          onClick={() => updateSettings("cashflowSettings", { categoryExpenseType: { ...categoryExpenseType, [c.key]: "variable" } })}
                          className="px-1.5 py-0.5"
                          style={{ background: !isFixed ? "#5B84B1" : "transparent", color: !isFixed ? "#101820" : "#8A93A0", fontSize: "9px", fontWeight: 600 }}
                        >
                          Variable
                        </button>
                      </div>
                    )}
                  </span>
                  <span className="flex items-center gap-3 shrink-0" style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }}>
                    <span style={{ color: "#C1554A" }}>-{fmtTHB(c.value)}</span>
                    <span style={{ color: "#8A93A0", minWidth: 40, textAlign: "right" }}>{total ? ((c.value / total) * 100).toFixed(1) : 0}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState text="ไม่มีเงินออกเดือนนี้" />
      )}
    </Card>
  );
}

function TabButton({ active, onClick, children, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-all"
      style={{
        fontFamily: "Inter",
        fontWeight: 500,
        background: active ? "#1E2A38" : "transparent",
        color: active ? "#EAE7E0" : "#8A93A0",
        border: active ? "1px solid #2A3949" : "1px solid transparent",
      }}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function InputField({ label, ...props }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
      {label}
      <input
        {...props}
        className="px-3 py-2 rounded-lg outline-none text-sm"
        style={{
          background: "#101820",
          border: "1px solid #2A3949",
          color: "#EAE7E0",
          fontFamily: props.type === "number" ? "JetBrains Mono" : "Inter",
        }}
      />
    </label>
  );
}

function SelectField({ label, options, ...props }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
      {label}
      <select
        {...props}
        className="px-3 py-2 rounded-lg outline-none text-sm"
        style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

// Simple, forgiving multi-person % split editor — used for both "เจ้าของ" (owners) and "ตั้งใจยกให้" (heirs).
// Doesn't force the total to equal 100% (real data is often incomplete) — just shows a running total as a hint.
function PersonSplitEditor({ label, value, onChange, familyMembers, hint }) {
  const rows = value || [];
  const total = rows.reduce((s, r) => s + Number(r.pct || 0), 0);

  const updateRow = (i, patch) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const addRow = () => onChange([...rows, { memberId: "", pct: rows.length ? "" : 100 }]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span style={{ fontSize: "12px", color: "#8A93A0", fontFamily: "Inter" }}>{label}</span>
        {hint && <span style={{ fontSize: "10px", color: "#8A93A0" }}>{hint}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={r.memberId}
              onChange={(e) => updateRow(i, { memberId: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded-lg outline-none text-xs"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter", minWidth: 0 }}
            >
              <option value="">— เลือกคน —</option>
              {(familyMembers || []).map((m) => (
                <option key={m.id} value={m.id}>{m.nickname || m.fullNameTh || "ไม่ระบุชื่อ"}</option>
              ))}
            </select>
            <input
              type="number"
              value={r.pct}
              onChange={(e) => updateRow(i, { pct: e.target.value })}
              placeholder="%"
              className="w-16 px-2 py-1.5 rounded-lg outline-none text-xs text-right"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "JetBrains Mono" }}
            />
            <button onClick={() => removeRow(i)} style={{ color: "#8A93A0" }}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <button onClick={addRow} className="flex items-center gap-1 text-xs" style={{ color: "#C9A227" }}>
          <Plus size={12} /> เพิ่มคน
        </button>
        {rows.length > 0 && (
          <span style={{ fontSize: "10.5px", color: total === 100 ? "#4FA37B" : "#8A93A0" }}>รวม {total}%</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- vitality pulse (signature element) ---------------- */
function VitalityPulse({ trend }) {
  // trend: array of numbers -> draw breathing sparkline
  const pts = trend.length > 1 ? trend : [1, 1];
  const min = Math.min(...pts), max = Math.max(...pts);
  const norm = pts.map((v) => (max === min ? 0.5 : (v - min) / (max - min)));
  const w = 240, h = 40;
  const step = w / (norm.length - 1 || 1);
  const path = norm.map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - v * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="pulseGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C9A227" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#C9A227" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#pulseGrad)" strokeWidth="2">
        <animate attributeName="stroke-width" values="2;2.8;2" dur="2.8s" repeatCount="indefinite" />
      </path>
      <circle r="3.5" fill="#C9A227">
        <animateMotion dur="4s" repeatCount="indefinite" path={path} />
        <animate attributeName="opacity" values="0.4;1;0.4" dur="2.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

/* ================= MAIN APP ================= */

// Prevents one buggy render from white-screening the whole app — data in localStorage is untouched either way.
class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: "#101820", minHeight: "100vh", color: "#EAE7E0", fontFamily: "Inter", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.4rem", marginBottom: 8 }}>เกิดข้อผิดพลาดบางอย่าง</div>
            <div style={{ fontSize: "13px", color: "#8A93A0", marginBottom: 16, lineHeight: 1.6 }}>
              หน้าจอเกิดปัญหาชั่วคราว — <b style={{ color: "#4FA37B" }}>ข้อมูลของคุณยังปลอดภัยอยู่ในเครื่อง ไม่หายไปไหน</b> ลองโหลดหน้านี้ใหม่อีกครั้ง ถ้ายังเกิดปัญหาซ้ำ กรุณาสำรองข้อมูล (ถ้ายังทำได้) แล้วแจ้งผู้ดูแลระบบ
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
            >
              โหลดหน้านี้ใหม่
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function WealthVitalityDashboardWrapper() {
  return (
    <DashboardErrorBoundary>
      <WealthVitalityDashboard />
    </DashboardErrorBoundary>
  );
}

function WealthVitalityDashboard() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState(null); // {type: 'asset'|'liability'|'holding'|'transaction'}
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const [importTarget, setImportTarget] = useState("transactions");
  const [liveRates, setLiveRates] = useState({ status: "idle", rates: null, updatedAt: null, error: null });

  async function fetchLiveRates() {
    setLiveRates((r) => ({ ...r, status: "loading", error: null }));
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      const json = await res.json();
      if (json.result !== "success" || !json.rates) throw new Error("bad response");
      setLiveRates({ status: "success", rates: json.rates, updatedAt: json.time_last_update_utc || new Date().toISOString(), error: null });
    } catch (e) {
      setLiveRates((r) => ({ ...r, status: "error", error: "ดึงอัตราแลกเปลี่ยนสดไม่สำเร็จ (อาจไม่มีอินเทอร์เน็ต) — ใช้ค่ากรอกเองแทน" }));
    }
  }

  useEffect(() => {
    fetchLiveRates();
  }, []);

  // Fetch latest close price for a US-listed ticker symbol (best-effort; may fail if blocked/offline)
  async function fetchStockPrice(symbol) {
    // Both Stooq (needs API key since Mar 2026) and Yahoo Finance (blocks browser CORS requests outright)
    // no longer work for a pure client-side app. Finnhub's free tier works from the browser and only
    // needs a free API key the person can grab themselves at finnhub.io/register — no credit card needed.
    const apiKey = data.portfolioSettings?.stockApiKey;
    if (!apiKey) throw new Error("no_api_key");
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error("fetch failed");
    const json = await res.json();
    const price = json?.c;
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    return price;
  }
  function getLiveRateToThb(currency) {
    if (currency === "THB") return 1;
    if (liveRates.status === "success" && liveRates.rates?.THB && liveRates.rates?.[currency]) {
      return liveRates.rates.THB / liveRates.rates[currency];
    }
    return null;
  }

  useEffect(() => {
    document.title = "Wealth Vitality — Dashboard";
    if (!document.getElementById("wv-fonts")) {
      const link = document.createElement("link");
      link.id = "wv-fonts";
      link.rel = "stylesheet";
      link.href = FONTS_LINK;
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็ม?)", true);
    }
  }, [data]);

  function showToast(msg, isError = false) {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2600);
  }

  /* ---------- derived ---------- */
  const otherAssetsTotal = useMemo(() => data.assets.reduce((s, a) => s + Number(a.value || 0), 0), [data.assets]);
  const activeLiabilities = useMemo(
    () => data.liabilities.filter((l) => l.status !== "Closed" && l.status !== "Paid"),
    [data.liabilities]
  );
  const totalLiabilities = useMemo(() => activeLiabilities.reduce((s, l) => s + Number(l.currentBalance || 0), 0), [activeLiabilities]);
  const totalMonthlyDebtPayment = useMemo(() => activeLiabilities.reduce((s, l) => s + Number(l.monthlyPayment || 0), 0), [activeLiabilities]);
  const weightedInterestRate = useMemo(() => {
    const totalBal = activeLiabilities.reduce((s, l) => s + Number(l.currentBalance || 0), 0);
    if (!totalBal) return 0;
    return activeLiabilities.reduce((s, l) => s + Number(l.currentBalance || 0) * parseAPR(l.interestRate), 0) / totalBal;
  }, [activeLiabilities]);

  /* ---------- debt freedom: payoff simulation ---------- */
  const debtStrategy = data.debtSettings?.strategy || "snowball";
  const debtExtraPayment = Number(data.debtSettings?.extraPayment || 0);
  const debtSimSnowball = useMemo(() => simulateDebtPayoff(data.liabilities, debtExtraPayment, "snowball"), [data.liabilities, debtExtraPayment]);
  const debtSimAvalanche = useMemo(() => simulateDebtPayoff(data.liabilities, debtExtraPayment, "avalanche"), [data.liabilities, debtExtraPayment]);
  const activeDebtSim = debtStrategy === "avalanche" ? debtSimAvalanche : debtSimSnowball;
  const activeDebtsCount = useMemo(() => data.liabilities.filter((l) => l.status !== "Closed" && l.status !== "Paid" && Number(l.currentBalance) > 0).length, [data.liabilities]);
  /* ---------- investments corner: per-category totals (all converted to THB) ---------- */
  const liveUsdThbRate = getLiveRateToThb("USD");
  const usdThbRate = liveUsdThbRate || Number(data.portfolioSettings?.usdThbRate || 33.15);
  const isLiveRate = liveUsdThbRate !== null;

  const cashTotal = useMemo(
    () =>
      data.cashAccounts.reduce((s, c) => {
        const liveRate = getLiveRateToThb(c.currency);
        const rate = liveRate !== null ? liveRate : Number(c.fxToThb || 1);
        return s + Number(c.amount || 0) * rate;
      }, 0),
    [data.cashAccounts, liveRates]
  );
  // Emergency Fund cash = accounts flagged as Emergency Fund; falls back to total cash if none flagged yet
  const emergencyFundCashTotal = useMemo(() => {
    const flagged = data.cashAccounts.filter((c) => c.isEmergencyFund);
    if (!flagged.length) return cashTotal;
    return flagged.reduce((s, c) => {
      const liveRate = getLiveRateToThb(c.currency);
      const rate = liveRate !== null ? liveRate : Number(c.fxToThb || 1);
      return s + Number(c.amount || 0) * rate;
    }, 0);
  }, [data.cashAccounts, liveRates, cashTotal]);

  const domesticFundsValue = useMemo(
    () => data.domesticFunds.reduce((s, f) => s + Number(f.units || 0) * Number(f.currentPrice || 0), 0),
    [data.domesticFunds]
  );
  const domesticFundsCost = useMemo(
    () => data.domesticFunds.reduce((s, f) => s + Number(f.units || 0) * Number(f.avgPrice || 0), 0),
    [data.domesticFunds]
  );
  const offshoreStockHoldingsUSD = useMemo(
    () => data.offshoreStocks.reduce((s, st) => s + holdingFromLots(st).units * Number(st.currentPrice || 0), 0),
    [data.offshoreStocks]
  );
  // Cash sitting uninvested at offshore brokers (e.g. from a sale not yet reinvested/remitted) — still part of net worth
  const offshoreBrokerCashTotalUSD = useMemo(
    () => Object.values(data.offshoreBrokerCash || {}).reduce((s, v) => s + Number(v || 0), 0),
    [data.offshoreBrokerCash]
  );
  const offshoreValueUSD = offshoreStockHoldingsUSD + offshoreBrokerCashTotalUSD;
  const offshoreCostUSD = useMemo(
    () => data.offshoreStocks.reduce((s, st) => s + holdingFromLots(st).units * holdingFromLots(st).avgPrice, 0),
    [data.offshoreStocks]
  );
  const offshoreValueTHB = offshoreValueUSD * usdThbRate;
  const offshoreCostTHB = offshoreCostUSD * usdThbRate;
  const realEstateValue = useMemo(() => data.realEstate.reduce((s, r) => s + Number(r.currentValue || 0), 0), [data.realEstate]);
  const realEstateCost = useMemo(() => data.realEstate.reduce((s, r) => s + Number(r.purchasePrice || 0), 0), [data.realEstate]);
  const preciousMetalsValue = useMemo(() => data.preciousMetals.reduce((s, m) => s + Number(m.qty || 0) * Number(m.marketPrice || 0), 0), [data.preciousMetals]);
  const preciousMetalsCost = useMemo(() => data.preciousMetals.reduce((s, m) => s + Number(m.qty || 0) * Number(m.avgCost || 0), 0), [data.preciousMetals]);
  const businessEquityValue = useMemo(() => data.businessEquity.reduce((s, b) => s + Number(b.currentValue || 0), 0), [data.businessEquity]);
  const businessEquityCost = useMemo(() => data.businessEquity.reduce((s, b) => s + Number(b.avgCost || 0), 0), [data.businessEquity]);

  const investmentNetWorth = cashTotal + domesticFundsValue + offshoreValueTHB + realEstateValue + preciousMetalsValue + businessEquityValue;
  const investmentCostBasis = cashTotal + domesticFundsCost + offshoreCostTHB + realEstateCost + preciousMetalsCost + businessEquityCost;
  const investmentTotalPL = investmentNetWorth - investmentCostBasis;
  const investmentTotalPLPct = investmentCostBasis ? (investmentTotalPL / investmentCostBasis) * 100 : 0;
  const goalProgress = data.portfolioSettings?.netWorthGoal ? Math.min((investmentNetWorth / data.portfolioSettings.netWorthGoal) * 100, 100) : 0;

  // Insurance policies with real cash value (savings/annuity/unit-link types) — term life & pure health/CI riders have none
  const insuranceCashValueTotal = useMemo(
    () => data.insurancePolicies.filter((p) => p.status === "Active").reduce((s, p) => s + Number(p.cashSurrenderValue || 0), 0),
    [data.insurancePolicies]
  );

  const investmentAllocation = useMemo(
    () => [
      { name: "เงินสด", value: cashTotal },
      { name: "กองทุนในประเทศ", value: domesticFundsValue },
      { name: "หุ้นต่างประเทศ", value: offshoreValueTHB },
      { name: "อสังหาริมทรัพย์", value: realEstateValue },
      { name: "โลหะมีค่า", value: preciousMetalsValue },
      { name: "หุ้นธุรกิจส่วนตัว", value: businessEquityValue },
      { name: "มูลค่าเวนคืนกรมธรรม์", value: insuranceCashValueTotal },
    ].filter((a) => a.value > 0),
    [cashTotal, domesticFundsValue, offshoreValueTHB, realEstateValue, preciousMetalsValue, businessEquityValue, insuranceCashValueTotal]
  );

  // True total assets = investment portfolio (Investments Corner) + insurance cash value + any other manually-tracked assets
  const totalAssets = otherAssetsTotal + investmentNetWorth + insuranceCashValueTotal;
  const overviewAllocation = useMemo(() => {
    const list = [...investmentAllocation];
    const otherByCategory = {};
    data.assets.forEach((a) => {
      const key = a.category || "อื่นๆ";
      otherByCategory[key] = (otherByCategory[key] || 0) + Number(a.value || 0);
    });
    Object.entries(otherByCategory).forEach(([name, value]) => {
      if (value > 0) list.push({ name, value });
    });
    return list;
  }, [investmentAllocation, data.assets]);

  // target/drift only meaningful within domestic+offshore combined (matches source sheet)
  const domesticFundsWithDrift = useMemo(
    () =>
      data.domesticFunds.map((f) => {
        const value = Number(f.units || 0) * Number(f.currentPrice || 0);
        const weightPct = domesticFundsValue ? (value / domesticFundsValue) * 100 : 0;
        return { ...f, value, weightPct, drift: weightPct - Number(f.targetPct || 0) };
      }),
    [data.domesticFunds, domesticFundsValue]
  );
  const offshoreStocksWithDrift = useMemo(
    () =>
      data.offshoreStocks.map((st) => {
        const { units, avgPrice } = holdingFromLots(st);
        const valueUSD = units * Number(st.currentPrice || 0);
        const valueTHB = valueUSD * usdThbRate;
        const weightPct = offshoreValueUSD ? (valueUSD / offshoreValueUSD) * 100 : 0;
        return { ...st, units, avgPrice, valueUSD, valueTHB, weightPct, drift: weightPct - Number(st.targetPct || 0) };
      }),
    [data.offshoreStocks, offshoreValueUSD, usdThbRate]
  );

  const netWorth = totalAssets - totalLiabilities;

  const thisMonthTx = useMemo(() => {
    const now = new Date();
    return data.transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }, [data.transactions]);

  const income = thisMonthTx.filter((t) => t.type === "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = thisMonthTx.filter((t) => t.type === "รายจ่าย").reduce((s, t) => s + Number(t.amount || 0), 0);
  const savings = thisMonthTx.filter((t) => t.type === "เงินออม").reduce((s, t) => s + Number(t.amount || 0), 0);
  const cashflow = income - expense - savings;
  const savingsRate = income ? (savings / income) * 100 : 0;

  /* ---------- financial health ratios ---------- */
  const debtToAssetRatio = totalAssets ? (totalLiabilities / totalAssets) * 100 : null;
  const debtToNetWorthRatio = netWorth > 0 ? (totalLiabilities / netWorth) * 100 : null;
  const debtServiceRatio = income ? (totalMonthlyDebtPayment / income) * 100 : null;

  /* ---------- insurance derived ---------- */
  const totalPremium = useMemo(
    () => data.insurancePolicies.filter((p) => p.status === "Active").reduce((s, p) => s + Number(p.premium || 0), 0),
    [data.insurancePolicies]
  );
  const activePolicyCount = useMemo(
    () => data.insurancePolicies.filter((p) => p.status === "Active").length,
    [data.insurancePolicies]
  );
  const policiesByOwner = useMemo(() => {
    const g = {};
    data.insurancePolicies.forEach((p) => {
      if (!g[p.owner]) g[p.owner] = [];
      g[p.owner].push(p);
    });
    return g;
  }, [data.insurancePolicies]);
  const premiumCalendar = useMemo(() => {
    const byMonth = {};
    MONTH_ORDER.forEach((m) => (byMonth[m] = { month: m, total: 0, policies: [] }));
    let monthly = 0;
    data.insurancePolicies.filter((p) => p.status === "Active").forEach((p) => {
      if (p.paymentMonth === "Monthly") {
        monthly += Number(p.premium || 0) / 12;
        MONTH_ORDER.forEach((m) => {
          byMonth[m].total += Number(p.premium || 0) / 12;
          byMonth[m].policies.push(p.policyName);
        });
      } else if (MONTH_ORDER.includes(p.paymentMonth)) {
        byMonth[p.paymentMonth].total += Number(p.premium || 0);
        byMonth[p.paymentMonth].policies.push(p.policyName);
      }
    });
    return MONTH_ORDER.map((m) => byMonth[m]);
  }, [data.insurancePolicies]);

  const nwTrend = useMemo(() => {
    const hist = [...data.netWorthHistory];
    if (!hist.length || hist[hist.length - 1].value !== netWorth) {
      hist.push({ date: todayStr(), value: netWorth });
    }
    return hist;
  }, [data.netWorthHistory, netWorth]);

  /* ---------- combined monthly bills (insurance + debt + custom) ---------- */
  const monthlyBillsByMonth = useMemo(() => {
    const byMonth = {};
    MONTH_ORDER.forEach((m) => (byMonth[m] = []));

    data.insurancePolicies.forEach((p) => {
      if (!p.premium) return;
      if (p.paymentMonth === "Monthly") {
        MONTH_ORDER.forEach((m) => {
          byMonth[m].push({ key: `ins-${p.id}`, name: p.policyName, category: "ประกัน", amount: Number(p.premium) / 12, source: "insurance" });
        });
      } else if (MONTH_ORDER.includes(p.paymentMonth)) {
        byMonth[p.paymentMonth].push({ key: `ins-${p.id}`, name: p.policyName, category: "ประกัน", amount: Number(p.premium), source: "insurance" });
      }
    });

    data.liabilities.forEach((l) => {
      if (!l.monthlyPayment || l.status === "Closed" || l.status === "Paid") return;
      MONTH_ORDER.forEach((m) => {
        byMonth[m].push({ key: `debt-${l.id}`, name: l.name, category: "ผ่อนหนี้", amount: Number(l.monthlyPayment), source: "debt" });
      });
    });

    data.customBills.forEach((b) => {
      if (!b.amount) return;
      if (b.month === "Monthly") {
        MONTH_ORDER.forEach((m) => {
          byMonth[m].push({ key: `bill-${b.id}`, name: b.name, category: b.category || "อื่นๆ", amount: Number(b.amount), source: "custom", dueDay: b.dueDay || null });
        });
      } else if (MONTH_ORDER.includes(b.month)) {
        byMonth[b.month].push({ key: `bill-${b.id}`, name: b.name, category: b.category || "อื่นๆ", amount: Number(b.amount), source: "custom", dueDay: b.dueDay || null });
      }
    });

    data.domesticFunds.forEach((f) => {
      if (!f.dcaMonth) return;
      MONTH_ORDER.forEach((m) => {
        byMonth[m].push({ key: `dca-fund-${f.id}`, name: `DCA: ${f.name}`, category: "DCA ลงทุน", amount: Number(f.dcaMonth), source: "dca" });
      });
    });
    data.offshoreStocks.forEach((st) => {
      if (!st.dcaMonth) return;
      MONTH_ORDER.forEach((m) => {
        byMonth[m].push({ key: `dca-stock-${st.id}`, name: `DCA: ${st.name}`, category: "DCA ลงทุน", amount: Number(st.dcaMonth), source: "dca" });
      });
    });

    // All expense/savings transactions logged in the กระแสเงินสด tab this year (recurring and one-off) —
    // pulled in so the calendar shows every real cash outflow, not just insurance/debt/DCA/custom bills.
    const thisYear = new Date().getFullYear();
    data.transactions.forEach((t) => {
      if (t.type === "รายรับ" || !t.date) return;
      const d = new Date(t.date);
      if (d.getFullYear() !== thisYear) return;
      const mAbbrev = MONTH_ORDER[d.getMonth()];
      byMonth[mAbbrev].push({
        key: `tx-${t.id}`,
        name: t.category || "ธุรกรรม",
        category: t.flowCategory || "อื่นๆ",
        amount: Number(t.amount || 0),
        source: "transaction",
        recorded: true,
      });
    });

    return byMonth;
  }, [data.insurancePolicies, data.liabilities, data.customBills, data.domesticFunds, data.offshoreStocks, data.transactions]);

  const currentYear = new Date().getFullYear();
  function billStatusKey(itemKey, month) {
    return `${currentYear}-${month}-${itemKey}`;
  }
  function toggleBillPaid(itemKey, month) {
    const k = billStatusKey(itemKey, month);
    setData((d) => ({ ...d, billStatus: { ...d.billStatus, [k]: !d.billStatus[k] } }));
  }

  const monthlyBillsSummary = useMemo(() => {
    return MONTH_ORDER.map((m) => {
      const items = monthlyBillsByMonth[m];
      const total = items.reduce((s, i) => s + i.amount, 0);
      const paidTotal = items.reduce((s, i) => (data.billStatus[billStatusKey(i.key, m)] ? s + i.amount : s), 0);
      const paidCount = items.filter((i) => data.billStatus[billStatusKey(i.key, m)]).length;
      return { month: m, total, paidTotal, paidCount, itemCount: items.length, pct: total ? (paidTotal / total) * 100 : 0 };
    });
  }, [monthlyBillsByMonth, data.billStatus, currentYear]);

  const monthlyFlow = useMemo(() => {
    const byMonth = {};
    data.transactions.forEach((t) => {
      const key = t.date.slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { month: key, รายรับ: 0, รายจ่าย: 0, เงินออม: 0 };
      byMonth[key][t.type] += Number(t.amount || 0);
    });
    return Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
      .map((m) => ({ ...m, label: monthLabel(m.month + "-01") }));
  }, [data.transactions]);

  const PIE_COLORS = ["#C9A227", "#4FA37B", "#5B84B1", "#C1554A", "#8A6FBF", "#3FA7A0"];

  /* ---------- Monthly Cash Flow tab (redesigned) ---------- */
  const [cashflowMonth, setCashflowMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [cashflowMemberFilter, setCashflowMemberFilter] = useState("all");

  const currentMonthKey = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const cfTx = useMemo(
    () =>
      data.transactions.filter(
        (t) => t.date.slice(0, 7) === cashflowMonth && (cashflowMemberFilter === "all" || t.memberId === cashflowMemberFilter)
      ),
    [data.transactions, cashflowMonth, cashflowMemberFilter]
  );

  const cfCashIn = useMemo(() => cfTx.filter((t) => t.type === "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0), [cfTx]);

  const cfMonthAbbrev = useMemo(() => {
    const [, mm] = cashflowMonth.split("-");
    return MONTH_ORDER[Number(mm) - 1];
  }, [cashflowMonth]);
  const cfYearMatchesThisYear = cashflowMonth.slice(0, 4) === String(new Date().getFullYear());

  // Insurance premiums due this month, pulled automatically from the ประกัน tab — no need to log them twice.
  // Reuses the same billStatus key ("ins-{policyId}") as the ปฏิทินจ่ายเงินรายเดือน tab, so paid/unpaid stays in sync everywhere.
  const cfInsurancePremiumItems = useMemo(() => {
    const items = [];
    data.insurancePolicies.forEach((p) => {
      if (!p.premium) return;
      let amount = null;
      if (p.paymentMonth === cfMonthAbbrev) amount = Number(p.premium);
      else if (p.paymentMonth === "Monthly") amount = Number(p.premium) / 12;
      if (!amount) return;
      const billKey = `ins-${p.id}`;
      const paid = cfYearMatchesThisYear ? !!data.billStatus[billStatusKey(billKey, cfMonthAbbrev)] : null;
      items.push({
        id: `virtual-ins-${p.id}-${cashflowMonth}`,
        date: `${cashflowMonth}-01`,
        type: "เงินออม",
        flowCategory: "ประกัน",
        category: p.policyName,
        amount,
        note: "",
        isVirtual: true,
        source: "insurance",
        billKey,
        paid,
      });
    });
    return items;
  }, [data.insurancePolicies, data.billStatus, cfMonthAbbrev, cashflowMonth, cfYearMatchesThisYear]);

  // Debt payments due this month, pulled automatically from the หนี้สิน tab — shows the real liability name, no need to log twice.
  // Reuses the same billStatus key ("debt-{liabilityId}") as the ปฏิทินจ่ายเงินรายเดือน tab.
  const cfDebtPaymentItems = useMemo(() => {
    const items = [];
    data.liabilities.forEach((l) => {
      if (!l.monthlyPayment || l.status === "Closed" || l.status === "Paid") return;
      const billKey = `debt-${l.id}`;
      const paid = cfYearMatchesThisYear ? !!data.billStatus[billStatusKey(billKey, cfMonthAbbrev)] : null;
      items.push({
        id: `virtual-debt-${l.id}-${cashflowMonth}`,
        date: `${cashflowMonth}-01`,
        type: "รายจ่าย",
        flowCategory: "ชำระหนี้",
        category: l.name,
        amount: Number(l.monthlyPayment),
        note: "",
        isVirtual: true,
        source: "debt",
        billKey,
        paid,
      });
    });
    return items;
  }, [data.liabilities, data.billStatus, cfMonthAbbrev, cashflowMonth, cfYearMatchesThisYear]);

  // DCA (กองทุนในประเทศ + หุ้นต่างประเทศ) — pulled from the พอร์ตลงทุน tab, same billStatus key as the ปฏิทินจ่ายเงินรายเดือน tab
  const cfDCAItems = useMemo(() => {
    const items = [];
    data.domesticFunds.forEach((f) => {
      if (!f.dcaMonth) return;
      const billKey = `dca-fund-${f.id}`;
      const paid = cfYearMatchesThisYear ? !!data.billStatus[billStatusKey(billKey, cfMonthAbbrev)] : null;
      items.push({
        id: `virtual-dca-fund-${f.id}-${cashflowMonth}`,
        date: `${cashflowMonth}-01`,
        type: "เงินออม",
        flowCategory: "ลงทุน",
        category: `DCA: ${f.name}`,
        amount: Number(f.dcaMonth),
        note: "",
        isVirtual: true,
        source: "dca",
        billKey,
        paid,
      });
    });
    data.offshoreStocks.forEach((st) => {
      if (!st.dcaMonth) return;
      const billKey = `dca-stock-${st.id}`;
      const paid = cfYearMatchesThisYear ? !!data.billStatus[billStatusKey(billKey, cfMonthAbbrev)] : null;
      items.push({
        id: `virtual-dca-stock-${st.id}-${cashflowMonth}`,
        date: `${cashflowMonth}-01`,
        type: "เงินออม",
        flowCategory: "ลงทุน",
        category: `DCA: ${st.name}`,
        amount: Number(st.dcaMonth),
        note: "",
        isVirtual: true,
        source: "dca",
        billKey,
        paid,
      });
    });
    return items;
  }, [data.domesticFunds, data.offshoreStocks, data.billStatus, cfMonthAbbrev, cashflowMonth, cfYearMatchesThisYear]);

  // Maps a custom bill's category (set in ปฏิทินจ่ายเงินรายเดือน) to the flowCategory taxonomy used in กระแสเงินสด
  const CUSTOM_BILL_FLOW_CATEGORY = {
    สาธารณูปโภค: "สาธารณูปโภค",
    การศึกษา: "การศึกษา",
    ประกัน: "ประกัน",
    ผ่อนหนี้: "ชำระหนี้",
    อื่นๆ: "อื่นๆ",
  };

  // Custom recurring bills added directly in the ปฏิทินจ่ายเงินรายเดือน tab
  const cfCustomBillItems = useMemo(() => {
    const items = [];
    data.customBills.forEach((b) => {
      if (!b.amount) return;
      const dueThisMonth = b.month === "Monthly" || b.month === cfMonthAbbrev;
      if (!dueThisMonth) return;
      const billKey = `bill-${b.id}`;
      const paid = cfYearMatchesThisYear ? !!data.billStatus[billStatusKey(billKey, cfMonthAbbrev)] : null;
      items.push({
        id: `virtual-bill-${b.id}-${cashflowMonth}`,
        date: `${cashflowMonth}-01`,
        type: "รายจ่าย",
        flowCategory: CUSTOM_BILL_FLOW_CATEGORY[b.category] || "อื่นๆ",
        category: b.name,
        amount: Number(b.amount),
        note: "",
        isVirtual: true,
        source: "custombill",
        billKey,
        paid,
      });
    });
    return items;
  }, [data.customBills, data.billStatus, cfMonthAbbrev, cashflowMonth, cfYearMatchesThisYear]);

  const cfTxAll = useMemo(
    () => [...cfTx, ...cfInsurancePremiumItems, ...cfDebtPaymentItems, ...cfDCAItems, ...cfCustomBillItems],
    [cfTx, cfInsurancePremiumItems, cfDebtPaymentItems, cfDCAItems, cfCustomBillItems]
  );

  const cfCashOut = useMemo(() => cfTxAll.filter((t) => t.type !== "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0), [cfTxAll]);
  const cfNet = cfCashIn - cfCashOut;

  const cfOpeningCash = useMemo(() => {
    const override = data.cashflowSettings.openingCashOverrides[cashflowMonth];
    if (override !== undefined) return Number(override);
    if (cashflowMonth === currentMonthKey) return cashTotal;
    return 0;
  }, [data.cashflowSettings.openingCashOverrides, cashflowMonth, currentMonthKey, cashTotal]);

  const cfClosingCash = cfOpeningCash + cfNet;

  const cfUnpaidBillsRemaining = useMemo(() => {
    if (!cfYearMatchesThisYear) return 0;
    // Only truly "upcoming" scheduled items (insurance/debt/DCA/custom bills) belong here — real transactions
    // (source: "transaction") already happened and are already subtracted once via cfCashOut/cfClosingCash,
    // so including them here would double-subtract the same money.
    const items = (monthlyBillsByMonth[cfMonthAbbrev] || []).filter((i) => i.source !== "transaction");
    return items.reduce((s, i) => (data.billStatus[billStatusKey(i.key, cfMonthAbbrev)] ? s : s + i.amount), 0);
  }, [monthlyBillsByMonth, data.billStatus, cfMonthAbbrev, cfYearMatchesThisYear]);

  const cfForecastClosing = cfClosingCash - cfUnpaidBillsRemaining;

  const cfBreakdownIn = useMemo(() => {
    const byCat = {};
    cfTx.filter((t) => t.type === "รายรับ").forEach((t) => {
      const k = t.flowCategory || "อื่นๆ";
      byCat[k] = (byCat[k] || 0) + Number(t.amount || 0);
    });
    return byCat;
  }, [cfTx]);

  const cfBreakdownOut = useMemo(() => {
    const byCat = {};
    cfTxAll.filter((t) => t.type !== "รายรับ").forEach((t) => {
      const k = t.flowCategory || (t.type === "เงินออม" ? "ลงทุน" : "อื่นๆ");
      byCat[k] = (byCat[k] || 0) + Number(t.amount || 0);
    });
    return byCat;
  }, [cfTxAll]);

  const cfPlanVsActual = useMemo(() => {
    const plan = data.cashflowPlan;
    const actualExpense = cfTxAll
      .filter((t) => t.type === "รายจ่าย" && !["ชำระหนี้", "ลงทุน", "ประกัน"].includes(t.flowCategory))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const actualDebt = cfTxAll.filter((t) => t.flowCategory === "ชำระหนี้").reduce((s, t) => s + Number(t.amount || 0), 0);
    const actualInvest = cfTxAll
      .filter((t) => t.flowCategory === "ลงทุน" || (t.type === "เงินออม" && t.flowCategory !== "ประกัน"))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const actualInsurance = cfTxAll.filter((t) => t.flowCategory === "ประกัน").reduce((s, t) => s + Number(t.amount || 0), 0);
    return [
      { key: "เงินเข้า", label: "เงินเข้า", plan: Number(plan.เงินเข้า || 0), actual: cfCashIn },
      { key: "ค่าใช้จ่าย", label: "ค่าใช้จ่าย (รวมประกัน)", plan: Number(plan.ค่าใช้จ่าย || 0), actual: actualExpense + actualInsurance },
      { key: "ชำระหนี้", label: "ชำระหนี้", plan: Number(plan.ชำระหนี้ || 0), actual: actualDebt },
      { key: "ลงทุน", label: "ลงทุน", plan: Number(plan.ลงทุน || 0), actual: actualInvest },
    ];
  }, [data.cashflowPlan, cfTxAll, cfCashIn]);

  const cfTimeline = useMemo(() => [...cfTxAll].sort((a, b) => a.date.localeCompare(b.date)), [cfTxAll]);

  // Cash In & Cash Out per month across the whole year being viewed — actual transactions + recurring insurance/debt (evergreen every year)
  const cfYearlyFlow = useMemo(() => {
    const year = cashflowMonth.slice(0, 4);
    let cumulative = 0;
    return MONTH_ORDER.map((mAbbrev, idx) => {
      const monthKey = `${year}-${String(idx + 1).padStart(2, "0")}`;
      const monthTx = data.transactions.filter(
        (t) => t.date.slice(0, 7) === monthKey && (cashflowMemberFilter === "all" || t.memberId === cashflowMemberFilter)
      );
      const cashIn = monthTx.filter((t) => t.type === "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0);
      const txOut = monthTx.filter((t) => t.type !== "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0);
      const insTotal = data.insurancePolicies.reduce((s, p) => {
        if (!p.premium) return s;
        if (p.paymentMonth === mAbbrev) return s + Number(p.premium);
        if (p.paymentMonth === "Monthly") return s + Number(p.premium) / 12;
        return s;
      }, 0);
      const debtTotal = data.liabilities.reduce(
        (s, l) => (!l.monthlyPayment || l.status === "Closed" || l.status === "Paid" ? s : s + Number(l.monthlyPayment)),
        0
      );
      const dcaTotal =
        data.domesticFunds.reduce((s, f) => s + Number(f.dcaMonth || 0), 0) +
        data.offshoreStocks.reduce((s, st) => s + Number(st.dcaMonth || 0), 0);
      const billTotal = data.customBills.reduce((s, b) => {
        if (!b.amount) return s;
        return b.month === "Monthly" || b.month === mAbbrev ? s + Number(b.amount) : s;
      }, 0);
      const cashOut = txOut + insTotal + debtTotal + dcaTotal + billTotal;
      const net = cashIn - cashOut;
      cumulative += net;
      return { month: mAbbrev, cashIn, cashOut, net, cumulative, monthKey };
    });
  }, [data.transactions, data.insurancePolicies, data.liabilities, data.domesticFunds, data.offshoreStocks, data.customBills, cashflowMonth, cashflowMemberFilter]);

  /* ---------- Annual Summary (ภาพรวมหน้าแรก) — derived from the same transactions ledger as กระแสเงินสด ---------- */
  const annualSummary = useMemo(() => {
    const year = new Date().getFullYear();
    const yearTx = data.transactions.filter((t) => new Date(t.date).getFullYear() === year);

    // Auto-pulled insurance premiums & debt payments (shown in the กระแสเงินสด CASH OUT breakdown)
    // are never saved into data.transactions — generate the same virtual items for every month of
    // the year here too, so Annual Summary / Fixed Expenses actually reflects what CASH OUT shows.
    const virtualYearItems = [];
    MONTH_ORDER.forEach((mAbbrev) => {
      data.insurancePolicies.forEach((p) => {
        if (!p.premium) return;
        let amount = null;
        if (p.paymentMonth === mAbbrev) amount = Number(p.premium);
        else if (p.paymentMonth === "Monthly") amount = Number(p.premium) / 12;
        if (amount) virtualYearItems.push({ type: "เงินออม", flowCategory: "ประกัน", amount });
      });
      data.liabilities.forEach((l) => {
        if (!l.monthlyPayment || l.status === "Closed" || l.status === "Paid") return;
        virtualYearItems.push({ type: "รายจ่าย", flowCategory: "ชำระหนี้", amount: Number(l.monthlyPayment) });
      });
      data.domesticFunds.forEach((f) => {
        if (f.dcaMonth) virtualYearItems.push({ type: "เงินออม", flowCategory: "ลงทุน", amount: Number(f.dcaMonth) });
      });
      data.offshoreStocks.forEach((st) => {
        if (st.dcaMonth) virtualYearItems.push({ type: "เงินออม", flowCategory: "ลงทุน", amount: Number(st.dcaMonth) });
      });
      data.customBills.forEach((b) => {
        if (!b.amount) return;
        if (b.month === "Monthly" || b.month === mAbbrev) {
          const flowCat = { สาธารณูปโภค: "สาธารณูปโภค", การศึกษา: "การศึกษา", ประกัน: "ประกัน", ผ่อนหนี้: "ชำระหนี้", อื่นๆ: "อื่นๆ" }[b.category] || "อื่นๆ";
          virtualYearItems.push({ type: "รายจ่าย", flowCategory: flowCat, amount: Number(b.amount) });
        }
      });
    });
    const allYearItems = [...yearTx, ...virtualYearItems];

    const totalIncome = allYearItems.filter((t) => t.type === "รายรับ").reduce((s, t) => s + Number(t.amount || 0), 0);
    // Only "ลงทุน" (investment/DCA) counts as Savings & Investment — NOT every type: "เงินออม" item,
    // otherwise things like insurance premiums (also tagged type: "เงินออม") get swept in here and
    // never reach the Fixed/Variable buckets below, making the Fixed/Variable toggle silently do nothing for them.
    const totalSavingsInvestment = allYearItems
      .filter((t) => t.flowCategory === "ลงทุน")
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const catOverrides = data.cashflowSettings.categoryExpenseType || {};
    const totalFixedExpenses = allYearItems
      .filter((t) => t.type !== "รายรับ" && t.flowCategory !== "ลงทุน" && isFixedExpenseTx(t, catOverrides))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalVariableExpenses = allYearItems
      .filter((t) => t.type !== "รายรับ" && t.flowCategory !== "ลงทุน" && !isFixedExpenseTx(t, catOverrides))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const netAnnualBalance = totalIncome - totalFixedExpenses - totalVariableExpenses - totalSavingsInvestment;
    const savingRate = totalIncome ? (totalSavingsInvestment / totalIncome) * 100 : 0;

    return { year, totalIncome, totalSavingsInvestment, totalFixedExpenses, totalVariableExpenses, netAnnualBalance, savingRate };
  }, [data.transactions, data.cashflowSettings, data.insurancePolicies, data.liabilities, data.domesticFunds, data.offshoreStocks, data.customBills]);

  // Emergency Fund (months) — Emergency-Fund-flagged cash ÷ average monthly FIXED expenses so far this year
  const avgMonthlyFixedExpense = annualSummary.totalFixedExpenses / 12;
  const emergencyFundMonths = useMemo(() => {
    return avgMonthlyFixedExpense ? emergencyFundCashTotal / avgMonthlyFixedExpense : null;
  }, [avgMonthlyFixedExpense, emergencyFundCashTotal]);

  /* ---------- CRUD helpers ---------- */
  function addItem(key, item) {
    setData((d) => ({ ...d, [key]: [...d[key], { id: uid(), ...item }] }));
    showToast("บันทึกแล้ว");
  }
  function addBulkItems(key, items) {
    setData((d) => ({ ...d, [key]: [...d[key], ...items.map((item) => ({ id: uid(), ...item }))] }));
    showToast(`เพิ่ม ${items.length} รายการสำเร็จ (สร้างล่วงหน้าให้แล้ว)`);
  }
  function addOffshoreLot(stockId, lot) {
    setData((d) => ({
      ...d,
      offshoreStocks: d.offshoreStocks.map((st) => {
        if (st.id !== stockId) return st;
        let existingLots = st.lots || [];
        // First time adding a lot to a stock that already had a plain units/avgPrice position —
        // convert that position into an implicit "opening lot" first, so it isn't silently dropped.
        if (existingLots.length === 0 && Number(st.units || 0) > 0) {
          existingLots = [
            {
              id: uid(),
              date: st.asOfDate || todayStr(),
              units: Number(st.units),
              pricePerUnit: Number(st.avgPrice || 0),
              remainingUnits: Number(st.units),
              currency: "USD",
              note: "ยอดคงเหลือเดิมก่อนเริ่มบันทึกล็อต",
            },
          ];
        }
        return { ...st, lots: [...existingLots, { id: uid(), remainingUnits: lot.units, ...lot }] };
      }),
    }));
    showToast("เพิ่มล็อตแล้ว");
  }
  function sellOffshoreFIFO(stockId, sale) {
    let toastMsg = "";
    let broker = "อื่นๆ";
    let proceeds = 0;
    setData((d) => ({
      ...d,
      offshoreStocks: d.offshoreStocks.map((st) => {
        if (st.id !== stockId) return st;
        broker = st.broker || "อื่นๆ";
        let baseLots = st.lots || [];
        // No lots recorded yet but the stock has a known avg cost — treat that as an implicit opening
        // lot instead of silently using $0 cost basis (which would show the full sale price as "profit").
        if (baseLots.length === 0 && Number(st.units || 0) > 0) {
          baseLots = [
            {
              id: uid(),
              date: st.asOfDate || todayStr(),
              units: Number(st.units),
              pricePerUnit: Number(st.avgPrice || 0),
              remainingUnits: Number(st.units),
              currency: "USD",
              note: "ยอดคงเหลือเดิมก่อนเริ่มบันทึกล็อต",
            },
          ];
        }
        const { updatedLots, costBasis, consumed, shortfall } = sellFIFO(baseLots, sale.units);
        const incompleteCostBasis = shortfall > 0;
        if (incompleteCostBasis) {
          toastMsg = `⚠ ไม่มีข้อมูลต้นทุนพอสำหรับ ${shortfall.toFixed(2)} หน่วย — ส่วนนั้นถูกคิดต้นทุน 0 บาท ตรวจสอบตัวเลขในประวัติขายอีกครั้ง`;
        }
        proceeds = sale.units * sale.pricePerUnit;
        const realizedGainLoss = proceeds - costBasis;
        const saleRecord = {
          id: uid(), date: sale.date, unitsSold: sale.units, salePricePerUnit: sale.pricePerUnit,
          costBasis, realizedGainLoss, lotsConsumed: consumed, incompleteCostBasis, broker,
        };
        return { ...st, lots: updatedLots, sales: [...(st.sales || []), saleRecord] };
      }),
      // Sale proceeds land as uninvested cash at that stock's broker — otherwise the money would just vanish from the portfolio total
      offshoreBrokerCash: { ...d.offshoreBrokerCash, [broker]: Number(d.offshoreBrokerCash[broker] || 0) + proceeds },
    }));
    showToast(toastMsg || `บันทึกการขาย (FIFO) แล้ว — เงิน $${proceeds.toLocaleString()} เข้าเงินสดที่ ${broker}`, !!toastMsg);
  }
  function addManualSale(stockId, sale) {
    let broker = "อื่นๆ";
    let proceeds = 0;
    setData((d) => ({
      ...d,
      offshoreStocks: d.offshoreStocks.map((st) => {
        if (st.id !== stockId) return st;
        broker = st.broker || "อื่นๆ";
        const costBasis = sale.units * sale.costPerUnit;
        proceeds = sale.units * sale.salePricePerUnit;
        const realizedGainLoss = proceeds - costBasis;
        const saleRecord = {
          id: uid(), date: sale.date, unitsSold: sale.units, salePricePerUnit: sale.salePricePerUnit,
          costBasis, realizedGainLoss, lotsConsumed: [], manual: true, broker,
        };
        return { ...st, sales: [...(st.sales || []), saleRecord] };
      }),
      offshoreBrokerCash: { ...d.offshoreBrokerCash, [broker]: Number(d.offshoreBrokerCash[broker] || 0) + proceeds },
    }));
    showToast(`บันทึกรายการขายเองแล้ว — เงิน $${proceeds.toLocaleString()} เข้าเงินสดที่ ${broker}`);
  }
  // Deletes a mistaken/duplicate sale record — also restores any units it consumed back to their original lots
  function removeOffshoreSale(stockId, saleId) {
    let broker = "อื่นๆ";
    let proceeds = 0;
    setData((d) => ({
      ...d,
      offshoreStocks: d.offshoreStocks.map((st) => {
        if (st.id !== stockId) return st;
        const sale = (st.sales || []).find((s) => s.id === saleId);
        let lots = st.lots || [];
        if (sale && sale.lotsConsumed && sale.lotsConsumed.length) {
          lots = lots.map((l) => {
            const consumed = sale.lotsConsumed.find((c) => c.lotId === l.id);
            return consumed ? { ...l, remainingUnits: Number(l.remainingUnits || 0) + consumed.unitsFromLot } : l;
          });
        }
        if (sale) {
          broker = sale.broker || st.broker || "อื่นๆ";
          proceeds = Number(sale.unitsSold || 0) * Number(sale.salePricePerUnit || 0);
        }
        return { ...st, lots, sales: (st.sales || []).filter((s) => s.id !== saleId) };
      }),
      // Reverse the cash that was credited to the broker when this sale was originally recorded
      offshoreBrokerCash: { ...d.offshoreBrokerCash, [broker]: Number(d.offshoreBrokerCash[broker] || 0) - proceeds },
    }));
    showToast("ลบรายการขายแล้ว (คืนหน่วยกลับล็อตเดิม และหักเงินสดที่เคยเข้าบัญชีออกให้แล้ว)");
  }
  function removeItem(key, id) {
    setData((d) => ({ ...d, [key]: d[key].filter((x) => x.id !== id) }));
  }
  function updateItem(key, id, patch) {
    setData((d) => ({ ...d, [key]: d[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  }
  function updateSettings(key, patch) {
    setData((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }
  function setField(key, value) {
    setData((d) => ({ ...d, [key]: value }));
  }
  function setCashflowOpeningOverride(month, value) {
    setData((d) => ({
      ...d,
      cashflowSettings: { ...d.cashflowSettings, openingCashOverrides: { ...d.cashflowSettings.openingCashOverrides, [month]: value } },
    }));
  }

  /* ---------- CSV import ---------- */
  function handleCSVImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        if (importTarget === "transactions") {
          const parsed = rows
            .map((r) => ({
              id: uid(),
              date: r.date || r.วันที่ || todayStr(),
              type: r.type || r.ประเภท || "รายจ่าย",
              category: r.category || r.หมวดหมู่ || "อื่นๆ",
              flowCategory: r.flowCategory || r.หมวดกระแสเงินสด || "",
              amount: Number(r.amount || r.จำนวนเงิน || 0),
              note: r.note || r.หมายเหตุ || "",
            }))
            .filter((r) => r.amount);
          if (!parsed.length) return showToast("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้", true);
          setData((d) => ({ ...d, transactions: [...d.transactions, ...parsed] }));
          showToast(`นำเข้า ${parsed.length} รายการสำเร็จ`);
        } else if (importTarget === "assets") {
          const parsed = rows
            .map((r) => ({
              id: uid(),
              name: r.name || r.ชื่อ || "ไม่ระบุ",
              category: r.category || r.หมวดหมู่ || "อื่นๆ",
              value: Number(r.value || r.มูลค่า || 0),
            }))
            .filter((r) => r.value);
          if (!parsed.length) return showToast("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้", true);
          setData((d) => ({ ...d, assets: [...d.assets, ...parsed] }));
          showToast(`นำเข้า ${parsed.length} รายการสำเร็จ`);
        } else if (importTarget === "liabilities") {
          const parsed = rows
            .map((r) => ({
              id: uid(),
              name: r.name || r.ชื่อ || "ไม่ระบุ",
              lender: r.lender || r.เจ้าหนี้ || "",
              category: r.category || r.หมวดหมู่ || "อื่นๆ",
              originalAmount: Number(r.originalAmount || r.วงเงินเดิม || 0),
              currentBalance: Number(r.currentBalance || r.ยอดคงเหลือ || 0),
              interestRate: r.interestRate || r.ดอกเบี้ย || "",
              monthlyPayment: Number(r.monthlyPayment || r.ผ่อนต่อเดือน || 0),
              startDate: r.startDate || r.วันเริ่มกู้ || "",
              termMonths: Number(r.termMonths || r.ระยะเวลาเดือน || 0),
              endYear: r.endYear || r.สิ้นสุด || "",
              mrtaInsurance: r.mrtaInsurance || r.MRTA || "",
              notes: r.notes || r.บันทึก || "",
              status: r.status || r.สถานะ || "Active",
            }))
            .filter((r) => r.currentBalance);
          if (!parsed.length) return showToast("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้", true);
          setData((d) => ({ ...d, liabilities: [...d.liabilities, ...parsed] }));
          showToast(`นำเข้า ${parsed.length} รายการสำเร็จ`);
        } else if (importTarget === "domesticFunds") {
          const parsed = rows
            .map((r) => ({
              id: uid(),
              name: r.name || r.ชื่อ || "-",
              symbol: r.symbol || r.สัญลักษณ์ || "",
              subCategory: r.subCategory || r.ประเภท || "Mutual Funds",
              units: Number(r.units || r.จำนวนหน่วย || 0),
              avgPrice: Number(r.avgPrice || r.ต้นทุนเฉลี่ย || 0),
              currentPrice: Number(r.currentPrice || r.ราคาปัจจุบัน || 0),
              dividendYr: Number(r.dividendYr || 0),
              dcaMonth: Number(r.dcaMonth || r.dca || 0),
              targetPct: Number(r.targetPct || r.เป้าหมาย || 0),
            }))
            .filter((r) => r.units);
          if (!parsed.length) return showToast("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้", true);
          setData((d) => ({ ...d, domesticFunds: [...d.domesticFunds, ...parsed] }));
          showToast(`นำเข้า ${parsed.length} รายการสำเร็จ`);
        } else if (importTarget === "insurancePolicies") {
          const parsed = rows
            .map((r) => ({
              id: uid(),
              owner: r.owner || r.เจ้าของ || "-",
              company: r.company || r.บริษัท || "-",
              policyName: r.policyName || r.ชื่อกรมธรรม์ || "-",
              type: r.type || r.ประเภท || "-",
              policyNumber: r.policyNumber || r.เลขกรมธรรม์ || "-",
              startDate: r.startDate || r.วันเริ่มต้น || "",
              maturityDate: r.maturityDate || r.วันครบกำหนด || "",
              sumAssured: Number(r.sumAssured || r.ทุนประกัน || 0),
              cashSurrenderValue: Number(r.cashSurrenderValue || r.มูลค่าเวนคืน || 0),
              paymentMonth: r.paymentMonth || r.เดือนชำระ || "-",
              premium: Number(r.premium || r.เบี้ยประกัน || 0),
              beneficiary: r.beneficiary || r.ผู้รับผลประโยชน์ || "-",
              status: r.status || r.สถานะ || "Active",
            }))
            .filter((r) => r.policyName !== "-");
          if (!parsed.length) return showToast("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้", true);
          setData((d) => ({ ...d, insurancePolicies: [...d.insurancePolicies, ...parsed] }));
          showToast(`นำเข้า ${parsed.length} กรมธรรม์สำเร็จ`);
        }
      },
      error: () => showToast("อ่านไฟล์ไม่สำเร็จ ตรวจสอบรูปแบบ CSV", true),
    });
    e.target.value = "";
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wealth-vitality-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("นำเข้าไฟล์นี้จะเขียนทับข้อมูลปัจจุบันทั้งหมดในเครื่องนี้ ต้องการดำเนินการต่อหรือไม่?")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("invalid shape");
        }
        // Merge onto fresh defaults so a backup from an older version (missing newer fields) doesn't crash the app
        const defaults = seedData();
        const merged = { ...defaults };
        Object.keys(defaults).forEach((key) => {
          if (parsed[key] !== undefined) merged[key] = parsed[key];
        });
        setData(merged);
        showToast("กู้คืนข้อมูลสำเร็จแล้ว");
      } catch (err) {
        showToast("ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลที่ถูกต้อง (JSON ไม่ถูกรูปแบบ)", true);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ background: "#101820", minHeight: "100vh", color: "#EAE7E0", fontFamily: "Inter" }} className="w-full">
      <style>{`
        * { box-sizing: border-box; }
        ::selection { background: #C9A22744; }
        input:focus, select:focus { border-color: #C9A227 !important; }
        table { border-collapse: collapse; width: 100%; }
        th { text-align: left; font-family: Inter; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #8A93A0; font-weight: 500; padding: 10px 12px; border-bottom: 1px solid #2A3949; }
        td { padding: 12px; border-bottom: 1px solid #1E2A38; font-size: 13.5px; }
        tr:hover td { background: #1E2A3855; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #2A3949; border-radius: 3px; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>

      {/* header */}
      <header className="sticky top-0 z-20 backdrop-blur-md" style={{ background: "#101820ee", borderBottom: "1px solid #2A3949" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "#C9A22722", border: "1px solid #C9A22744" }}>
              <Circle size={12} color="#C9A227" fill="#C9A227" />
            </div>
            <div className="min-w-0">
              <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem", fontWeight: 500, lineHeight: 1.2 }}>Wealth Vitality</div>
              <div className="hidden sm:block truncate" style={{ fontSize: "11px", color: "#8A93A0" }}>เก็บข้อมูลในเครื่องนี้เท่านั้น · ไม่มีการส่งข้อมูลออกไปที่ใด</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-xs cursor-pointer"
              style={{ border: "1px solid #2A3949", color: "#8A93A0", fontFamily: "Inter" }}
              title="กู้คืนข้อมูลจากไฟล์สำรองข้อมูล (.json) — จะเขียนทับข้อมูลปัจจุบันทั้งหมด"
            >
              <Upload size={13} />
              <span className="hidden sm:inline">กู้คืนข้อมูล</span>
              <input type="file" accept="application/json" onChange={importBackup} className="hidden" />
            </label>
            <button
              onClick={exportBackup}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-xs"
              style={{ border: "1px solid #2A3949", color: "#8A93A0", fontFamily: "Inter" }}
              title="สำรองข้อมูล (.json)"
            >
              <Download size={13} />
              <span className="hidden sm:inline">สำรองข้อมูล</span>
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 flex gap-1 pb-2 overflow-x-auto">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={Wallet}>ภาพรวม</TabButton>
          <TabButton active={tab === "family"} onClick={() => setTab("family")} icon={Users}>สมาชิกครอบครัว</TabButton>
          <TabButton active={tab === "portfolio"} onClick={() => setTab("portfolio")} icon={LineChartIcon}>พอร์ตลงทุน</TabButton>
          <TabButton active={tab === "cashflow"} onClick={() => setTab("cashflow")} icon={PiggyBank}>กระแสเงินสด</TabButton>
          <TabButton active={tab === "debt"} onClick={() => setTab("debt")} icon={Flame}>หนี้สิน</TabButton>
          <TabButton active={tab === "bills"} onClick={() => setTab("bills")} icon={CalendarDays}>ปฏิทินจ่ายเงินรายเดือน</TabButton>
          <TabButton active={tab === "insurance"} onClick={() => setTab("insurance")} icon={Shield}>ประกัน</TabButton>
          <TabButton active={tab === "estate"} onClick={() => setTab("estate")} icon={Scroll}>Estate Planning</TabButton>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === "overview" && (
          <OverviewTab
            netWorth={netWorth}
            totalAssets={totalAssets}
            totalLiabilities={totalLiabilities}
            totalMonthlyDebtPayment={totalMonthlyDebtPayment}
            weightedInterestRate={weightedInterestRate}
            nwTrend={nwTrend}
            assetAllocation={overviewAllocation}
            data={data}
            setModal={setModal}
            removeItem={removeItem}
            PIE_COLORS={PIE_COLORS}
            setTab={setTab}
            debtToAssetRatio={debtToAssetRatio}
            debtToNetWorthRatio={debtToNetWorthRatio}
            debtServiceRatio={debtServiceRatio}
            annualSummary={annualSummary}
            emergencyFundMonths={emergencyFundMonths}
            avgMonthlyFixedExpense={avgMonthlyFixedExpense}
            investmentNetWorth={investmentNetWorth}
            updateItem={updateItem}
          />
        )}
        {tab === "portfolio" && (
          <PortfolioTab
            data={data}
            usdThbRate={usdThbRate}
            cashTotal={cashTotal}
            domesticFundsValue={domesticFundsValue}
            domesticFundsCost={domesticFundsCost}
            offshoreValueUSD={offshoreValueUSD}
            offshoreStockHoldingsUSD={offshoreStockHoldingsUSD}
            offshoreCostUSD={offshoreCostUSD}
            offshoreValueTHB={offshoreValueTHB}
            offshoreCostTHB={offshoreCostTHB}
            realEstateValue={realEstateValue}
            realEstateCost={realEstateCost}
            preciousMetalsValue={preciousMetalsValue}
            preciousMetalsCost={preciousMetalsCost}
            businessEquityValue={businessEquityValue}
            businessEquityCost={businessEquityCost}
            investmentNetWorth={investmentNetWorth}
            investmentCostBasis={investmentCostBasis}
            investmentTotalPL={investmentTotalPL}
            investmentTotalPLPct={investmentTotalPLPct}
            goalProgress={goalProgress}
            investmentAllocation={investmentAllocation}
            domesticFundsWithDrift={domesticFundsWithDrift}
            offshoreStocksWithDrift={offshoreStocksWithDrift}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
            updateSettings={updateSettings}
            PIE_COLORS={PIE_COLORS}
            liveRates={liveRates}
            isLiveRate={isLiveRate}
            fetchLiveRates={fetchLiveRates}
            getLiveRateToThb={getLiveRateToThb}
            fetchStockPrice={fetchStockPrice}
            removeOffshoreSale={removeOffshoreSale}
            setField={setField}
          />
        )}
        {tab === "cashflow" && (
          <CashflowTab
            cashflowMonth={cashflowMonth}
            setCashflowMonth={setCashflowMonth}
            cashflowMemberFilter={cashflowMemberFilter}
            setCashflowMemberFilter={setCashflowMemberFilter}
            familyMembers={data.familyMembers}
            cfCashIn={cfCashIn}
            cfCashOut={cfCashOut}
            cfNet={cfNet}
            cfOpeningCash={cfOpeningCash}
            cfClosingCash={cfClosingCash}
            cfForecastClosing={cfForecastClosing}
            cfUnpaidBillsRemaining={cfUnpaidBillsRemaining}
            cfYearMatchesThisYear={cfYearMatchesThisYear}
            cfBreakdownIn={cfBreakdownIn}
            cfBreakdownOut={cfBreakdownOut}
            cfPlanVsActual={cfPlanVsActual}
            cfTimeline={cfTimeline}
            currentMonthKey={currentMonthKey}
            minCashBuffer={data.cashflowSettings.minCashBuffer}
            setCashflowOpeningOverride={setCashflowOpeningOverride}
            updateSettings={updateSettings}
            setModal={setModal}
            removeItem={removeItem}
            toggleBillPaid={toggleBillPaid}
            cfMonthAbbrev={cfMonthAbbrev}
            cfYearlyFlow={cfYearlyFlow}
            updateItem={updateItem}
            categoryExpenseType={data.cashflowSettings.categoryExpenseType || {}}
          />
        )}

        {tab === "debt" && (
          <DebtTab
            liabilities={data.liabilities}
            debtStrategy={debtStrategy}
            debtExtraPayment={debtExtraPayment}
            debtSimSnowball={debtSimSnowball}
            debtSimAvalanche={debtSimAvalanche}
            activeDebtSim={activeDebtSim}
            activeDebtsCount={activeDebtsCount}
            totalLiabilities={totalLiabilities}
            totalMonthlyDebtPayment={totalMonthlyDebtPayment}
            weightedInterestRate={weightedInterestRate}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
            updateSettings={updateSettings}
          />
        )}

        {tab === "bills" && (
          <MonthlyBillsTab
            monthlyBillsByMonth={monthlyBillsByMonth}
            monthlyBillsSummary={monthlyBillsSummary}
            billStatus={data.billStatus}
            billStatusKey={billStatusKey}
            toggleBillPaid={toggleBillPaid}
            customBills={data.customBills}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
          />
        )}
        {tab === "insurance" && (
          <InsuranceTab
            policies={data.insurancePolicies}
            coverageTargets={data.coverageTargets}
            notes={data.insuranceNotes}
            totalPremium={totalPremium}
            activePolicyCount={activePolicyCount}
            policiesByOwner={policiesByOwner}
            premiumCalendar={premiumCalendar}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
            liabilities={data.liabilities}
            familyMembers={data.familyMembers}
            cashTotal={cashTotal}
            investmentNetWorth={investmentNetWorth}
            annualSummary={annualSummary}
            insuranceNeedsYearsOverride={data.insuranceNeedsYearsOverride}
            setField={setField}
          />
        )}

        {tab === "estate" && (
          <EstateTab
            data={data}
            netWorth={netWorth}
            cashTotal={cashTotal}
            businessEquityValue={businessEquityValue}
            realEstateValue={realEstateValue}
            familyMembers={data.familyMembers}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
            updateSettings={updateSettings}
            setField={setField}
          />
        )}

        {tab === "family" && (
          <FamilyTab
            members={data.familyMembers}
            setModal={setModal}
            removeItem={removeItem}
            updateItem={updateItem}
          />
        )}

        {/* import bar */}
        <Card className="mt-8 p-5 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1rem" }}>นำเข้าข้อมูลจากไฟล์ CSV</div>
            <div style={{ fontSize: "12px", color: "#8A93A0" }}>รองรับคอลัมน์: date/วันที่, type/ประเภท, category/หมวดหมู่, amount/จำนวนเงิน (สำหรับธุรกรรม)</div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={importTarget}
              onChange={(e) => setImportTarget(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              <option value="transactions">ธุรกรรม (กระแสเงินสด)</option>
              <option value="assets">สินทรัพย์</option>
              <option value="liabilities">หนี้สิน</option>
              <option value="domesticFunds">กองทุนในประเทศ</option>
              <option value="insurancePolicies">กรมธรรม์ประกัน</option>
            </select>
            <button
              onClick={() => fileInputRef.current.click()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm"
              style={{ background: "#C9A227", color: "#101820", fontWeight: 600, fontFamily: "Inter" }}
            >
              <Upload size={14} /> เลือกไฟล์ CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
          </div>
        </Card>
      </main>

      {modal && (
        <EntryModal
          modal={modal}
          familyMembers={data.familyMembers}
          offshoreStocks={data.offshoreStocks}
          onClose={() => setModal(null)}
          onSave={(key, itemOrItems) => {
            if (Array.isArray(itemOrItems)) {
              addBulkItems(key, itemOrItems);
            } else {
              addItem(key, itemOrItems);
            }
            setModal(null);
          }}
          onAddLot={(stockId, lot) => {
            addOffshoreLot(stockId, lot);
            setModal(null);
          }}
          onSellFIFO={(stockId, sale) => {
            sellOffshoreFIFO(stockId, sale);
            setModal(null);
          }}
          onAddManualSale={(stockId, sale) => {
            addManualSale(stockId, sale);
            setModal(null);
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm z-50"
          style={{
            background: toast.isError ? "#C1554A" : "#1E2A38",
            border: `1px solid ${toast.isError ? "#C1554A" : "#C9A227"}`,
            color: "#EAE7E0",
            fontFamily: "Inter",
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ================= OVERVIEW TAB ================= */

function OverviewTab({ netWorth, totalAssets, totalLiabilities, totalMonthlyDebtPayment, weightedInterestRate, nwTrend, assetAllocation, data, setModal, removeItem, PIE_COLORS, setTab, debtToAssetRatio, debtToNetWorthRatio, debtServiceRatio, annualSummary, investmentNetWorth, emergencyFundMonths, avgMonthlyFixedExpense, updateItem }) {
  const trendValues = nwTrend.map((h) => h.value);
  const growth =
    trendValues.length > 1 ? ((trendValues[trendValues.length - 1] - trendValues[0]) / Math.abs(trendValues[0])) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* hero */}
      <Card className="p-7 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div style={{ fontSize: "12px", color: "#8A93A0", letterSpacing: "0.05em", textTransform: "uppercase" }}>Net Worth ปัจจุบัน</div>
          <div style={{ fontFamily: "Fraunces", fontSize: "3.2rem", fontWeight: 500, lineHeight: 1.05, marginTop: 6 }}>
            {fmtTHB(netWorth)}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap" style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: growth >= 0 ? "#4FA37B" : "#C1554A" }}>
            {growth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {growth >= 0 ? "+" : ""}{growth.toFixed(1)}% <span style={{ color: "#8A93A0", fontFamily: "Inter" }}>ช่วง 6 เดือนที่ผ่านมา</span>
          </div>
          <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: 6 }}>
            = สินทรัพย์รวม {fmtCompact(totalAssets)} − หนี้สินรวม {fmtCompact(totalLiabilities)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <VitalityPulse trend={trendValues} />
          <span style={{ fontSize: "11px", color: "#8A93A0" }}>แนวโน้มความมั่งคั่ง</span>
        </div>
      </Card>

      <CompactStatRow
        items={[
          { label: "สินทรัพย์รวม", value: fmtCompact(totalAssets), icon: Wallet, accent: "#4FA37B" },
          { label: "หนี้สินรวม", value: fmtCompact(totalLiabilities), icon: TrendingDown, accent: "#C1554A" },
          { label: "อัตราส่วนหนี้ต่อสินทรัพย์", value: `${totalAssets ? ((totalLiabilities / totalAssets) * 100).toFixed(1) : 0}%`, icon: LineChartIcon, accent: "#5B84B1" },
        ]}
      />

      <Card className="p-5">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem", marginBottom: 14 }}>แนวโน้ม Net Worth</div>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={nwTrend}>
            <defs>
              <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C9A227" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#C9A227" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1E2A38" vertical={false} />
            <XAxis dataKey="date" tickFormatter={monthLabel} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={{ stroke: "#2A3949" }} tickLine={false} />
            <YAxis tickFormatter={fmtCompact} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
            <Tooltip
              contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
              labelStyle={{ color: "#EAE7E0" }}
              itemStyle={{ color: "#EAE7E0" }}
              labelFormatter={monthLabel}
              formatter={(v) => [fmtTHB(v), "Net Worth"]}
            />
            <Area type="monotone" dataKey="value" stroke="#C9A227" strokeWidth={2} fill="url(#nwGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DonutLegendCard
          title="สัดส่วนทรัพย์สิน · Asset Allocation"
          hint="บาท + %"
          centerValue={fmtCompact(totalAssets)}
          centerLabel="รวมทรัพย์สิน"
          items={assetAllocation.map((a, i) => ({
            label: a.name,
            value: a.value,
            color: PIE_COLORS[i % PIE_COLORS.length],
            emoji: ASSET_CATEGORY_EMOJI[a.name] || "◆",
          }))}
        />
        <DonutLegendCard
          title="สินทรัพย์+หนี้สิน · Net Position"
          hint="บาท + %"
          centerValue={fmtCompact(totalAssets)}
          centerLabel="ทรัพย์สินรวม"
          items={[
            { label: "ความมั่งคั่งสุทธิ · Net Worth", value: Math.max(netWorth, 0), color: "#4FA37B", emoji: "💚" },
            { label: "หนี้สิน · Liabilities", value: totalLiabilities, color: "#C1554A", emoji: "❤️" },
          ]}
        />
      </div>

      {/* composition: where the numbers above come from */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5 flex items-center justify-between gap-3">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>พอร์ตลงทุนรวม</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#4FA37B", marginTop: 2 }}>{fmtCompact(investmentNetWorth)}</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>เงินสด + กองทุน + หุ้น + อสังหาฯ + โลหะ + ธุรกิจส่วนตัว</div>
          </div>
          <button
            onClick={() => setTab("portfolio")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs shrink-0"
            style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0", fontWeight: 500 }}
          >
            รายละเอียด <ChevronRight size={13} />
          </button>
        </Card>
        <Card className="p-5 flex items-center justify-between gap-3">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>หนี้สินรวม</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#C1554A", marginTop: 2 }}>{fmtCompact(totalLiabilities)}</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>ผ่อน {fmtCompact(totalMonthlyDebtPayment)}/เดือน · ดอกเบี้ยเฉลี่ย {weightedInterestRate.toFixed(1)}%/ปี</div>
          </div>
          <button
            onClick={() => setTab("debt")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs shrink-0"
            style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0", fontWeight: 500 }}
          >
            <Flame size={13} color="#C9A227" /> กลยุทธ์ปลดหนี้ <ChevronRight size={13} />
          </button>
        </Card>
      </div>

      <ListPanel
        title="สินทรัพย์อื่นๆ (นอกพอร์ตลงทุน)"
        onAdd={() => setModal({ type: "asset" })}
        rows={data.assets}
        onRemove={(id) => removeItem("assets", id)}
        renderRow={(a) => (
          <>
            <td>
              {a.name}
              {a.confidence && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 rounded-full"
                  style={{
                    background: a.confidence.startsWith("Confirmed") ? "#4FA37B22" : "#C9A22722",
                    color: a.confidence.startsWith("Confirmed") ? "#4FA37B" : "#C9A227",
                    fontSize: "9.5px",
                  }}
                  title={a.story || ""}
                >
                  {a.confidence.startsWith("Confirmed") ? "✓ ยืนยันแล้ว" : "≈ ประมาณการ"}
                </span>
              )}
            </td>
            <td style={{ color: "#8A93A0" }}>{a.category}</td>
            <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{fmtTHB(a.value)}</td>
          </>
        )}
        headers={["รายการ", "หมวดหมู่", "มูลค่า"]}
      />

      <NetWorthHistoryCard snapshots={data.netWorthSnapshots} setModal={setModal} removeItem={removeItem} updateItem={updateItem} />

      <Card className="p-5">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>ตัวชี้วัดสุขภาพการเงิน</div>
        <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 14 }}>คำนวณจากสินทรัพย์ หนี้สิน และรายรับเดือนนี้แบบเรียลไทม์</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <HealthRatioBlock
            label="Debt-to-Asset Ratio"
            value={debtToAssetRatio}
            hint="หนี้สิน ÷ สินทรัพย์รวม"
            thresholds={{ good: 30, warn: 50 }}
          />
          <HealthRatioBlock
            label="Debt-to-Net Worth Ratio"
            value={debtToNetWorthRatio}
            hint="หนี้สิน ÷ Net Worth"
            thresholds={{ good: 50, warn: 100 }}
          />
          <HealthRatioBlock
            label="Debt Service Ratio (DSR)"
            value={debtServiceRatio}
            hint="ผ่อนหนี้/เดือน ÷ รายรับเดือนนี้"
            thresholds={{ good: 35, warn: 50 }}
          />
          <HealthRatioBlock
            label="Emergency Fund"
            value={emergencyFundMonths}
            hint={`เงินสด ÷ ค่าใช้จ่ายคงที่เฉลี่ย ${fmtCompact(avgMonthlyFixedExpense)}/เดือน`}
            thresholds={{ good: 6, warn: 3 }}
            higherIsBetter
            unit=" เดือน"
          />
          <HealthRatioBlock
            label="Saving Rate เฉลี่ย (ปีนี้)"
            value={annualSummary.savingRate}
            hint="เงินออม/ลงทุน ÷ รายรับรวมทั้งปี"
            thresholds={{ good: 20, warn: 10 }}
            higherIsBetter
          />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>Annual Summary · สรุปรายปี {annualSummary.year + 543}</div>
          <span className="px-2 py-0.5 rounded-full" style={{ background: "#5B84B122", color: "#5B84B1", fontSize: "9.5px" }}>
            เชื่อมจากแท็บกระแสเงินสด
          </span>
        </div>
        <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 14 }}>รวมธุรกรรมตั้งแต่ต้นปีถึงปัจจุบัน อัปเดตอัตโนมัติทุกครั้งที่แก้ไขในแท็บกระแสเงินสด</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Annual Income</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#4FA37B", marginTop: 3 }}>{fmtCompact(annualSummary.totalIncome)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Savings & Investment</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#C9A227", marginTop: 3 }}>{fmtCompact(annualSummary.totalSavingsInvestment)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Fixed Expenses</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#C1554A", marginTop: 3 }}>{fmtCompact(annualSummary.totalFixedExpenses)}</div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>เฉลี่ย {fmtCompact(avgMonthlyFixedExpense)}/เดือน (÷12)</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Variable Expenses</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#C1554A", marginTop: 3 }}>{fmtCompact(annualSummary.totalVariableExpenses)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Net Balance</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: annualSummary.netAnnualBalance >= 0 ? "#4FA37B" : "#C1554A", marginTop: 3 }}>
              {annualSummary.netAnnualBalance >= 0 ? "+" : ""}{fmtCompact(annualSummary.netAnnualBalance)}
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Saving Rate</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#5B84B1", marginTop: 3 }}>{annualSummary.savingRate.toFixed(1)}%</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Compact yearly Net Worth history table — records only totalAssets/totalLiabilities per year (not every line
// item) to stay small, computes Net Worth, YoY change, and overall CAGR from that.
function NetWorthHistoryCard({ snapshots, setModal, removeItem, updateItem }) {
  const rows = [...snapshots].sort((a, b) => a.year - b.year);
  const withDerived = rows.map((r, i) => {
    const netWorth = Number(r.totalAssets || 0) - Number(r.totalLiabilities || 0);
    const prev = i > 0 ? rows[i - 1] : null;
    const prevNetWorth = prev ? Number(prev.totalAssets || 0) - Number(prev.totalLiabilities || 0) : null;
    const yoyPct = prevNetWorth !== null && prevNetWorth > 0 ? ((netWorth - prevNetWorth) / prevNetWorth) * 100 : null;
    return { ...r, netWorth, yoyPct, prevNetWorth };
  });
  const first = withDerived[0];
  const last = withDerived[withDerived.length - 1];
  const years = withDerived.length;
  let cagr = null;
  if (first && last && years > 1 && first.netWorth > 0 && last.netWorth > 0) {
    cagr = (Math.pow(last.netWorth / first.netWorth, 1 / (years - 1)) - 1) * 100;
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>การเติบโตของทรัพย์สิน · Net Worth History</div>
        <button
          onClick={() => setModal({ type: "netWorthSnapshot" })}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
          style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
        >
          <Plus size={12} /> เพิ่มปี
        </button>
      </div>
      <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 12 }}>บันทึกยอดสินทรัพย์รวม/หนี้สินรวมแต่ละปี (พ.ศ.) เพื่อเทียบการเติบโตระยะยาว</div>
      {withDerived.length ? (
        <>
          {cagr !== null && (
            <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
              <TrendingUp size={14} color={cagr >= 0 ? "#4FA37B" : "#C1554A"} />
              <span style={{ fontSize: "12px", color: "#8A93A0" }}>
                CAGR เฉลี่ย {first.year}–{last.year} ({years - 1} ปี):
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: cagr >= 0 ? "#4FA37B" : "#C1554A", fontWeight: 600 }}>
                {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}%/ปี
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ปี (พ.ศ.)</th>
                  <th style={{ textAlign: "right" }}>สินทรัพย์รวม</th>
                  <th style={{ textAlign: "right" }}>หนี้สินรวม</th>
                  <th style={{ textAlign: "right" }}>Net Worth</th>
                  <th style={{ textAlign: "right" }}>YoY</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {withDerived.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "JetBrains Mono" }}>
                      <EditableNumber value={r.year} onSave={(v) => updateItem("netWorthSnapshots", r.id, { year: v })} />
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                      <EditableNumber value={r.totalAssets} onSave={(v) => updateItem("netWorthSnapshots", r.id, { totalAssets: v })} />
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                      <EditableNumber value={r.totalLiabilities} onSave={(v) => updateItem("netWorthSnapshots", r.id, { totalLiabilities: v })} />
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: r.netWorth >= 0 ? "#4FA37B" : "#C1554A" }}>
                      {fmtCompact(r.netWorth)}
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#8A93A0" }}>
                      {r.yoyPct === null ? (r.prevNetWorth !== null ? "N/A*" : "-") : `${r.yoyPct >= 0 ? "+" : ""}${r.yoyPct.toFixed(1)}%`}
                    </td>
                    <td><button onClick={() => removeItem("netWorthSnapshots", r.id)} style={{ color: "#8A93A0" }}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {withDerived.some((r) => r.yoyPct === null && r.prevNetWorth !== null) && (
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 6 }}>* N/A เพราะปีก่อนหน้า Net Worth ติดลบหรือศูนย์ คำนวณ % เปลี่ยนแปลงแบบมีความหมายไม่ได้</div>
          )}
        </>
      ) : (
        <EmptyState text="ยังไม่มีข้อมูลย้อนหลัง — เพิ่มด้วยปุ่มด้านบน" />
      )}
    </Card>
  );
}

function HealthRatioBlock({ label, value, hint, thresholds, higherIsBetter, unit = "%" }) {
  const hasValue = value !== null && value !== undefined && Number.isFinite(value);
  let color = "#8A93A0";
  let statusText = "ไม่มีข้อมูลพอ";
  if (hasValue) {
    if (higherIsBetter) {
      color = value >= thresholds.good ? "#4FA37B" : value >= thresholds.warn ? "#C9A227" : "#C1554A";
      statusText = value >= thresholds.good ? "อยู่ในเกณฑ์ดี" : value >= thresholds.warn ? "เริ่มต่ำ ควรเพิ่ม" : "ต่ำกว่าเกณฑ์";
    } else {
      color = value <= thresholds.good ? "#4FA37B" : value <= thresholds.warn ? "#C9A227" : "#C1554A";
      statusText = value <= thresholds.good ? "อยู่ในเกณฑ์ดี" : value <= thresholds.warn ? "เริ่มสูง ควรระวัง" : "สูงเกินเกณฑ์";
    }
  }
  return (
    <div className="p-4 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
      <div style={{ fontSize: "11.5px", color: "#8A93A0" }}>{label}</div>
      <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.6rem", color, marginTop: 4 }}>{hasValue ? `${value.toFixed(1)}${unit}` : "-"}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: "11px", color }}>{statusText}</span>
      </div>
      <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: 4 }}>{hint}</div>
    </div>
  );
}

/* ================= PORTFOLIO TAB ================= */


/* ================= PORTFOLIO TAB (Investments Corner) ================= */

const PORTFOLIO_SUBTABS = [
  { key: "overview", label: "ภาพรวม", icon: LineChartIcon },
  { key: "cash", label: "เงินสด", icon: Wallet },
  { key: "domestic", label: "กองทุนในประเทศ", icon: Landmark },
  { key: "offshore", label: "หุ้นต่างประเทศ", icon: Globe },
  { key: "realEstate", label: "อสังหาริมทรัพย์", icon: Home },
  { key: "metals", label: "โลหะมีค่า", icon: Gem },
  { key: "business", label: "หุ้นธุรกิจส่วนตัว", icon: Building2 },
];

function DriftBadge({ drift }) {
  const over = drift > 1;
  const under = drift < -1;
  const color = over ? "#C1554A" : under ? "#5B84B1" : "#4FA37B";
  return (
    <span className="px-1.5 py-0.5 rounded-full text-xs" style={{ background: `${color}22`, color, fontFamily: "JetBrains Mono" }}>
      {drift >= 0 ? "+" : ""}{drift.toFixed(1)}%
    </span>
  );
}

function PortfolioTab(props) {
  const {
    data, usdThbRate, cashTotal, domesticFundsValue, domesticFundsCost, offshoreValueUSD, offshoreStockHoldingsUSD, offshoreCostUSD,
    offshoreValueTHB, offshoreCostTHB, realEstateValue, realEstateCost, preciousMetalsValue, preciousMetalsCost,
    businessEquityValue, businessEquityCost, investmentNetWorth, investmentCostBasis, investmentTotalPL,
    investmentTotalPLPct, goalProgress, investmentAllocation, domesticFundsWithDrift, offshoreStocksWithDrift,
    setModal, removeItem, updateItem, updateSettings, PIE_COLORS,
    liveRates, isLiveRate, fetchLiveRates, getLiveRateToThb, fetchStockPrice, removeOffshoreSale, setField,
  } = props;

  const [sub, setSub] = useState("overview");

  // Known broker names — from existing holdings + cash buckets — used as datalist suggestions so
  // typos ("Webull" vs "webull") don't accidentally split cash into separate buckets.
  const brokerSuggestions = useMemo(() => {
    const names = new Set();
    data.offshoreStocks.forEach((st) => st.broker && names.add(st.broker));
    data.domesticFunds.forEach((f) => f.broker && names.add(f.broker));
    Object.keys(data.offshoreBrokerCash || {}).forEach((b) => names.add(b));
    return [...names].sort();
  }, [data.offshoreStocks, data.domesticFunds, data.offshoreBrokerCash]);

  return (
    <div className="flex flex-col gap-6">
      <datalist id="broker-suggestions-list">
        {brokerSuggestions.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PORTFOLIO_SUBTABS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
            style={{
              fontFamily: "Inter",
              fontWeight: 500,
              background: sub === s.key ? "#1E2A38" : "transparent",
              color: sub === s.key ? "#EAE7E0" : "#8A93A0",
              border: sub === s.key ? "1px solid #2A3949" : "1px solid transparent",
            }}
          >
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>

      {sub === "overview" && (
        <PortfolioOverview
          investmentNetWorth={investmentNetWorth}
          investmentCostBasis={investmentCostBasis}
          investmentTotalPL={investmentTotalPL}
          investmentTotalPLPct={investmentTotalPLPct}
          goalProgress={goalProgress}
          netWorthGoal={data.portfolioSettings?.netWorthGoal || 0}
          investmentAllocation={investmentAllocation}
          usdThbRate={usdThbRate}
          PIE_COLORS={PIE_COLORS}
          updateSettings={updateSettings}
          liveRates={liveRates}
          isLiveRate={isLiveRate}
          fetchLiveRates={fetchLiveRates}
          stockApiKey={data.portfolioSettings?.stockApiKey}
        />
      )}

      {sub === "cash" && (
        <CashSection
          cashAccounts={data.cashAccounts}
          cashTotal={cashTotal}
          setModal={setModal}
          removeItem={removeItem}
          updateItem={updateItem}
          liveRates={liveRates}
          fetchLiveRates={fetchLiveRates}
          getLiveRateToThb={getLiveRateToThb}
        />
      )}

      {sub === "domestic" && (
        <FundSection
          title="กองทุนในประเทศ (RMF / Mutual Funds)"
          items={domesticFundsWithDrift}
          totalValue={domesticFundsValue}
          totalCost={domesticFundsCost}
          currencySymbol="฿"
          modalType="domesticFund"
          removeKey="domesticFunds"
          setModal={setModal}
          removeItem={removeItem}
          updateItem={updateItem}
        />
      )}

      {sub === "offshore" && (
        <FundSection
          title="หุ้นต่างประเทศ (Offshore)"
          items={offshoreStocksWithDrift}
          totalValue={offshoreValueUSD}
          plValue={offshoreStockHoldingsUSD}
          totalCost={offshoreCostUSD}
          totalValueTHB={offshoreValueTHB}
          currencySymbol="$"
          modalType="offshoreStock"
          removeKey="offshoreStocks"
          setModal={setModal}
          removeItem={removeItem}
          updateItem={updateItem}
          showValueTHB
          enableLivePrice
          fetchStockPrice={fetchStockPrice}
          enableLots
        />
      )}

      {sub === "offshore" && (
        <BrokerCashCard brokerCash={data.offshoreBrokerCash} setField={setField} usdThbRate={usdThbRate} />
      )}

      {sub === "offshore" && (
        <RealizedGainsCard offshoreStocks={data.offshoreStocks} setModal={setModal} removeOffshoreSale={removeOffshoreSale} />
      )}

      {sub === "offshore" && (
        <FxRemittanceCard remittances={data.fxRemittances} setModal={setModal} removeItem={removeItem} updateItem={updateItem} usdThbRate={usdThbRate} offshoreValueUSD={offshoreValueUSD} />
      )}

      {sub === "realEstate" && (
        <RealEstateSection realEstate={data.realEstate} totalValue={realEstateValue} totalCost={realEstateCost} setModal={setModal} removeItem={removeItem} updateItem={updateItem} />
      )}

      {sub === "metals" && (
        <MetalsSection metals={data.preciousMetals} totalValue={preciousMetalsValue} totalCost={preciousMetalsCost} setModal={setModal} removeItem={removeItem} updateItem={updateItem} />
      )}

      {sub === "business" && (
        <BusinessEquitySection items={data.businessEquity} totalValue={businessEquityValue} totalCost={businessEquityCost} setModal={setModal} removeItem={removeItem} updateItem={updateItem} />
      )}
    </div>
  );
}

function PortfolioOverview({ investmentNetWorth, investmentCostBasis, investmentTotalPL, investmentTotalPLPct, goalProgress, netWorthGoal, investmentAllocation, usdThbRate, PIE_COLORS, updateSettings, liveRates, isLiveRate, fetchLiveRates, stockApiKey }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div style={{ fontSize: "12px", color: "#8A93A0", letterSpacing: "0.05em", textTransform: "uppercase" }}>มูลค่าพอร์ตรวม (Investments Corner)</div>
          <div style={{ fontFamily: "Fraunces", fontSize: "3rem", fontWeight: 500, lineHeight: 1.05, marginTop: 6 }}>{fmtTHB(investmentNetWorth)}</div>
          <div className="flex items-center gap-2 mt-2" style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: investmentTotalPL >= 0 ? "#4FA37B" : "#C1554A" }}>
            {investmentTotalPL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {investmentTotalPL >= 0 ? "+" : ""}{fmtTHB(investmentTotalPL)} ({investmentTotalPLPct.toFixed(1)}%)
            <span style={{ color: "#8A93A0", fontFamily: "Inter" }}>เทียบต้นทุนรวม {fmtTHB(investmentCostBasis)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2" style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: "#EAE7E0" }}>
            <Target size={13} color="#8A93A0" /> USD/THB: <strong>{usdThbRate.toFixed(2)}</strong>
            {isLiveRate ? (
              <span className="px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "10px", fontFamily: "Inter" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4FA37B" }} /> LIVE
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full" style={{ background: "#8A93A022", color: "#8A93A0", fontSize: "10px", fontFamily: "Inter" }}>manual</span>
            )}
            <button onClick={fetchLiveRates} disabled={liveRates.status === "loading"} title="รีเฟรชอัตราแลกเปลี่ยนสด" style={{ color: "#8A93A0" }}>
              <TrendingUp size={13} style={{ transform: liveRates.status === "loading" ? "rotate(180deg)" : "none", transition: "transform 0.3s" }} />
            </button>
          </div>
          {!isLiveRate && (
            <div className="flex items-center gap-1.5" style={{ fontFamily: "JetBrains Mono", fontSize: "11.5px", color: "#8A93A0" }}>
              ใช้ค่ากรอกเอง: <EditableNumber value={usdThbRate} onSave={(v) => updateSettings("portfolioSettings", { usdThbRate: v })} />
            </div>
          )}
          <span style={{ fontSize: "10.5px", color: "#8A93A0" }}>
            {liveRates.status === "loading" ? "กำลังอัปเดต..." : liveRates.status === "error" ? liveRates.error : liveRates.updatedAt ? `อัปเดตล่าสุด: ${new Date(liveRates.updatedAt).toLocaleString("th-TH")}` : ""}
          </span>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.02rem" }}>เชื่อมต่อดึงราคาหุ้นสด</div>
          <span
            className="px-2 py-0.5 rounded-full"
            style={{ background: stockApiKey ? "#4FA37B22" : "#C9A22722", color: stockApiKey ? "#4FA37B" : "#C9A227", fontSize: "10.5px", fontWeight: 600 }}
          >
            {stockApiKey ? "เชื่อมต่อแล้ว" : "ยังไม่ได้ตั้งค่า"}
          </span>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 14, lineHeight: 1.6 }}>
          ปุ่ม "ดึงราคาทั้งหมด" ในหน้าหุ้นต่างประเทศ/กองทุนต้องใช้ API key ฟรีจาก Finnhub (สมัครฟรี ไม่ต้องใช้บัตรเครดิต ใช้เวลา ~30 วินาที)
          — ไปที่{" "}
          <a href="https://finnhub.io/register" target="_blank" rel="noreferrer" style={{ color: "#C9A227", textDecoration: "underline" }}>
            finnhub.io/register
          </a>{" "}
          สมัครแล้วคัดลอก API key มาวางที่นี่
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={stockApiKey || ""}
            onChange={(e) => updateSettings("portfolioSettings", { stockApiKey: e.target.value.trim() })}
            placeholder="วาง Finnhub API key ที่นี่"
            className="flex-1 px-3 py-2 rounded-lg outline-none text-sm"
            style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "JetBrains Mono" }}
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>เป้าหมาย Net Worth</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px", color: "#8A93A0" }}>
            {fmtTHB(investmentNetWorth)} / <EditableNumber value={netWorthGoal} onSave={(v) => updateSettings("portfolioSettings", { netWorthGoal: v })} /> บาท
            <span style={{ color: goalProgress >= 100 ? "#4FA37B" : "#C9A227", marginLeft: 8 }}>{goalProgress.toFixed(1)}%</span>
          </div>
        </div>
        <div style={{ height: 10, borderRadius: 5, background: "#101820", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${goalProgress}%`, background: goalProgress >= 100 ? "#4FA37B" : "#C9A227", borderRadius: 5, transition: "width 0.4s ease" }} />
        </div>
      </Card>

      <Card className="p-6">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem", marginBottom: 16 }}>สัดส่วนสินทรัพย์ลงทุน</div>
        {investmentAllocation.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={investmentAllocation} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {investmentAllocation.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#101820" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }} labelStyle={{ color: "#EAE7E0" }} itemStyle={{ color: "#EAE7E0" }} formatter={(v) => fmtTHB(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {investmentAllocation.map((a, i) => (
                <div key={a.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {a.name}
                  </span>
                  <span style={{ fontFamily: "JetBrains Mono", color: "#8A93A0" }}>
                    {fmtCompact(a.value)} ({investmentAllocation.reduce((s, x) => s + x.value, 0) ? ((a.value / investmentAllocation.reduce((s, x) => s + x.value, 0)) * 100).toFixed(1) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState text="ยังไม่มีข้อมูลสินทรัพย์ลงทุน" />
        )}
      </Card>
    </div>
  );
}

function CashSection({ cashAccounts, cashTotal, setModal, removeItem, updateItem, liveRates, fetchLiveRates, getLiveRateToThb }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>เงินสด & บัญชีเงินฝาก</div>
          <div className="flex items-center gap-2" style={{ fontSize: "12px", color: "#8A93A0" }}>
            รวม {fmtTHB(cashTotal)}
            {liveRates.status === "success" && (
              <span className="px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "9.5px" }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#4FA37B" }} /> LIVE FX
              </span>
            )}
            <button onClick={fetchLiveRates} disabled={liveRates.status === "loading"} title="รีเฟรชอัตราแลกเปลี่ยนสด" style={{ color: "#8A93A0" }}>
              <TrendingUp size={12} style={{ transform: liveRates.status === "loading" ? "rotate(180deg)" : "none", transition: "transform 0.3s" }} />
            </button>
          </div>
        </div>
        <button onClick={() => setModal({ type: "cashAccount" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
          <Plus size={13} /> เพิ่มบัญชี
        </button>
      </div>
      {cashAccounts.length ? (
        <div className="overflow-x-auto mt-4">
          <table>
            <thead>
              <tr>
                <th>ชื่อบัญชี</th><th>ประเภท</th><th style={{ textAlign: "right" }}>จำนวน</th><th>สกุลเงิน</th>
                <th style={{ textAlign: "right" }}>Yield %</th><th style={{ textAlign: "right" }}>อัตรา→THB</th>
                <th style={{ textAlign: "right" }}>มูลค่า (THB)</th><th style={{ textAlign: "center" }}>Emergency Fund</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cashAccounts.map((c) => {
                const liveRate = getLiveRateToThb(c.currency);
                const rate = liveRate !== null ? liveRate : Number(c.fxToThb || 1);
                const valueThb = Number(c.amount || 0) * rate;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ color: "#8A93A0", fontSize: "12.5px" }}>{c.subCategory}</td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                      <EditableNumber value={c.amount} onSave={(v) => updateItem("cashAccounts", c.id, { amount: v })} />
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }}>{c.currency}</td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                      <EditableNumber value={c.yieldPct || 0} onSave={(v) => updateItem("cashAccounts", c.id, { yieldPct: v })} />%
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: liveRate !== null ? "#4FA37B" : "#8A93A0" }}>
                      {c.currency === "THB" ? "-" : rate.toFixed(4)}
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{fmtTHB(valueThb)}</td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!c.isEmergencyFund}
                        onChange={(e) => updateItem("cashAccounts", c.id, { isEmergencyFund: e.target.checked })}
                        style={{ accentColor: "#C9A227", width: 15, height: 15, cursor: "pointer" }}
                        title="นับเป็นเงินสำรองฉุกเฉิน (Emergency Fund)"
                      />
                    </td>
                    <td><button onClick={() => removeItem("cashAccounts", c.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="ยังไม่มีบัญชีเงินสด" />
      )}
    </Card>
  );
}

// Aggregates every FIFO sale recorded across all offshore stocks into one realized gain/loss log
function RealizedGainsCard({ offshoreStocks, setModal, removeOffshoreSale }) {
  const sales = offshoreStocks
    .flatMap((st) => (st.sales || []).map((s) => ({ ...s, stockId: st.id, stockName: st.name, symbol: st.symbol })))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalRealized = sales.reduce((s, r) => s + Number(r.realizedGainLoss || 0), 0);
  const thisYear = new Date().getFullYear();
  const ytdRealized = sales.filter((s) => new Date(s.date).getFullYear() === thisYear).reduce((s, r) => s + Number(r.realizedGainLoss || 0), 0);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>ประวัติขาย · Realized Gains</div>
          <button
            onClick={() => setModal({ type: "offshoreManualSale" })}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
            style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#8A93A0" }}
            title="กรอกรายการขายเอง เช่น รายการเก่าก่อนเริ่มใช้ระบบล็อต"
          >
            <Plus size={11} /> เพิ่มรายการเอง
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div style={{ fontSize: "10px", color: "#8A93A0" }}>กำไร/ขาดทุนจริงปีนี้</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: ytdRealized >= 0 ? "#4FA37B" : "#C1554A" }}>
              {ytdRealized >= 0 ? "+" : ""}${ytdRealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="text-right">
            <div style={{ fontSize: "10px", color: "#8A93A0" }}>สะสมทั้งหมด</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: totalRealized >= 0 ? "#4FA37B" : "#C1554A" }}>
              {totalRealized >= 0 ? "+" : ""}${totalRealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 14 }}>คำนวณแบบ FIFO (ตัดล็อตเก่าสุดก่อน) จากปุ่ม "ขาย" ในตารางด้านบน</div>
      {sales.length ? (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>วันที่ขาย</th><th>หุ้น/กองทุน</th><th style={{ textAlign: "right" }}>จำนวน</th>
                <th style={{ textAlign: "right" }}>ราคาขาย</th><th style={{ textAlign: "right" }}>ต้นทุน (FIFO)</th>
                <th style={{ textAlign: "right" }}>กำไร/ขาดทุนจริง</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                // Flag both explicitly-marked records and older records saved before this check existed
                // (recognizable by $0 cost basis on a non-zero sale — a strong sign the bug hit them)
                const looksSuspicious = s.incompleteCostBasis || (Number(s.costBasis) === 0 && Number(s.unitsSold) > 0);
                return (
                  <tr key={s.id}>
                    <td style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#8A93A0" }}>{s.date}</td>
                    <td>
                      {s.stockName} <span style={{ color: "#8A93A0", fontSize: "11.5px" }}>({s.symbol})</span>
                      {looksSuspicious && (
                        <span
                          className="ml-1.5 px-1.5 py-0.5 rounded-full"
                          style={{ background: "#C9A22722", color: "#C9A227", fontSize: "9px", fontWeight: 600 }}
                          title="ต้นทุนบางส่วน/ทั้งหมดไม่มีข้อมูลล็อตรองรับ (ต้นทุน 0 บาท) ตัวเลขกำไรนี้อาจสูงเกินจริง — ลองตรวจสอบ/ลบแล้วบันทึกใหม่"
                        >
                          ⚠ ต้นทุนไม่ครบ
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{s.unitsSold.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>${s.salePricePerUnit.toFixed(2)}</td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#8A93A0" }}>${s.costBasis.toFixed(2)}</td>
                    <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: s.realizedGainLoss >= 0 ? "#4FA37B" : "#C1554A" }}>
                      {s.realizedGainLoss >= 0 ? "+" : ""}${s.realizedGainLoss.toFixed(2)}
                    </td>
                    <td>
                      <button onClick={() => removeOffshoreSale(s.stockId, s.id)} style={{ color: "#8A93A0" }} title="ลบรายการนี้ (คืนหน่วยกลับล็อตเดิมให้)">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="ยังไม่มีประวัติขาย — ใช้ปุ่ม 'ขาย' ในตารางด้านบนเพื่อบันทึก" />
      )}
    </Card>
  );
}

// Logs money moving in/out of Thailand tied to offshore investing, with a factual reminder about the current
// Thai foreign-sourced-income remittance tax rule — informational only, not tax advice.
// Cash sitting uninvested at each offshore broker — e.g. proceeds from a sale that haven't been reinvested
// or remitted back to Thailand yet. Auto-credited when a sale is recorded; editable here for manual corrections
// (fresh cash deposited, withdrawals not yet logged as a remittance, etc).
function BrokerCashCard({ brokerCash, setField, usdThbRate }) {
  const [newBroker, setNewBroker] = useState("");
  const entries = Object.entries(brokerCash || {});
  const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0);

  const updateBroker = (broker, value) => setField("offshoreBrokerCash", { ...brokerCash, [broker]: Number(value) || 0 });
  const removeBroker = (broker) => {
    const next = { ...brokerCash };
    delete next[broker];
    setField("offshoreBrokerCash", next);
  };
  const addBroker = () => {
    if (!newBroker.trim()) return;
    setField("offshoreBrokerCash", { ...brokerCash, [newBroker.trim()]: 0 });
    setNewBroker("");
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>เงินสดคงเหลือในโบรกเกอร์ต่างประเทศ</div>
        <div className="text-right">
          <div style={{ fontSize: "10px", color: "#8A93A0" }}>รวม</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: "#4FA37B" }}>
            ${total.toLocaleString()} <span style={{ color: "#8A93A0" }}>(≈ {fmtCompact(total * usdThbRate)})</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 14 }}>
        เพิ่มเข้าอัตโนมัติทุกครั้งที่กด "ขาย" หุ้น (เงินไม่หายไปไหน แค่ยังไม่ได้ลงทุนต่อหรือโอนกลับไทย) — แก้ไขเองได้ถ้ายอดจริงไม่ตรง
      </div>
      {entries.length ? (
        <div className="flex flex-col gap-2 mb-3">
          {entries.map(([broker, amount]) => (
            <div key={broker} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
              <span style={{ fontSize: "13px", flex: 1 }}>{broker}</span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }}>
                $<EditableNumber value={amount} onSave={(v) => updateBroker(broker, v)} />
              </span>
              <button onClick={() => removeBroker(broker)} style={{ color: "#8A93A0" }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="ยังไม่มีเงินสดคงเหลือที่โบรกเกอร์ — จะเพิ่มให้อัตโนมัติเมื่อมีการขายหุ้น" />
      )}
      <div className="flex items-center gap-2">
        <input
          value={newBroker}
          onChange={(e) => setNewBroker(e.target.value)}
          placeholder="ชื่อโบรกเกอร์ใหม่ เช่น Interactive Brokers"
          className="flex-1 px-3 py-2 rounded-lg outline-none text-xs"
          style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
        />
        <button onClick={addBroker} className="px-3 py-2 rounded-lg text-xs" style={{ background: "#1E2A38", color: "#8A93A0", border: "1px solid #2A3949" }}>
          <Plus size={13} />
        </button>
      </div>
    </Card>
  );
}

function FxRemittanceCard({ remittances, setModal, removeItem, updateItem, usdThbRate, offshoreValueUSD }) {
  const sorted = [...remittances].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Group totals by currency, since the log can mix THB and USD entries
  const totalsByCurrency = (direction) => {
    const map = {};
    remittances.filter((r) => r.direction === direction).forEach((r) => {
      const cur = r.currency || "THB";
      map[cur] = (map[cur] || 0) + Number(r.amount || 0);
    });
    return map;
  };
  const inTotals = totalsByCurrency("in");
  const outTotals = totalsByCurrency("out");
  const fmtTotals = (totals) => {
    const entries = Object.entries(totals);
    if (!entries.length) return "-";
    return entries.map(([cur, amt]) => `${cur === "THB" ? "฿" : cur + " "}${amt.toLocaleString()}`).join(" + ");
  };

  // Converts an amount to USD for the XIRR calc (so it lines up with offshoreValueUSD, which is always USD)
  const toUSD = (amount, currency) => (currency === "THB" ? amount / usdThbRate : amount);

  // XIRR: money sent out = negative cash flow, money brought back = positive, current portfolio value = final positive cash flow "today"
  const xirr = useMemo(() => {
    const flows = remittances.map((r) => ({
      date: new Date(r.date),
      amount: (r.direction === "out" ? -1 : 1) * toUSD(Number(r.amount || 0), r.currency || "THB"),
    }));
    if (offshoreValueUSD > 0) flows.push({ date: new Date(), amount: offshoreValueUSD });
    return calcXIRR(flows);
  }, [remittances, offshoreValueUSD, usdThbRate]);

  // Simple total return — plain arithmetic (no root-finding), used as an easy cross-check against XIRR.
  // Ignores timing entirely, so it won't match XIRR exactly, but if the two disagree wildly in direction
  // (one positive, one very negative, or vice versa) that's a sign something is worth double-checking.
  const simpleReturn = useMemo(() => {
    const totalOutUSD = remittances.filter((r) => r.direction === "out").reduce((s, r) => s + toUSD(Number(r.amount || 0), r.currency || "THB"), 0);
    const totalInUSD = remittances.filter((r) => r.direction === "in").reduce((s, r) => s + toUSD(Number(r.amount || 0), r.currency || "THB"), 0);
    if (!totalOutUSD) return null;
    return ((totalInUSD + offshoreValueUSD) / totalOutUSD - 1) * 100;
  }, [remittances, offshoreValueUSD, usdThbRate]);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem" }}>เงินโอนเข้า-ออกต่างประเทศ · FX Remittance Log</div>
        <button
          onClick={() => setModal({ type: "fxRemittance" })}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
          style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
        >
          <Plus size={12} /> บันทึกรายการ
        </button>
      </div>
      <div className="flex flex-col gap-1.5 mb-1">
        {xirr !== null && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg flex-wrap" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <TrendingUp size={14} color={xirr >= 0 ? "#4FA37B" : "#C1554A"} />
            <span style={{ fontSize: "12px", color: "#8A93A0" }}>ผลตอบแทนสะสม (XIRR ถ่วงเวลา รวมมูลค่าปัจจุบันเป็นเงินก้อนสุดท้าย):</span>
            <span style={{ fontFamily: "JetBrains Mono", fontSize: "13.5px", color: xirr >= 0 ? "#4FA37B" : "#C1554A", fontWeight: 600 }}>
              {xirr >= 0 ? "+" : ""}{(xirr * 100).toFixed(1)}%/ปี
            </span>
          </div>
        )}
        {simpleReturn !== null && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg flex-wrap" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <Scale size={14} color={simpleReturn >= 0 ? "#4FA37B" : "#C1554A"} />
            <span style={{ fontSize: "12px", color: "#8A93A0" }}>ผลตอบแทนรวมแบบง่าย (ไม่ถ่วงเวลา — ใช้เช็คทาน XIRR):</span>
            <span style={{ fontFamily: "JetBrains Mono", fontSize: "13.5px", color: simpleReturn >= 0 ? "#4FA37B" : "#C1554A", fontWeight: 600 }}>
              {simpleReturn >= 0 ? "+" : ""}{simpleReturn.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
      <div style={{ fontSize: "9.5px", color: "#8A93A0", marginBottom: 12 }}>
        * แม่นยำเท่าที่บันทึกครบเท่านั้น — ถ้ามีเงินที่ลงทุนไปก่อนเริ่มบันทึก Log นี้ หรือเงินปันผลที่ไม่ผ่านการโอนเข้า-ออก ตัวเลขนี้จะคลาดเคลื่อน (มักดูดีเกินจริง) · รายการสกุล THB แปลงเป็น USD ด้วยอัตราแลกเปลี่ยนปัจจุบันก่อนคำนวณ · ถ้าตัวเลขสองบรรทัดนี้สวนทางกันชัดเจน (บวก vs ลบมาก) ให้สงสัยว่าข้อมูลไม่ครบ
      </div>
      <div className="p-3 rounded-lg mb-4" style={{ background: "#101820", border: "1px solid #2A3949" }}>
        <div style={{ fontSize: "11.5px", color: "#C9A227", fontWeight: 600, marginBottom: 4 }}>⚠️ กฎภาษีปัจจุบัน (ไม่ใช่คำแนะนำทางภาษี)</div>
        <div style={{ fontSize: "11px", color: "#8A93A0", lineHeight: 1.6 }}>
          ตามคำสั่งกรมสรรพากร ป.161/162 (มีผล 1 ม.ค. 2567) เงินได้จากต่างประเทศที่หาได้ตั้งแต่ปี 2567 เป็นต้นไป
          หากโอนเข้าไทยเมื่อไหร่ก็ตาม (ไม่ว่ากี่ปีให้หลัง) ต้องนำมารวมคำนวณภาษีเงินได้บุคคลธรรมดา ถ้าตอนที่หาได้คุณเป็นผู้มีถิ่นที่อยู่ภาษีไทย (อยู่ไทย ≥180 วัน/ปีนั้น)
          — มีข่าวเสนอผ่อนปรนให้โอนภายใน 2 ปีไม่ต้องเสียภาษี แต่ <b>ยังไม่ผ่านเป็นกฎหมาย</b> ให้ยึดกฎปัจจุบันไปก่อน และปรึกษาผู้เชี่ยวชาญด้านภาษี/บัญชีก่อนโอนเงินก้อนใหญ่กลับไทยเสมอ
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
          <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>โอนเข้าไทยสะสม</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#4FA37B", marginTop: 3 }}>{fmtTotals(inTotals)}</div>
        </div>
        <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
          <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>โอนออกสะสม</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#C1554A", marginTop: 3 }}>{fmtTotals(outTotals)}</div>
        </div>
      </div>
      {sorted.length ? (
        <div className="flex flex-col gap-2">
          {sorted.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
              <span
                className="px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: r.direction === "in" ? "#4FA37B22" : "#C1554A22", color: r.direction === "in" ? "#4FA37B" : "#C1554A", fontSize: "9.5px", fontWeight: 600 }}
              >
                {r.direction === "in" ? "🔽 เข้าไทย" : "🔼 ออกนอก"}
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "11.5px", color: "#8A93A0", minWidth: 78 }}>{r.date}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: "12.5px" }}>
                  <EditableText value={r.purpose || "ระบุโบรกเกอร์..."} onSave={(v) => updateItem("fxRemittances", r.id, { purpose: v })} style={{ fontSize: "12.5px" }} />
                </div>
                {r.note && <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>{r.note}</div>}
              </div>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "13px", color: r.direction === "in" ? "#4FA37B" : "#C1554A" }}>
                {r.direction === "in" ? "+" : "-"}{r.currency} {Number(r.amount).toLocaleString()}
              </span>
              <button onClick={() => removeItem("fxRemittances", r.id)} style={{ color: "#8A93A0" }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="ยังไม่มีบันทึกเงินโอนเข้า-ออก — เพิ่มด้วยปุ่มด้านบน" />
      )}
    </Card>
  );
}

function FundSection({ title, items, totalValue, totalCost, totalValueTHB, currencySymbol, modalType, removeKey, setModal, removeItem, updateItem, showValueTHB, enableLivePrice, fetchStockPrice, enableLots, plValue }) {
  // P/L should only compare invested capital (stock holdings) against its cost — uninvested cash sitting at
  // a broker has no cost basis and isn't "profit", so it must be excluded here even though it's part of totalValue.
  const gainBaseValue = plValue !== undefined ? plValue : totalValue;
  const gain = gainBaseValue - totalCost;
  const gainPct = totalCost ? (gain / totalCost) * 100 : 0;
  const [priceStatus, setPriceStatus] = useState({}); // { [id]: 'loading' | 'error' | 'success' }
  const [bulkLoading, setBulkLoading] = useState(false);
  const [hideSoldOut, setHideSoldOut] = useState(true);
  const soldOutCount = items.filter((it) => enableLots && Number(it.units) === 0).length;
  const visibleItems = hideSoldOut ? items.filter((it) => !(enableLots && Number(it.units) === 0)) : items;

  async function fetchOne(it) {
    if (!it.symbol) return;
    setPriceStatus((s) => ({ ...s, [it.id]: "loading" }));
    try {
      const price = await fetchStockPrice(it.symbol);
      updateItem(removeKey, it.id, { currentPrice: price });
      setPriceStatus((s) => ({ ...s, [it.id]: "success" }));
    } catch (e) {
      const msg = e.message === "no_api_key" ? "ยังไม่ได้ตั้งค่า Finnhub API key — ไปตั้งค่าในแท็บภาพรวมของพอร์ตลงทุนก่อน" : "ดึงราคาไม่สำเร็จ ลองใหม่";
      setPriceStatus((s) => ({ ...s, [it.id]: { status: "error", msg } }));
    }
  }

  async function fetchAll() {
    setBulkLoading(true);
    for (const it of items) {
      if (it.symbol) await fetchOne(it);
    }
    setBulkLoading(false);
  }

  // Auto-refresh prices once whenever this section is opened — the whole point of the manual button
  // was to avoid stale prices, so doing it automatically on load is strictly easier for the person.
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (enableLivePrice && !autoFetchedRef.current) {
      autoFetchedRef.current = true;
      fetchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <CompactStatRow
        items={[
          { label: "มูลค่าปัจจุบัน", value: `${currencySymbol}${Math.round(totalValue).toLocaleString()}`, icon: LineChartIcon, accent: "#C9A227" },
          ...(showValueTHB ? [{ label: "≈ คิดเป็นบาท", value: fmtCompact(totalValueTHB), icon: Wallet, accent: "#5B84B1" }] : []),
          { label: "ต้นทุนรวม", value: `${currencySymbol}${Math.round(totalCost).toLocaleString()}`, icon: Wallet, accent: "#5B84B1" },
          {
            label: "กำไร/ขาดทุน",
            value: `${gain >= 0 ? "+" : "-"}${currencySymbol}${Math.round(Math.abs(gain)).toLocaleString()} (${gainPct.toFixed(1)}%)`,
            icon: gain >= 0 ? TrendingUp : TrendingDown,
            accent: gain >= 0 ? "#4FA37B" : "#C1554A",
          },
        ]}
      />
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>{title}</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>
              แตะ จำนวนหน่วย / ต้นทุน / ราคา / เป้าหมาย% / DCA / Broker เพื่อแก้ไข — มูลค่า กำไร/ขาดทุน สัดส่วน และ Drift คำนวณให้อัตโนมัติ
              {enableLivePrice && " • ราคาปัจจุบันดึงจากตลาดสดได้ (ปุ่มลูกศรข้างราคา)"}
              {enableLots && " • ใช้ปุ่ม +ล็อต/ขาย เพื่อบันทึกแบบ lot-by-lot (FIFO) สำหรับคำนวณภาษี"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {enableLots && soldOutCount > 0 && (
              <button
                onClick={() => setHideSoldOut((h) => !h)}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs"
                style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#8A93A0" }}
                title="สลับซ่อน/แสดงหุ้นที่ขายหมดแล้ว (0 หน่วย)"
              >
                {hideSoldOut ? `+${soldOutCount} ที่ขายหมดแล้ว (ซ่อนอยู่)` : `ซ่อนที่ขายหมดแล้ว (${soldOutCount})`}
              </button>
            )}
            {enableLivePrice && (
              <button
                onClick={fetchAll}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
                style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0" }}
              >
                <TrendingUp size={13} style={{ transform: bulkLoading ? "rotate(180deg)" : "none", transition: "transform 0.3s" }} />
                {bulkLoading ? "กำลังดึงราคา..." : "ดึงราคาทั้งหมด"}
              </button>
            )}
            <button onClick={() => setModal({ type: modalType })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
              <Plus size={13} /> เพิ่มรายการ
            </button>
          </div>
        </div>
        {visibleItems.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ชื่อ</th><th>สัญลักษณ์</th><th>Broker</th><th style={{ textAlign: "right" }}>จำนวนหน่วย</th>
                  <th style={{ textAlign: "right" }}>ต้นทุนเฉลี่ย</th><th style={{ textAlign: "right" }}>ราคาปัจจุบัน</th>
                  <th style={{ textAlign: "right" }}>มูลค่า</th><th style={{ textAlign: "right" }}>กำไร/ขาดทุน</th>
                  <th style={{ textAlign: "right" }}>เป้าหมาย%</th><th style={{ textAlign: "right" }}>สัดส่วนจริง</th><th style={{ textAlign: "right" }}>Drift</th>
                  <th style={{ textAlign: "right" }}>DCA/เดือน</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((it) => {
                  const value = Number(it.units || 0) * Number(it.currentPrice || 0);
                  const cost = Number(it.units || 0) * Number(it.avgPrice || 0);
                  const itemGain = value - cost;
                  const itemGainPct = cost ? (itemGain / cost) * 100 : 0;
                  return (
                    <tr key={it.id}>
                      <td>{it.name}</td>
                      <td style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#8A93A0" }}>{it.symbol}</td>
                      <td style={{ fontSize: "12px" }}>
                        <EditableText value={it.broker || "-"} onSave={(v) => updateItem(removeKey, it.id, { broker: v })} style={{ fontSize: "12px" }} listId="broker-suggestions-list" />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        {it.lots && it.lots.length > 0 ? (
                          <span title="คำนวณจากล็อตที่บันทึกไว้ — แก้ไขที่ล็อตแทน">{it.units.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        ) : (
                          <EditableNumber value={it.units} onSave={(v) => updateItem(removeKey, it.id, { units: v })} />
                        )}
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        {it.lots && it.lots.length > 0 ? (
                          <span title="คำนวณจากล็อตที่บันทึกไว้ — แก้ไขที่ล็อตแทน">{it.avgPrice.toFixed(2)}</span>
                        ) : (
                          <EditableNumber value={it.avgPrice} onSave={(v) => updateItem(removeKey, it.id, { avgPrice: v })} />
                        )}
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <span className="flex items-center gap-1 justify-end">
                          <EditableNumber value={it.currentPrice} onSave={(v) => updateItem(removeKey, it.id, { currentPrice: v })} />
                          {enableLivePrice && it.symbol && (
                            <button
                              onClick={() => fetchOne(it)}
                              disabled={priceStatus[it.id] === "loading"}
                              title={priceStatus[it.id]?.status === "error" ? priceStatus[it.id].msg : "ดึงราคาล่าสุดจากตลาด"}
                              style={{ color: priceStatus[it.id]?.status === "error" ? "#C1554A" : priceStatus[it.id] === "success" ? "#4FA37B" : "#8A93A0" }}
                            >
                              <TrendingUp size={11} style={{ transform: priceStatus[it.id] === "loading" ? "rotate(180deg)" : "none", transition: "transform 0.3s" }} />
                            </button>
                          )}
                        </span>
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{currencySymbol}{Math.round(value).toLocaleString()}</td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: itemGain >= 0 ? "#4FA37B" : "#C1554A" }}>
                        {itemGain >= 0 ? "+" : ""}{itemGainPct.toFixed(1)}%
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#8A93A0" }}>
                        <EditableNumber value={it.targetPct} onSave={(v) => updateItem(removeKey, it.id, { targetPct: v })} />%
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#8A93A0" }}>{it.weightPct.toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}><DriftBadge drift={it.drift} /></td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#8A93A0" }}>
                        <EditableNumber value={it.dcaMonth || 0} onSave={(v) => updateItem(removeKey, it.id, { dcaMonth: v })} />
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 justify-end">
                          {enableLots && (
                            <>
                              <button
                                onClick={() => setModal({ type: "offshoreLot", stockId: it.id, stockName: it.name })}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{ background: "#1E2A38", color: "#8A93A0" }}
                                title="เพิ่มล็อตซื้อ"
                              >
                                +ล็อต
                              </button>
                              <button
                                onClick={() => setModal({ type: "offshoreSell", stockId: it.id, stockName: it.name, availableUnits: it.units })}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{
                                  background: it.units ? "#C1554A22" : "#2A3949",
                                  color: it.units ? "#C1554A" : "#5A6472",
                                  cursor: it.units ? "pointer" : "not-allowed",
                                }}
                                title={it.units ? "บันทึกการขาย (FIFO)" : "ไม่มีหน่วยให้ขาย"}
                                disabled={!it.units}
                              >
                                ขาย
                              </button>
                            </>
                          )}
                          <button onClick={() => removeItem(removeKey, it.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text={items.length ? "ทั้งหมดขายหมดแล้ว — กดปุ่มด้านบนเพื่อแสดงกลับมา" : "ยังไม่มีรายการ — เพิ่มด้วยปุ่มด้านบน"} />
        )}
      </Card>
    </div>
  );
}

function RealEstateSection({ realEstate, totalValue, totalCost, setModal, removeItem, updateItem }) {
  const gain = totalValue - totalCost;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="มูลค่าปัจจุบันรวม" value={fmtCompact(totalValue)} icon={Home} accent="#C9A227" />
        <StatCard label="ต้นทุนซื้อรวม" value={fmtCompact(totalCost)} icon={Wallet} accent="#5B84B1" />
      </div>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>อสังหาริมทรัพย์</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>แตะ ชื่อ / ราคาซื้อ / มูลค่าปัจจุบัน เพื่อแก้ไข</div>
          </div>
          <button onClick={() => setModal({ type: "realEstate" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
            <Plus size={13} /> เพิ่มรายการ
          </button>
        </div>
        {realEstate.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ชื่อ</th><th>ประเภท</th><th style={{ textAlign: "right" }}>ราคาซื้อ</th>
                  <th style={{ textAlign: "right" }}>มูลค่าปัจจุบัน</th><th style={{ textAlign: "right" }}>รายได้ค่าเช่า/ปี</th>
                  <th style={{ textAlign: "right" }}>กำไร/ขาดทุน</th><th></th>
                </tr>
              </thead>
              <tbody>
                {realEstate.map((r) => {
                  const g = Number(r.currentValue || 0) - Number(r.purchasePrice || 0);
                  const gPct = r.purchasePrice ? (g / r.purchasePrice) * 100 : 0;
                  return (
                    <tr key={r.id}>
                      <td><EditableText value={r.name} onSave={(v) => updateItem("realEstate", r.id, { name: v })} style={{ fontSize: "13px" }} /></td>
                      <td style={{ color: "#8A93A0", fontSize: "12.5px" }}>{r.subCategory}</td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={r.purchasePrice} onSave={(v) => updateItem("realEstate", r.id, { purchasePrice: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={r.currentValue} onSave={(v) => updateItem("realEstate", r.id, { currentValue: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{r.rentalIncomeYr ? fmtTHB(r.rentalIncomeYr) : "-"}</td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: g >= 0 ? "#4FA37B" : "#C1554A" }}>{g >= 0 ? "+" : ""}{gPct.toFixed(1)}%</td>
                      <td><button onClick={() => removeItem("realEstate", r.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="ยังไม่มีอสังหาริมทรัพย์" />
        )}
      </Card>
    </div>
  );
}

function MetalsSection({ metals, totalValue, totalCost, setModal, removeItem, updateItem }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="มูลค่าตลาดรวม" value={fmtCompact(totalValue)} icon={Gem} accent="#C9A227" />
        <StatCard label="ต้นทุนรวม" value={fmtCompact(totalCost)} icon={Wallet} accent="#5B84B1" />
      </div>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>โลหะมีค่าและของสะสม</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>แตะ ชื่อ / จำนวน / ต้นทุน / ราคาตลาด เพื่อแก้ไข</div>
          </div>
          <button onClick={() => setModal({ type: "preciousMetal" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
            <Plus size={13} /> เพิ่มรายการ
          </button>
        </div>
        {metals.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ชื่อ</th><th style={{ textAlign: "right" }}>จำนวน</th><th style={{ textAlign: "right" }}>ต้นทุนเฉลี่ย</th>
                  <th style={{ textAlign: "right" }}>ราคาตลาด</th><th style={{ textAlign: "right" }}>มูลค่า</th>
                  <th style={{ textAlign: "right" }}>กำไร/ขาดทุน</th><th></th>
                </tr>
              </thead>
              <tbody>
                {metals.map((m) => {
                  const value = Number(m.qty || 0) * Number(m.marketPrice || 0);
                  const cost = Number(m.qty || 0) * Number(m.avgCost || 0);
                  const g = value - cost;
                  const gPct = cost ? (g / cost) * 100 : 0;
                  return (
                    <tr key={m.id}>
                      <td><EditableText value={m.name} onSave={(v) => updateItem("preciousMetals", m.id, { name: v })} style={{ fontSize: "13px" }} /></td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={m.qty} onSave={(v) => updateItem("preciousMetals", m.id, { qty: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={m.avgCost} onSave={(v) => updateItem("preciousMetals", m.id, { avgCost: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={m.marketPrice} onSave={(v) => updateItem("preciousMetals", m.id, { marketPrice: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>{fmtTHB(value)}</td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: g >= 0 ? "#4FA37B" : "#C1554A" }}>{g >= 0 ? "+" : ""}{gPct.toFixed(1)}%</td>
                      <td><button onClick={() => removeItem("preciousMetals", m.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="ยังไม่มีโลหะมีค่า" />
        )}
      </Card>
    </div>
  );
}

function BusinessEquitySection({ items, totalValue, totalCost, setModal, removeItem, updateItem }) {
  const totalDividend = items.reduce((s, b) => s + Number(b.dividendYr || 0), 0);
  const avgYield = totalValue ? (totalDividend / totalValue) * 100 : 0;
  return (
    <div className="flex flex-col gap-6">
      <CompactStatRow
        items={[
          { label: "มูลค่ารวม", value: fmtCompact(totalValue), icon: Building2, accent: "#C9A227" },
          { label: "ต้นทุนรวม", value: fmtCompact(totalCost), icon: Wallet, accent: "#5B84B1" },
          { label: "Yield % เฉลี่ย", value: `${avgYield.toFixed(2)}%`, icon: TrendingUp, accent: "#4FA37B" },
        ]}
      />
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>หุ้นธุรกิจส่วนตัว</div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginTop: 2 }}>แตะ ชื่อ / สัดส่วนถือหุ้น / ต้นทุน / มูลค่าปัจจุบัน / เงินปันผล เพื่อแก้ไข</div>
          </div>
          <button onClick={() => setModal({ type: "businessEquity" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
            <Plus size={13} /> เพิ่มรายการ
          </button>
        </div>
        {items.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>ชื่อ</th><th>ประเภท</th><th style={{ textAlign: "right" }}>สัดส่วนถือหุ้น</th>
                  <th style={{ textAlign: "right" }}>ต้นทุน</th><th style={{ textAlign: "right" }}>มูลค่าปัจจุบัน</th>
                  <th style={{ textAlign: "right" }}>เงินปันผล/ปี</th><th style={{ textAlign: "right" }}>Yield %</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const yieldPct = b.currentValue ? (Number(b.dividendYr || 0) / Number(b.currentValue)) * 100 : 0;
                  return (
                    <tr key={b.id}>
                      <td><EditableText value={b.name} onSave={(v) => updateItem("businessEquity", b.id, { name: v })} style={{ fontSize: "13px" }} /></td>
                      <td style={{ color: "#8A93A0", fontSize: "12.5px" }}>{b.subCategory}</td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={b.ownershipPct} onSave={(v) => updateItem("businessEquity", b.id, { ownershipPct: v })} />%
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={b.avgCost} onSave={(v) => updateItem("businessEquity", b.id, { avgCost: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={b.currentValue} onSave={(v) => updateItem("businessEquity", b.id, { currentValue: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                        <EditableNumber value={b.dividendYr} onSave={(v) => updateItem("businessEquity", b.id, { dividendYr: v })} />
                      </td>
                      <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#4FA37B" }}>{yieldPct.toFixed(2)}%</td>
                      <td><button onClick={() => removeItem("businessEquity", b.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="ยังไม่มีหุ้นธุรกิจส่วนตัว" />
        )}
      </Card>
    </div>
  );
}

/* ================= CASHFLOW TAB ================= */

function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthKeyLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_TH[MONTH_ORDER[m - 1]]} ${y + 543}`;
}

function SankeyNode({ x, y, width, height, payload }) {
  const isOut = payload.side === "out";
  const isMid = payload.side === "mid";
  const color = payload.color || "#8A93A0";
  const textX = isMid ? x + width / 2 : isOut ? x + width + 8 : x - 8;
  const anchor = isMid ? "middle" : isOut ? "start" : "end";
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={isMid ? 1 : 0.9} radius={2} />
      {!isMid && (
        <>
          <text x={textX} y={y + height / 2 - 6} textAnchor={anchor} fill="#EAE7E0" fontSize={11} fontFamily="Inter">
            {payload.emoji} {payload.name}
          </text>
          <text x={textX} y={y + height / 2 + 9} textAnchor={anchor} fill="#C9A227" fontSize={10.5} fontFamily="JetBrains Mono">
            {fmtCompact(payload.value)}
          </text>
        </>
      )}
      {isMid && (
        <text x={textX} y={y - 8} textAnchor="middle" fill="#EAE7E0" fontSize={11} fontFamily="Inter">
          🏠 {payload.name} · {fmtCompact(payload.value)}
        </text>
      )}
    </Layer>
  );
}

function SankeyLink(props) {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload } = props;
  const color = payload?.color || "#8A93A0";
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeOpacity={0.32}
      strokeWidth={linkWidth}
    />
  );
}

function CashFlowSankey({ cfBreakdownIn, cfBreakdownOut, cfCashIn, cfCashOut }) {
  const inItems = CASHIN_CATEGORIES.filter((c) => cfBreakdownIn[c.key]);
  const outItems = CASHOUT_CATEGORIES.filter((c) => cfBreakdownOut[c.key]);

  if (!inItems.length || !outItems.length) {
    return <EmptyState text="ยังไม่มีข้อมูลเงินเข้า/เงินออกพอสำหรับแผนภาพนี้" />;
  }

  const nodes = [
    ...inItems.map((c) => ({ name: c.key, side: "in", color: "#4FA37B", emoji: c.emoji })),
    { name: "งบครอบครัว/เดือน", side: "mid", color: "#C9A227" },
    ...outItems.map((c, i) => ({
      name: c.key,
      side: "out",
      color: c.key === "ลงทุน" ? "#4FA37B" : PIE_COLORS_CF[i % PIE_COLORS_CF.length],
      emoji: c.emoji,
    })),
  ];
  const midIndex = inItems.length;
  const links = [
    ...inItems.map((c, i) => ({ source: i, target: midIndex, value: cfBreakdownIn[c.key], color: "#4FA37B" })),
    ...outItems.map((c, i) => ({
      source: midIndex,
      target: midIndex + 1 + i,
      value: cfBreakdownOut[c.key],
      color: c.key === "ลงทุน" ? "#4FA37B" : "#B0885A",
    })),
  ];

  return (
    <ResponsiveContainer width="100%" height={Math.max(inItems.length, outItems.length) * 38 + 60}>
      <Sankey
        data={{ nodes, links }}
        node={<SankeyNode />}
        nodePadding={18}
        nodeWidth={8}
        margin={{ left: 130, right: 150, top: 36, bottom: 10 }}
        link={<SankeyLink />}
      >
        <Tooltip
          contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
          labelStyle={{ color: "#EAE7E0" }}
          itemStyle={{ color: "#EAE7E0" }}
          formatter={(v) => fmtTHB(v)}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}

function CashflowTab({
  cashflowMonth, setCashflowMonth, cashflowMemberFilter, setCashflowMemberFilter, familyMembers,
  cfCashIn, cfCashOut, cfNet, cfOpeningCash, cfClosingCash, cfForecastClosing, cfUnpaidBillsRemaining,
  cfYearMatchesThisYear, cfBreakdownIn, cfBreakdownOut, cfPlanVsActual, cfTimeline, currentMonthKey,
  minCashBuffer, setCashflowOpeningOverride, updateSettings, setModal, removeItem, toggleBillPaid, cfMonthAbbrev,
  cfYearlyFlow, updateItem, categoryExpenseType,
}) {
  const isCurrentMonth = cashflowMonth === currentMonthKey;
  const belowBuffer = cfForecastClosing < Number(minCashBuffer || 0);

  return (
    <div className="flex flex-col gap-6">
      {/* header: month + filters */}
      <Card className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setCashflowMonth(shiftMonthKey(cashflowMonth, -1))} style={{ color: "#8A93A0" }}><ChevronLeft size={18} /></button>
          <div style={{ fontFamily: "Fraunces", fontSize: "1.15rem", minWidth: 130, textAlign: "center" }}>{monthKeyLabel(cashflowMonth)}</div>
          <button onClick={() => setCashflowMonth(shiftMonthKey(cashflowMonth, 1))} style={{ color: "#8A93A0" }}><ChevronRight size={18} /></button>
          {!isCurrentMonth && (
            <button
              onClick={() => setCashflowMonth(currentMonthKey)}
              className="px-2 py-1 rounded-full text-xs ml-1"
              style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#8A93A0" }}
            >
              เดือนนี้
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Users size={13} color="#8A93A0" />
          <select
            value={cashflowMemberFilter}
            onChange={(e) => setCashflowMemberFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
          >
            <option value="all">สมาชิกทั้งหมด</option>
            {familyMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.nickname || m.fullNameTh || "ไม่ระบุชื่อ"}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Yearly cash flow overview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>ภาพรวมกระแสเงินสดทั้งปี {Number(cashflowMonth.slice(0, 4)) + 543}</div>
            <div style={{ fontSize: "11px", color: "#8A93A0" }}>เทียบเงินเข้ากับเงินออกแต่ละเดือน (รวมธุรกรรม + เบี้ยประกัน + ผ่อนหนี้) แตะเดือนเพื่อดูรายละเอียด</div>
          </div>
          <div className="text-right">
            <div style={{ fontSize: "11px", color: "#8A93A0" }}>สุทธิสะสมทั้งปี</div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: "1.3rem",
                color: cfYearlyFlow[cfYearlyFlow.length - 1].cumulative >= 0 ? "#4FA37B" : "#C1554A",
              }}
            >
              {cfYearlyFlow[cfYearlyFlow.length - 1].cumulative >= 0 ? "+" : ""}
              {fmtTHB(cfYearlyFlow[cfYearlyFlow.length - 1].cumulative)}
            </div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0" }}>ยอดที่จัดสรรได้เพิ่มทั้งปี</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={cfYearlyFlow} margin={{ top: 16 }}>
            <CartesianGrid stroke="#1E2A38" vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => MONTH_TH[m]} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={{ stroke: "#2A3949" }} tickLine={false} />
            <YAxis tickFormatter={fmtCompact} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
            <Tooltip
              contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
              labelStyle={{ color: "#EAE7E0" }}
              itemStyle={{ color: "#EAE7E0" }}
              labelFormatter={(m) => MONTH_TH[m]}
              formatter={(v, name) => [fmtTHB(v), name === "cashIn" ? "Cash In" : name === "cashOut" ? "Cash Out" : name === "net" ? "สุทธิเดือนนี้" : "สะสม"]}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Inter", color: "#8A93A0" }} formatter={(v) => (v === "cashIn" ? "Cash In" : "Cash Out")} />
            <Bar dataKey="cashIn" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => setCashflowMonth(d.monthKey)}>
              {cfYearlyFlow.map((m, i) => (
                <Cell key={i} fill="#4FA37B" fillOpacity={m.monthKey === cashflowMonth ? 1 : 0.45} />
              ))}
              <LabelList
                dataKey="net"
                position="top"
                formatter={(v) => `${v >= 0 ? "+" : ""}${fmtCompact(v)}`}
                style={{ fontFamily: "JetBrains Mono", fontSize: 9.5, fill: "#8A93A0" }}
              />
            </Bar>
            <Bar dataKey="cashOut" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => setCashflowMonth(d.monthKey)}>
              {cfYearlyFlow.map((m, i) => (
                <Cell key={i} fill="#C1554A" fillOpacity={m.monthKey === cashflowMonth ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {cfYearlyFlow.map((m) => (
            <button
              key={m.month}
              onClick={() => setCashflowMonth(m.monthKey)}
              className="p-2.5 rounded-lg text-left"
              style={{ background: "#101820", border: `1px solid ${m.monthKey === cashflowMonth ? "#C9A227" : "#1E2A38"}` }}
            >
              <div style={{ fontSize: "11px", color: m.monthKey === cashflowMonth ? "#C9A227" : "#8A93A0" }}>{MONTH_TH[m.month]}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#4FA37B" }}>+{fmtCompact(m.cashIn)}</span>
                <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#C1554A" }}>-{fmtCompact(m.cashOut)}</span>
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: m.net >= 0 ? "#4FA37B" : "#C1554A", marginTop: 2 }}>
                สุทธิ {m.net >= 0 ? "+" : ""}{fmtCompact(m.net)}
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "10px", color: "#8A93A0", marginTop: 1 }}>
                สะสม {m.cumulative >= 0 ? "+" : ""}{fmtCompact(m.cumulative)}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Cash Flow Sankey */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>เงินเข้า → เงินออก · Cash Flow</div>
          <span style={{ fontSize: "10.5px", color: "#8A93A0" }}>บาท/เดือน</span>
        </div>
        <CashFlowSankey cfBreakdownIn={cfBreakdownIn} cfBreakdownOut={cfBreakdownOut} cfCashIn={cfCashIn} cfCashOut={cfCashOut} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CashOutDonutCard
          cfCashOut={cfCashOut}
          cfBreakdownOut={cfBreakdownOut}
          categoryExpenseType={categoryExpenseType}
          updateSettings={updateSettings}
        />
        <DonutLegendCard
          title="รายรับจากไหนบ้าง · Income"
          hint="บาท + %"
          centerValue={fmtCompact(cfCashIn)}
          centerLabel="รวมรายรับ"
          items={CASHIN_CATEGORIES.filter((c) => cfBreakdownIn[c.key]).map((c, i) => ({
            label: c.key,
            value: cfBreakdownIn[c.key],
            color: PIE_COLORS_CF[i % PIE_COLORS_CF.length],
            emoji: c.emoji,
          }))}
        />
      </div>

      {/* Timeline */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>Monthly Timeline</div>
          <button
            onClick={() => setModal({ type: "transaction" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มรายการ
          </button>
        </div>
        {cfTimeline.length ? (
          <div className="flex flex-col gap-2">
            {cfTimeline.map((t) => {
              const isIn = t.type === "รายรับ";
              const list = isIn ? CASHIN_CATEGORIES : CASHOUT_CATEGORIES;
              const emoji = flowCategoryEmoji(list, t.flowCategory);
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg"
                  style={{ background: "#101820", border: `1px solid ${t.isVirtual ? "#5B84B144" : "#1E2A38"}` }}
                >
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "11.5px", color: "#8A93A0", minWidth: 42 }}>
                    {t.isVirtual ? "ตามกำหนด" : `${new Date(t.date).getDate()} ${MONTH_TH[MONTH_ORDER[new Date(t.date).getMonth()]]}`}
                  </span>
                  <span>{emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span style={{ fontSize: "13px" }}>{t.category}</span>
                      {t.isVirtual && (
                        <span
                          className="px-1.5 py-0.5 rounded-full"
                          style={{ background: "#5B84B122", color: "#5B84B1", fontSize: "9px" }}
                          title="ดึงมาจากแหล่งข้อมูลอัตโนมัติ ไม่ต้องบันทึกซ้ำ"
                        >
                          {t.source === "debt" && "🔥 จากแท็บหนี้สิน"}
                          {t.source === "insurance" && "🛡️ จากแท็บประกัน"}
                          {t.source === "dca" && "📈 จากพอร์ตลงทุน (DCA)"}
                          {t.source === "custombill" && "📅 จากปฏิทินจ่ายเงินรายเดือน"}
                        </span>
                      )}
                      {t.frequency && t.frequency !== "once" && (
                        <span
                          className="px-1.5 py-0.5 rounded-full"
                          style={{ background: "#5B84B122", color: "#5B84B1", fontSize: "9px" }}
                          title="รายการนี้สร้างล่วงหน้าจากรายการประจำ"
                        >
                          🔁 {t.frequency === "monthly" ? "ทุกเดือน" : t.frequency === "quarterly" ? "ทุก 3 เดือน" : "ทุกปี"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>{t.flowCategory || "-"}</div>
                  </div>
                  {t.isVirtual ? (
                    <button
                      onClick={() => toggleBillPaid(t.billKey, cfMonthAbbrev)}
                      className="px-1.5 py-0.5 rounded-full"
                      style={{
                        background: t.paid ? "#4FA37B22" : "#8A93A022",
                        color: t.paid ? "#4FA37B" : "#8A93A0",
                        fontSize: "9.5px",
                        cursor: t.paid === null ? "default" : "pointer",
                      }}
                      disabled={t.paid === null}
                      title="แตะเพื่อติ๊กว่าจ่ายแล้ว (จะอัปเดตในแท็บปฏิทินจ่ายเงินรายเดือนด้วย)"
                    >
                      {t.paid === null ? "ตามกำหนด" : t.paid ? "จ่ายแล้ว" : "รอชำระ"}
                    </button>
                  ) : (
                    <span
                      className="px-1.5 py-0.5 rounded-full"
                      style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "9.5px" }}
                    >
                      {isIn ? "Received" : "Paid"}
                    </span>
                  )}
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "13.5px", color: isIn ? "#4FA37B" : "#C1554A", minWidth: 90, textAlign: "right" }}>
                    {isIn ? "+" : "-"}{fmtTHB(t.amount)}
                  </span>
                  {t.isVirtual ? (
                    <span style={{ width: 13 }} />
                  ) : (
                    <button onClick={() => removeItem("transactions", t.id)} style={{ color: "#8A93A0" }}><Trash2 size={13} /></button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีธุรกรรมเดือนนี้ — เริ่มเพิ่มรายการแรก" />
        )}

        {cfYearMatchesThisYear && cfUnpaidBillsRemaining > 0 && (
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "11.5px", color: "#8A93A0", marginBottom: 6 }}>รายการที่ยังไม่ชำระเดือนนี้ (จากปฏิทินจ่ายเงินรายเดือน)</div>
            <div className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: "#101820", border: "1px dashed #2A3949" }}>
              <span style={{ fontSize: "13px", color: "#8A93A0" }}>⏳ รวมรายการที่ยังไม่ติ๊กว่าจ่ายแล้ว</span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "13.5px", color: "#C9A227" }}>-{fmtTHB(cfUnpaidBillsRemaining)}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Minimum Cash Buffer check */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>เช็คเงินสดขั้นต่ำ (Minimum Cash Buffer)</div>
          {isCurrentMonth && (
            <span style={{ fontSize: "10.5px", color: "#8A93A0" }}>
              วันนี้ {new Date().getDate()} {MONTH_TH[MONTH_ORDER[new Date().getMonth()]]}
            </span>
          )}
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 16 }}>
          เทียบ "คาดการณ์สิ้นเดือน" ({fmtTHB(cfForecastClosing)} จากภาพรวมด้านบน) กับเงินสดขั้นต่ำที่ตั้งไว้ — กันเงินสดขาดมือ
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
          <div className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: belowBuffer ? "#C1554A" : "#4FA37B" }} />
            <span style={{ fontSize: "12.5px" }}>
              {belowBuffer ? "ต่ำกว่า Minimum Cash Buffer" : "สูงกว่า Minimum Cash Buffer"}
            </span>
          </div>
          <div className="flex items-center gap-1.5" style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px", color: "#8A93A0" }}>
            Buffer: <EditableNumber value={minCashBuffer} onSave={(v) => updateSettings("cashflowSettings", { minCashBuffer: v })} /> บาท
          </div>
        </div>
        <div style={{ fontSize: "10px", color: "#8A93A0", marginTop: 8 }}>
          * คาดการณ์สิ้นเดือนอิงจากรายการค้างจ่ายในปฏิทินจ่ายเงินรายเดือนเท่านั้น ไม่รวมรายรับที่ยังไม่เกิดขึ้น
        </div>
      </Card>
    </div>
  );
}

/* ================= MONTHLY BILLS (Monthly Cashflow) TAB ================= */

const CATEGORY_COLORS = {
  ประกัน: "#5B84B1",
  ผ่อนหนี้: "#C1554A",
  สาธารณูปโภค: "#C9A227",
  การศึกษา: "#8A6FBF",
  "DCA ลงทุน": "#4FA37B",
  อื่นๆ: "#4FA37B",
  ชำระหนี้: "#C1554A",
  ลงทุน: "#4FA37B",
  ภาษี: "#8A6FBF",
  ค่าใช้จ่ายประจำวัน: "#C9A227",
  ที่อยู่อาศัย: "#C9A227",
  อาหาร: "#4FA37B",
  การเดินทาง: "#5B84B1",
  "สุขภาพ/การแพทย์": "#C1554A",
  "ช้อปปิ้ง/เสื้อผ้า": "#8A6FBF",
  "บันเทิง/พักผ่อน": "#8A6FBF",
  ท่องเที่ยว: "#5B84B1",
  ดูแลส่วนตัว: "#8A6FBF",
  "สมาชิก/Subscription": "#5B84B1",
  สนับสนุนครอบครัว: "#C9A227",
  "บริจาค/การกุศล": "#4FA37B",
  ค่าธรรมเนียมวิชาชีพ: "#8A6FBF",
  ค่าใช้จ่ายธุรกิจ: "#5B84B1",
};

function MonthlyBillsTab({ monthlyBillsByMonth, monthlyBillsSummary, billStatus, billStatusKey, toggleBillPaid, customBills, setModal, removeItem, updateItem }) {
  const currentMonthAbbr = MONTH_ORDER[new Date().getMonth()];
  const [activeMonth, setActiveMonth] = useState(currentMonthAbbr);

  const items = monthlyBillsByMonth[activeMonth] || [];
  const summary = monthlyBillsSummary.find((m) => m.month === activeMonth);
  const yearTotal = monthlyBillsSummary.reduce((s, m) => s + m.total, 0);
  const yearPaid = monthlyBillsSummary.reduce((s, m) => s + m.paidTotal, 0);

  return (
    <div className="flex flex-col gap-6">
      <CompactStatRow
        items={[
          { label: "ภาระต่อปีทั้งหมด", value: fmtCompact(yearTotal), icon: CalendarDays, accent: "#C9A227" },
          { label: "จ่ายไปแล้วปีนี้", value: fmtCompact(yearPaid), icon: CheckCircle2, accent: "#4FA37B" },
          { label: `เดือน ${MONTH_TH[activeMonth]}`, value: summary ? `${summary.paidCount}/${summary.itemCount} รายการ` : "0/0", icon: Shield, accent: "#5B84B1" },
        ]}
      />

      {/* year mini bar strip */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontFamily: "Fraunces", fontSize: "1rem" }}>ภาพรวมทั้งปี</div>
          <span style={{ fontSize: "11px", color: "#8A93A0" }}>แตะเดือนเพื่อดูรายละเอียด</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
          {monthlyBillsSummary.map((m) => {
            const isActive = m.month === activeMonth;
            const isCurrent = m.month === currentMonthAbbr;
            const complete = m.itemCount > 0 && m.paidCount === m.itemCount;
            return (
              <button
                key={m.month}
                onClick={() => setActiveMonth(m.month)}
                className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition-all"
                style={{
                  background: isActive ? "#1E2A38" : "transparent",
                  border: isActive ? "1px solid #C9A227" : isCurrent ? "1px solid #2A3949" : "1px solid transparent",
                }}
              >
                <span style={{ fontSize: "11px", color: isActive ? "#EAE7E0" : "#8A93A0", fontWeight: isCurrent ? 700 : 400 }}>{MONTH_TH[m.month]}</span>
                <div style={{ width: 26, height: 26, borderRadius: "50%", position: "relative" }}>
                  <svg width="26" height="26" viewBox="0 0 26 26">
                    <circle cx="13" cy="13" r="10" fill="none" stroke="#101820" strokeWidth="3" />
                    <circle
                      cx="13" cy="13" r="10" fill="none"
                      stroke={complete ? "#4FA37B" : m.pct > 0 ? "#C9A227" : "#2A3949"}
                      strokeWidth="3"
                      strokeDasharray={`${(m.pct / 100) * 62.8} 62.8`}
                      strokeLinecap="round"
                      transform="rotate(-90 13 13)"
                    />
                  </svg>
                </div>
                <span style={{ fontSize: "9.5px", fontFamily: "JetBrains Mono", color: "#8A93A0" }}>{m.itemCount ? fmtCompact(m.total) : "-"}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* selected month detail */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.2rem" }}>รายการเดือน{MONTH_TH[activeMonth]}</div>
          <button
            onClick={() => setModal({ type: "bill" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มรายการประจำ
          </button>
        </div>
        {summary && summary.itemCount > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  background: summary.pct >= 100 ? "#4FA37B22" : "#C9A22722",
                  color: summary.pct >= 100 ? "#4FA37B" : "#C9A227",
                }}
              >
                {summary.pct >= 100 ? "Completed" : "Pending"}
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px", color: "#8A93A0" }}>
                {fmtTHB(summary.paidTotal)} / {fmtTHB(summary.total)} ({summary.pct.toFixed(0)}%)
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "#101820", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${summary.pct}%`, background: summary.pct >= 100 ? "#4FA37B" : "#C9A227", borderRadius: 4, transition: "width 0.3s ease" }} />
            </div>
          </div>
        )}

        {items.length ? (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const paid = !!billStatus[billStatusKey(item.key, activeMonth)];
              return (
                <div
                  key={item.key}
                  onClick={() => toggleBillPaid(item.key, activeMonth)}
                  className="flex items-center gap-3 p-3 rounded-xl cursor-pointer select-none"
                  style={{ background: "#101820", border: `1px solid ${paid ? "#4FA37B44" : "#1E2A38"}` }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
                    style={{ background: paid ? "#4FA37B" : "transparent", border: paid ? "none" : "2px solid #2A3949" }}
                  >
                    {paid && <CheckCircle2 size={16} color="#101820" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: "13.5px", color: paid ? "#8A93A0" : "#EAE7E0", textDecoration: paid ? "line-through" : "none" }}>
                      {item.name}
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full inline-block mt-0.5"
                      style={{ background: `${CATEGORY_COLORS[item.category] || "#8A93A0"}22`, color: CATEGORY_COLORS[item.category] || "#8A93A0", fontSize: "10.5px" }}
                    >
                      {item.category}
                    </span>
                    {item.recorded && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full inline-block mt-0.5 ml-1"
                        style={{ background: "#5B84B122", color: "#5B84B1", fontSize: "10.5px" }}
                        title="ดึงมาจากรายการประจำที่บันทึกไว้ในแท็บกระแสเงินสด"
                      >
                        📊 จากกระแสเงินสด
                      </span>
                    )}
                    {item.source === "custom" && (
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs px-1.5 py-0.5 rounded-full inline-block mt-0.5 ml-1"
                        style={{ background: "#5B84B122", color: "#5B84B1", fontSize: "10.5px" }}
                      >
                        วันที่{" "}
                        <EditableNumber
                          value={item.dueDay || ""}
                          onSave={(v) => updateItem("customBills", item.key.replace("bill-", ""), { dueDay: v })}
                        />
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono", fontSize: "14px", color: paid ? "#8A93A0" : "#EAE7E0" }}>
                    {fmtTHB(item.amount)}
                  </div>
                  {item.source === "custom" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem("customBills", item.key.replace("bill-", ""));
                      }}
                      style={{ color: "#8A93A0" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="เดือนนี้ไม่มีรายการที่ต้องจ่าย" />
        )}
      </Card>
    </div>
  );
}

/* ================= INSURANCE TAB ================= */

const NOTE_ICONS = { claim: AlertTriangle, home: Shield, clinic: ShieldCheck, coop: Wallet, estimate: Info };

function EditableText({ value, onSave, style, listId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== value) onSave(draft.trim());
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="outline-none"
        style={{
          background: "#101820",
          border: "1px solid #C9A227",
          borderRadius: 4,
          color: "#EAE7E0",
          padding: "2px 6px",
          ...style,
        }}
      />
    );
  }
  return (
    <span onClick={() => setEditing(true)} className="cursor-pointer" style={{ borderBottom: "1px dashed #2A394988", ...style }} title="แตะเพื่อแก้ไข">
      {value}
    </span>
  );
}

function EditableNumber({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onSave(Number(draft || 0));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="outline-none text-right"
        style={{
          width: 90,
          background: "#101820",
          border: "1px solid #C9A227",
          borderRadius: 4,
          color: "#EAE7E0",
          fontFamily: "JetBrains Mono",
          fontSize: "12.5px",
          padding: "2px 6px",
        }}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer px-1 rounded"
      style={{ borderBottom: "1px dashed #2A3949" }}
      title="แตะเพื่อแก้ไข"
    >
      {Number(value).toLocaleString()}
    </span>
  );
}

function InsuranceTab({ policies, coverageTargets, notes, totalPremium, activePolicyCount, policiesByOwner, premiumCalendar, setModal, removeItem, updateItem, liabilities, familyMembers, cashTotal, investmentNetWorth, annualSummary, insuranceNeedsYearsOverride, setField }) {
  const totalLifeCoverage = coverageTargets.find((c) => c.label.includes("ชีวิต"))?.current || 0;
  const maxCalendar = Math.max(...premiumCalendar.map((m) => m.total), 1);
  const currentMonthAbbr = new Date().toLocaleDateString("en-US", { month: "short" });

  // ---- Insurance adequacy (needs-based) analysis ----
  const uncoveredDebt = liabilities
    .filter((l) => l.status !== "Closed" && l.status !== "Paid" && l.mrtaInsurance !== "มี")
    .reduce((s, l) => s + Number(l.currentBalance || 0), 0);
  const youngestChildAge = familyMembers
    .filter((m) => m.relationship === "ลูก")
    .map((m) => calcAgeFromBirthDate(m.birthDate, m.birthDateCalendar, m.birthYear))
    .filter((a) => a !== null)
    .reduce((min, a) => (min === null || a < min ? a : min), null);
  const autoYears = youngestChildAge !== null ? Math.max(22 - youngestChildAge, 0) : 15;
  const yearsNeeded = insuranceNeedsYearsOverride ?? autoYears;
  const annualFamilyExpense = annualSummary.totalFixedExpenses + annualSummary.totalVariableExpenses;
  const incomeReplacementNeed = annualFamilyExpense * yearsNeeded;
  const liquidAssets = cashTotal + investmentNetWorth;
  const existingLifeCoverage = policies
    .filter((p) => p.status === "Active" && !p.type.includes("สุขภาพ") && !p.type.includes("โรคร้าย"))
    .reduce((s, p) => s + Number(p.sumAssured || 0), 0);
  const totalNeed = uncoveredDebt + incomeReplacementNeed - liquidAssets;
  const gap = totalNeed - existingLifeCoverage;

  return (
    <div className="flex flex-col gap-8">
      <CompactStatRow
        items={[
          { label: "เบี้ยประกันรวมต่อปี", value: fmtCompact(totalPremium), icon: Wallet, accent: "#C9A227" },
          { label: "ทุนประกันชีวิตรวม", value: fmtCompact(totalLifeCoverage), icon: Shield, accent: "#5B84B1" },
          { label: "กรมธรรม์ที่ Active", value: `${activePolicyCount} ฉบับ`, icon: ShieldCheck, accent: "#4FA37B" },
        ]}
      />

      {/* insurance adequacy — needs-based analysis */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>เกณฑ์ความเพียงพอของทุนประกันชีวิต (Needs-Based Analysis)</div>
          <span
            className="px-2 py-0.5 rounded-full"
            style={{ background: gap > 0 ? "#C1554A22" : "#4FA37B22", color: gap > 0 ? "#C1554A" : "#4FA37B", fontSize: "10.5px", fontWeight: 600 }}
          >
            {gap > 0 ? `ขาดอยู่ ${fmtCompact(gap)}` : `เกินความจำเป็น ${fmtCompact(Math.abs(gap))}`}
          </span>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 16 }}>
          คำนวณจากข้อมูลจริงในแอป: หนี้สินไม่มี MRTA + ค่าใช้จ่ายครอบครัว × จำนวนปีที่ต้องคุ้มครอง − สินทรัพย์สภาพคล่อง เทียบกับทุนประกันชีวิตที่มีอยู่แล้ว
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>หนี้สินไม่มี MRTA</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#C1554A", marginTop: 3 }}>{fmtCompact(uncoveredDebt)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>ค่าใช้จ่ายครอบครัว/ปี</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", marginTop: 3 }}>{fmtCompact(annualFamilyExpense)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>จำนวนปีที่ต้องคุ้มครอง</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", marginTop: 3 }}>
              <EditableNumber value={yearsNeeded} onSave={(v) => setField("insuranceNeedsYearsOverride", Number(v))} /> ปี
            </div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>
              {insuranceNeedsYearsOverride === null ? `ประมาณอัตโนมัติจากลูกคนเล็ก (ถึงอายุ 22)` : "ตั้งเองแล้ว — แตะเพื่อแก้"}
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>สินทรัพย์สภาพคล่อง</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#4FA37B", marginTop: 3 }}>{fmtCompact(liquidAssets)}</div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>เงินสด + พอร์ตลงทุน</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>ทุนประกันชีวิตที่ควรมี</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", marginTop: 3 }}>{fmtCompact(Math.max(totalNeed, 0))}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>ทุนประกันชีวิตที่มีอยู่แล้ว</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.05rem", color: "#5B84B1", marginTop: 3 }}>{fmtCompact(existingLifeCoverage)}</div>
          </div>
        </div>
        <div style={{ fontSize: "10px", color: "#8A93A0" }}>
          * สูตรประมาณการทั่วไป (Needs-Based / คล้าย DIME method) ไม่ใช่คำแนะนำทางการเงินที่ปรึกษาผู้เชี่ยวชาญให้ ควรใช้เป็นจุดเริ่มต้นคุยกับตัวแทนประกัน/นักวางแผนการเงินอีกที · นับเฉพาะกรมธรรม์ Active ที่ไม่ใช่ประกันสุขภาพ/โรคร้ายแรงเป็นทุนที่มีอยู่แล้ว
        </div>
      </Card>

      {/* coverage vs target */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>ความคุ้มครองเทียบเป้าหมาย</div>
          <button
            onClick={() => setModal({ type: "coverageTarget" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0" }}
          >
            <Plus size={13} /> เพิ่มเป้าหมาย
          </button>
        </div>
        <div style={{ fontSize: "11.5px", color: "#8A93A0", marginBottom: 18 }}>แตะตัวเลขปัจจุบันหรือเป้าหมายเพื่อแก้ไขได้โดยตรง</div>
        <div className="flex flex-col gap-5">
          {coverageTargets.map((c) => {
            const pct = c.target ? Math.min((c.current / c.target) * 100, 100) : 0;
            return (
              <div key={c.id}>
                <div className="flex items-center justify-between mb-1.5 gap-3 flex-wrap">
                  <span style={{ fontSize: "13px", color: "#EAE7E0" }}>{c.label}</span>
                  <div className="flex items-center gap-1.5" style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px", color: "#8A93A0" }}>
                    <EditableNumber value={c.current} onSave={(v) => updateItem("coverageTargets", c.id, { current: v })} />
                    <span>/</span>
                    <EditableNumber value={c.target} onSave={(v) => updateItem("coverageTargets", c.id, { target: v })} />
                    <span>{c.unit}</span>
                    <span style={{ color: pct >= 100 ? "#4FA37B" : "#C9A227", marginLeft: 4 }}>{pct.toFixed(0)}%</span>
                    <button onClick={() => removeItem("coverageTargets", c.id)} style={{ color: "#8A93A0", marginLeft: 4 }}><Trash2 size={12} /></button>
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "#101820", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      borderRadius: 4,
                      background: pct >= 100 ? "#4FA37B" : "#C9A227",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* premium calendar */}
      <Card className="p-6">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem", marginBottom: 16 }}>ปฏิทินชำระเบี้ยประกันรายเดือน</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={premiumCalendar}>
            <CartesianGrid stroke="#1E2A38" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={{ stroke: "#2A3949" }} tickLine={false} />
            <YAxis tickFormatter={fmtCompact} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
            <Tooltip
              contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
              labelStyle={{ color: "#EAE7E0" }}
              itemStyle={{ color: "#EAE7E0" }}
              formatter={(v) => fmtTHB(v)}
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {premiumCalendar.map((m, i) => (
                <Cell key={i} fill={m.month === currentMonthAbbr ? "#C9A227" : "#2A3949"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {premiumCalendar.filter((m) => m.total > 0).map((m) => (
            <div key={m.month} className="p-2.5 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
              <div style={{ fontSize: "11px", color: "#8A93A0" }}>{m.month}</div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }}>{fmtCompact(m.total)}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* policy list by owner */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} color="#8A93A0" />
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>รายการกรมธรรม์แยกตามสมาชิก</div>
          </div>
          <button
            onClick={() => setModal({ type: "policy" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มกรมธรรม์
          </button>
        </div>

        {Object.keys(policiesByOwner).length ? (
          Object.entries(policiesByOwner).map(([owner, list]) => (
            <div key={owner} className="mb-6 last:mb-0">
              <div style={{ fontSize: "12px", color: "#C9A227", fontWeight: 600, marginBottom: 8, letterSpacing: "0.03em" }}>
                ●{" "}
                <EditableText
                  value={owner}
                  style={{ fontSize: "12px", fontWeight: 600, color: "#C9A227" }}
                  onSave={(newOwner) => {
                    list.forEach((p) => updateItem("insurancePolicies", p.id, { owner: newOwner }));
                  }}
                />
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>บริษัท</th><th>ชื่อกรมธรรม์</th><th>ประเภท</th>
                      <th>วันเริ่มต้น</th><th>วันครบกำหนด</th>
                      <th style={{ textAlign: "right" }}>ทุนประกัน</th>
                      <th style={{ textAlign: "right" }}>มูลค่าเวนคืน</th>
                      <th style={{ textAlign: "right" }}>เบี้ย/ปี</th>
                      <th>ชำระเดือน</th><th>สถานะ</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id}>
                        <td style={{ color: "#8A93A0" }}>{p.company}</td>
                        <td><EditableText value={p.policyName} onSave={(v) => updateItem("insurancePolicies", p.id, { policyName: v })} style={{ fontSize: "13px" }} /></td>
                        <td style={{ color: "#8A93A0", fontSize: "12.5px" }}>{p.type}</td>
                        <td style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#8A93A0" }}>{p.startDate || "-"}</td>
                        <td style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#8A93A0" }}>{p.maturityDate || "-"}</td>
                        <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                          {p.sumAssured ? Number(p.sumAssured).toLocaleString() : "-"}
                        </td>
                        <td style={{ fontFamily: "JetBrains Mono", textAlign: "right", color: "#4FA37B" }}>
                          <EditableNumber value={p.cashSurrenderValue || 0} onSave={(v) => updateItem("insurancePolicies", p.id, { cashSurrenderValue: v })} />
                        </td>
                        <td style={{ fontFamily: "JetBrains Mono", textAlign: "right" }}>
                          {p.premium ? Number(p.premium).toLocaleString() : "-"}
                        </td>
                        <td style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }}>{p.paymentMonth}</td>
                        <td>
                          <span
                            className="px-2 py-0.5 rounded-full text-xs"
                            style={{
                              background: p.status === "Active" ? "#4FA37B22" : "#8A93A022",
                              color: p.status === "Active" ? "#4FA37B" : "#8A93A0",
                            }}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td>
                          <button onClick={() => removeItem("insurancePolicies", p.id)} style={{ color: "#8A93A0" }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <EmptyState text="ยังไม่มีกรมธรรม์ — เพิ่มด้วยตนเองหรือนำเข้าจาก CSV ด้านล่าง" />
        )}
      </Card>

      {/* notes */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>ข้อควรรู้ & ความคุ้มครองเพิ่มเติม</div>
          <button
            onClick={() => setModal({ type: "note" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0" }}
          >
            <Plus size={13} /> เพิ่มข้อควรรู้
          </button>
        </div>
        {notes.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {notes.map((n) => {
              const Icon = NOTE_ICONS[n.icon] || Info;
              return (
                <div key={n.id} className="flex gap-3 p-3.5 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "#C9A22722" }}>
                    <Icon size={14} color="#C9A227" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <EditableText
                      value={n.title}
                      style={{ fontSize: "13px", fontWeight: 600, color: "#EAE7E0", display: "inline-block" }}
                      onSave={(v) => updateItem("insuranceNotes", n.id, { title: v })}
                    />
                    <div style={{ marginTop: 2 }}>
                      <EditableText
                        value={n.detail}
                        style={{ fontSize: "12.5px", color: "#8A93A0", width: "100%", display: "inline-block" }}
                        onSave={(v) => updateItem("insuranceNotes", n.id, { detail: v })}
                      />
                    </div>
                  </div>
                  <button onClick={() => removeItem("insuranceNotes", n.id)} style={{ color: "#8A93A0" }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีข้อควรรู้ — เพิ่มด้วยปุ่มด้านบน" />
        )}
      </Card>
    </div>
  );
}

/* ================= FAMILY MEMBERS TAB ================= */

/* ================= ESTATE PLANNING TAB ================= */

const WILL_TYPES = ["เขียนเองทั้งฉบับ", "เอกสารฝ่ายเมือง", "เอกสารลับ", "ทำด้วยวาจา", "อื่นๆ"];
const YES_NO_OPTIONS = ["", "มี", "ไม่มี"];

function EstateChecklistDot({ done }) {
  return (
    <span
      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
      style={{ background: done ? "#4FA37B" : "#101820", border: done ? "none" : "2px solid #2A3949" }}
    >
      {done && <CheckCircle2 size={13} color="#101820" strokeWidth={3} />}
    </span>
  );
}

function EstateTab({ data, netWorth, cashTotal, businessEquityValue, realEstateValue, familyMembers, setModal, removeItem, updateItem, updateSettings, setField }) {
  const will = data.estateWill || {};
  const illiquidTotal = businessEquityValue + realEstateValue;
  const liquidTotal = netWorth - illiquidTotal;
  const uncoveredDebt = data.liabilities
    .filter((l) => l.status !== "Closed" && l.status !== "Paid" && l.mrtaInsurance !== "มี")
    .reduce((s, l) => s + Number(l.currentBalance || 0), 0);

  const checklist = [
    { key: "will", label: "ทำพินัยกรรมแล้ว", done: will.exists === "มี" },
    { key: "executor", label: "ระบุผู้จัดการมรดกแล้ว", done: !!will.executorName },
    { key: "heirs", label: "ระบุทายาท/การกระจายมรดกอย่างน้อย 1 รายการ", done: (data.estateHeirs || []).length > 0 },
    { key: "beneficiary", label: "ตรวจสอบผู้รับผลประโยชน์ประกันแล้วทุกฉบับ", done: data.insurancePolicies.length > 0 && data.insurancePolicies.every((p) => data.estateBeneficiaryReview?.[p.id] === "confirmed") },
    { key: "succession", label: "มีแผนสืบทอดธุรกิจอย่างน้อย 1 ธุรกิจ", done: (data.estateBusinessSuccession || []).length > 0 },
  ];
  const completePct = (checklist.filter((c) => c.done).length / checklist.length) * 100;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Estate Overview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.2rem" }}>Estate Overview · ภาพรวมกองมรดก</div>
          <div className="flex items-center gap-2">
            <div style={{ width: 90, height: 6, borderRadius: 3, background: "#101820", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${completePct}%`, background: completePct >= 100 ? "#4FA37B" : "#C9A227", borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: "11px", color: "#8A93A0" }}>{completePct.toFixed(0)}% ครบถ้วน</span>
          </div>
        </div>
        <div style={{ fontSize: "11.5px", color: "#8A93A0", marginBottom: 16 }}>ดึงจาก Net Worth, พอร์ตลงทุน และหนี้สินที่มีอยู่แล้วโดยอัตโนมัติ</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Net Worth รวม</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", marginTop: 3 }}>{fmtCompact(netWorth)}</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>สินทรัพย์สภาพคล่อง</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#4FA37B", marginTop: 3 }}>{fmtCompact(liquidTotal)}</div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>เงินสด/พอร์ต ไม่รวมธุรกิจ+อสังหาฯ</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>สินทรัพย์สภาพไม่คล่อง</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: "#5B84B1", marginTop: 3 }}>{fmtCompact(illiquidTotal)}</div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>ธุรกิจส่วนตัว + อสังหาริมทรัพย์</div>
          </div>
          <div className="p-3 rounded-xl" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
            <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>หนี้ที่ไม่มี MRTA คุ้มครอง</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "1.15rem", color: uncoveredDebt > 0 ? "#C1554A" : "#4FA37B", marginTop: 3 }}>{fmtCompact(uncoveredDebt)}</div>
            <div style={{ fontSize: "9.5px", color: "#8A93A0", marginTop: 2 }}>ภาระที่ตกทอดถึงทายาทถ้าเสียชีวิต</div>
          </div>
        </div>
      </Card>

      {/* 2. Will & legal documents */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={16} color="#C9A227" />
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>พินัยกรรมและเอกสารทางกฎหมาย</div>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 16 }}>แตะช่องเพื่อแก้ไข ทุกช่องไม่บังคับ กรอกเท่าที่มี</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0" }}>
            มีพินัยกรรมหรือยัง
            <select
              value={will.exists || ""}
              onChange={(e) => updateSettings("estateWill", { exists: e.target.value })}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              <option value="">— เลือก —</option>
              <option value="มี">มีแล้ว</option>
              <option value="กำลังทำ">กำลังทำ</option>
              <option value="ไม่มี">ยังไม่มี</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0" }}>
            รูปแบบพินัยกรรม
            <select
              value={will.type || ""}
              onChange={(e) => updateSettings("estateWill", { type: e.target.value })}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              <option value="">— เลือก —</option>
              {WILL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 5 }}>สถานที่เก็บเอกสาร</div>
            <EditableText value={will.location || "ระบุสถานที่..."} onSave={(v) => updateSettings("estateWill", { location: v })} style={{ fontSize: "13px" }} />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 5 }}>วันที่ทำพินัยกรรม</div>
            <EditableText value={will.dateCreated || "-"} onSave={(v) => updateSettings("estateWill", { dateCreated: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }} />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 5 }}>ทบทวนล่าสุด</div>
            <EditableText value={will.lastReviewed || "-"} onSave={(v) => updateSettings("estateWill", { lastReviewed: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }} />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 5 }}>ผู้จัดการมรดก (Executor)</div>
            <EditableText value={will.executorName || "ระบุชื่อ..."} onSave={(v) => updateSettings("estateWill", { executorName: v })} style={{ fontSize: "13px" }} />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 5 }}>เบอร์ติดต่อผู้จัดการมรดก</div>
            <EditableText value={will.executorContact || "-"} onSave={(v) => updateSettings("estateWill", { executorContact: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }} />
          </div>
          <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0" }}>
            หนังสือมอบอำนาจการเงิน (POA)
            <select
              value={will.poaFinancial || ""}
              onChange={(e) => updateSettings("estateWill", { poaFinancial: e.target.value })}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              {YES_NO_OPTIONS.map((o) => (
                <option key={o} value={o}>{o || "— เลือก —"}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0" }}>
            หนังสือมอบอำนาจสุขภาพ
            <select
              value={will.poaHealthcare || ""}
              onChange={(e) => updateSettings("estateWill", { poaHealthcare: e.target.value })}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              {YES_NO_OPTIONS.map((o) => (
                <option key={o} value={o}>{o || "— เลือก —"}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0" }}>
            Living Will (หนังสือปฏิเสธการรักษา)
            <select
              value={will.livingWill || ""}
              onChange={(e) => updateSettings("estateWill", { livingWill: e.target.value })}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0" }}
            >
              {YES_NO_OPTIONS.map((o) => (
                <option key={o} value={o}>{o || "— เลือก —"}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1E2A38" }}>
          <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 4 }}>บันทึกเพิ่มเติม</div>
          <EditableText value={will.notes || "เพิ่มบันทึก..."} onSave={(v) => updateSettings("estateWill", { notes: v })} style={{ fontSize: "12.5px", color: "#8A93A0", fontStyle: "italic" }} />
        </div>
      </Card>

      {/* 3. Heirs & distribution */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <HeartHandshake size={16} color="#C9A227" />
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>ทายาทและการกระจายมรดก</div>
          </div>
          <button
            onClick={() => setModal({ type: "estateHeir" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มรายการ
          </button>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 14 }}>
          ระบุทรัพย์สินเฉพาะเจาะจงต่อทายาทแต่ละคน · ทายาทโดยธรรมตามกฎหมายไทยมี 6 ลำดับ (ผู้สืบสันดาน, บิดามารดา, พี่น้องร่วมบิดามารดา, พี่น้องร่วมบิดา/มารดาเดียวกัน, ปู่ย่าตายาย, ลุงป้าน้าอา) — ใช้เทียบกับแผนที่ระบุด้านล่างได้
        </div>
        {(data.estateHeirs || []).length ? (
          <div className="flex flex-col gap-2">
            {data.estateHeirs.map((h) => (
              <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg flex-wrap" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
                <select
                  value={h.memberId || ""}
                  onChange={(e) => updateItem("estateHeirs", h.id, { memberId: e.target.value })}
                  className="text-sm outline-none px-2 py-1 rounded"
                  style={{ background: "transparent", color: "#EAE7E0", border: "1px solid #2A3949" }}
                >
                  <option value="">— เลือกทายาท —</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.nickname || m.fullNameTh || "ไม่ระบุชื่อ"}</option>
                  ))}
                </select>
                <ChevronRight size={14} color="#8A93A0" />
                <div className="flex-1 min-w-[120px]">
                  <EditableText value={h.assetDescription || "ระบุทรัพย์สิน..."} onSave={(v) => updateItem("estateHeirs", h.id, { assetDescription: v })} style={{ fontSize: "13px" }} />
                </div>
                <div className="flex-1 min-w-[120px]" style={{ fontSize: "11.5px", color: "#8A93A0" }}>
                  <EditableText value={h.notes || "บันทึกเพิ่มเติม..."} onSave={(v) => updateItem("estateHeirs", h.id, { notes: v })} style={{ fontSize: "11.5px", color: "#8A93A0" }} />
                </div>
                <button onClick={() => removeItem("estateHeirs", h.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีรายการ — เพิ่มด้วยปุ่มด้านบน" />
        )}
      </Card>

      {/* 4. Beneficiary cross-check */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Scale size={16} color="#C9A227" />
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>Beneficiary Cross-Check</div>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 14 }}>ผู้รับผลประโยชน์จากแท็บประกัน — ตรวจสอบว่ายังตรงกับเจตนารมณ์ปัจจุบันไหม</div>
        {data.insurancePolicies.length ? (
          <div className="flex flex-col gap-2">
            {data.insurancePolicies.map((p) => {
              const status = data.estateBeneficiaryReview?.[p.id] || "";
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg flex-wrap" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
                  <div>
                    <div style={{ fontSize: "13px" }}>{p.policyName}</div>
                    <div style={{ fontSize: "11.5px", color: "#8A93A0" }}>ผู้รับผลประโยชน์: {p.beneficiary || "-"}</div>
                  </div>
                  <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid #2A3949" }}>
                    <button
                      onClick={() => updateSettings("estateBeneficiaryReview", { [p.id]: "confirmed" })}
                      className="px-2 py-1"
                      style={{ background: status === "confirmed" ? "#4FA37B" : "transparent", color: status === "confirmed" ? "#101820" : "#8A93A0", fontSize: "10.5px", fontWeight: 600 }}
                    >
                      ตรงแล้ว
                    </button>
                    <button
                      onClick={() => updateSettings("estateBeneficiaryReview", { [p.id]: "needsUpdate" })}
                      className="px-2 py-1"
                      style={{ background: status === "needsUpdate" ? "#C1554A" : "transparent", color: status === "needsUpdate" ? "#101820" : "#8A93A0", fontSize: "10.5px", fontWeight: 600 }}
                    >
                      ควรทบทวน
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีกรมธรรม์ในแท็บประกัน" />
        )}
      </Card>

      {/* 5. Business succession */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Building2 size={16} color="#C9A227" />
            <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>Business Succession · แผนสืบทอดธุรกิจ</div>
          </div>
          <button
            onClick={() => setModal({ type: "estateSuccession" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มธุรกิจ
          </button>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 14 }}>ดึงชื่อธุรกิจจากแท็บพอร์ตลงทุน (หุ้นธุรกิจส่วนตัว) มาให้เลือกในฟอร์มเพิ่ม</div>
        {(data.estateBusinessSuccession || []).length ? (
          <div className="flex flex-col gap-3">
            {data.estateBusinessSuccession.map((b) => (
              <div key={b.id} className="p-3 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
                <div className="flex items-center justify-between mb-2">
                  <EditableText value={b.businessName || "ระบุชื่อธุรกิจ..."} onSave={(v) => updateItem("estateBusinessSuccession", b.id, { businessName: v })} style={{ fontSize: "14px", fontWeight: 600 }} />
                  <button onClick={() => removeItem("estateBusinessSuccession", b.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ fontSize: "12px" }}>
                  <div>
                    <div style={{ color: "#8A93A0" }}>ผู้รับช่วงต่อ</div>
                    <EditableText value={b.successor || "-"} onSave={(v) => updateItem("estateBusinessSuccession", b.id, { successor: v })} style={{ fontSize: "12px" }} />
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>สัญญา Buy-Sell</div>
                    <select
                      value={b.hasBuySellAgreement || ""}
                      onChange={(e) => updateItem("estateBusinessSuccession", b.id, { hasBuySellAgreement: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", border: "none" }}
                    >
                      {YES_NO_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o || "— เลือก —"}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>วิธีประเมินมูลค่า</div>
                    <EditableText value={b.valuationMethod || "-"} onSave={(v) => updateItem("estateBusinessSuccession", b.id, { valuationMethod: v })} style={{ fontSize: "12px" }} />
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>Key-person Insurance</div>
                    <select
                      value={b.keyPersonInsurance || ""}
                      onChange={(e) => updateItem("estateBusinessSuccession", b.id, { keyPersonInsurance: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", border: "none" }}
                    >
                      {YES_NO_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o || "— เลือก —"}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีแผนสืบทอดธุรกิจ — เพิ่มด้วยปุ่มด้านบน" />
        )}
      </Card>

      {/* 6. Review timeline & checklist */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardCheck size={16} color="#C9A227" />
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>Review Timeline & Checklist</div>
        </div>
        <div className="flex items-center gap-2 mb-4" style={{ fontSize: "12.5px", color: "#8A93A0" }}>
          ทบทวนครั้งถัดไป:
          <EditableText value={data.estateNextReviewDate || "ยังไม่ระบุ"} onSave={(v) => setField("estateNextReviewDate", v)} style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }} />
        </div>
        <div style={{ fontSize: "10.5px", color: "#8A93A0", marginBottom: 10 }}>ควรทบทวนใหม่ทุกครั้งที่มีเหตุการณ์สำคัญ: แต่งงาน/หย่า/มีลูก/ซื้อทรัพย์สินก้อนใหญ่</div>
        <div className="flex flex-col gap-2">
          {checklist.map((c) => (
            <div key={c.key} className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
              <EstateChecklistDot done={c.done} />
              <span style={{ fontSize: "13px", color: c.done ? "#8A93A0" : "#EAE7E0", textDecoration: c.done ? "line-through" : "none" }}>{c.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function FamilyTab({ members, setModal, removeItem, updateItem }) {
  const totalMembers = members.length;
  const dependentCount = members.filter((m) => m.familyRole === "dependent").length;
  const assetHolderCount = members.filter((m) => m.isAssetHolder).length;

  return (
    <div className="flex flex-col gap-8">
      {/* header + avatar strip */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: "1.2rem" }}>Family Members · สมาชิกครอบครัว</div>
            <div style={{ fontSize: "11.5px", color: "#8A93A0", marginTop: 2 }}>ทุกช่องแก้ไขภายหลังได้ ไม่ต้องกรอกละเอียดตั้งแต่แรก</div>
          </div>
          <button
            onClick={() => setModal({ type: "familyMember" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs shrink-0"
            style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}
          >
            <Plus size={13} /> เพิ่มสมาชิก
          </button>
        </div>

        {members.length > 0 && (
          <div className="flex flex-col gap-1 mt-5">
            {Object.entries(GENERATIONS).map(([genKey, gen]) => {
              const genMembers = members.filter((m) => (m.generation || "G1") === genKey);
              if (!genMembers.length) return null;
              return (
                <div key={genKey}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="px-2 py-0.5 rounded-full"
                      style={{ background: `${gen.color}22`, color: gen.color, fontSize: "10.5px", fontWeight: 600, fontFamily: "Inter" }}
                    >
                      {gen.label}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "#1E2A38" }} />
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-1 mb-4">
                    {genMembers.map((m) => {
                      const role = FAMILY_ROLES[m.familyRole] || FAMILY_ROLES.member;
                      const age = calcAgeFromBirthDate(m.birthDate, m.birthDateCalendar, m.birthYear);
                      const displayName = m.nickname || m.fullNameTh || m.fullNameEn || "ไม่ระบุชื่อ";
                      return (
                        <div key={m.id} className="flex flex-col items-center gap-1.5 p-3 rounded-xl shrink-0" style={{ background: "#101820", border: "1px solid #1E2A38", minWidth: 92 }}>
                          <div
                            className="w-11 h-11 rounded-full flex items-center justify-center text-lg"
                            style={{ background: `${role.color}22`, border: `1px solid ${role.color}55` }}
                          >
                            {role.emoji}
                          </div>
                          <div style={{ fontSize: "12.5px", fontWeight: 600, textAlign: "center" }}>{displayName}</div>
                          <div style={{ fontSize: "9.5px", color: "#8A93A0", textAlign: "center" }}>{m.relationship || "-"}</div>
                          <div style={{ fontSize: "10px", color: role.color, textAlign: "center" }}>{role.label}</div>
                          <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>{age !== null ? `${age} ปี` : "-"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* stats — compact single row */}
      <Card className="p-4">
        <div className="flex items-center justify-around divide-x" style={{ divideColor: "#1E2A38" }}>
          <div className="flex items-center gap-2 px-3">
            <Users size={15} color="#C9A227" />
            <span style={{ fontFamily: "JetBrains Mono", fontSize: "1.1rem" }}>{totalMembers}</span>
            <span style={{ fontSize: "11.5px", color: "#8A93A0" }}>สมาชิกทั้งหมด</span>
          </div>
          <div className="flex items-center gap-2 px-3" style={{ borderLeft: "1px solid #1E2A38" }}>
            <Info size={15} color="#8A6FBF" />
            <span style={{ fontFamily: "JetBrains Mono", fontSize: "1.1rem" }}>{dependentCount}</span>
            <span style={{ fontSize: "11.5px", color: "#8A93A0" }}>ผู้พึ่งพิง</span>
          </div>
          <div className="flex items-center gap-2 px-3" style={{ borderLeft: "1px solid #1E2A38" }}>
            <Shield size={15} color="#4FA37B" />
            <span style={{ fontFamily: "JetBrains Mono", fontSize: "1.1rem" }}>{assetHolderCount}</span>
            <span style={{ fontSize: "11.5px", color: "#8A93A0" }}>ผู้ถือทรัพย์สิน</span>
          </div>
        </div>
      </Card>

      {/* detail cards */}
      {members.length ? (
        <div className="flex flex-col gap-4">
          {members.map((m) => {
            const role = FAMILY_ROLES[m.familyRole] || FAMILY_ROLES.member;
            const age = calcAgeFromBirthDate(m.birthDate, m.birthDateCalendar, m.birthYear);
            return (
              <Card key={m.id} className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-base shrink-0"
                      style={{ background: `${role.color}22`, border: `1px solid ${role.color}55` }}
                    >
                      {role.emoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <EditableText value={m.nickname || "เพิ่มชื่อเล่น"} onSave={(v) => updateItem("familyMembers", m.id, { nickname: v })} style={{ fontSize: "14.5px", fontWeight: 600 }} />
                        <select
                          value={m.generation || "G1"}
                          onChange={(e) => updateItem("familyMembers", m.id, { generation: e.target.value })}
                          className="text-xs outline-none px-1.5 py-0.5 rounded-full"
                          style={{ background: `${GENERATIONS[m.generation || "G1"].color}22`, color: GENERATIONS[m.generation || "G1"].color, border: "none", fontSize: "10px" }}
                        >
                          {Object.entries(GENERATIONS).map(([key, g]) => (
                            <option key={key} value={key} style={{ background: "#1E2A38", color: "#EAE7E0" }}>{g.label}</option>
                          ))}
                        </select>
                        {m.isAssetHolder && (
                          <span className="px-1.5 py-0.5 rounded-full" style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "10px" }}>ผู้ถือทรัพย์สิน</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: "12px", color: "#8A93A0", marginTop: 3 }}>
                        <span>ไทย: <EditableText value={m.fullNameTh || "ระบุชื่อ-นามสกุล"} onSave={(v) => updateItem("familyMembers", m.id, { fullNameTh: v })} style={{ fontSize: "12px" }} /></span>
                        <span>EN: <EditableText value={m.fullNameEn || "Add name"} onSave={(v) => updateItem("familyMembers", m.id, { fullNameEn: v })} style={{ fontSize: "12px" }} /></span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => removeItem("familyMembers", m.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" style={{ fontSize: "12px" }}>
                  <div>
                    <div style={{ color: "#8A93A0" }}>ความสัมพันธ์</div>
                    <select
                      value={m.relationship || ""}
                      onChange={(e) => updateItem("familyMembers", m.id, { relationship: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", fontFamily: "Inter", border: "none" }}
                    >
                      <option value="">— เลือก —</option>
                      {RELATIONSHIP_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>เพศ</div>
                    <select
                      value={m.gender || ""}
                      onChange={(e) => updateItem("familyMembers", m.id, { gender: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", fontFamily: "Inter", border: "none" }}
                    >
                      <option value="">— เลือก —</option>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>บทบาทในครอบครัว</div>
                    <select
                      value={m.familyRole || "member"}
                      onChange={(e) => updateItem("familyMembers", m.id, { familyRole: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: role.color, fontFamily: "Inter", border: "none" }}
                    >
                      {Object.entries(FAMILY_ROLES).map(([key, r]) => (
                        <option key={key} value={key}>{r.emoji} {r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>วันเดือนปีเกิด</div>
                    <div className="flex items-center gap-1">
                      <EditableText value={m.birthDate || "-"} onSave={(v) => updateItem("familyMembers", m.id, { birthDate: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                      <select
                        value={m.birthDateCalendar || "ad"}
                        onChange={(e) => updateItem("familyMembers", m.id, { birthDateCalendar: e.target.value })}
                        className="text-xs outline-none"
                        style={{ background: "transparent", color: "#8A93A0", border: "none" }}
                        title="ระบุว่าปีที่กรอกเป็น ค.ศ. หรือ พ.ศ."
                      >
                        <option value="ad">ค.ศ.</option>
                        <option value="be">พ.ศ.</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>อายุ (คำนวณอัตโนมัติ)</div>
                    <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>{age !== null ? `${age} ปี` : "-"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3" style={{ fontSize: "12px" }}>
                  <div>
                    <div style={{ color: "#8A93A0" }}>เลขบัตร ปชช. / Passport</div>
                    <EditableText value={m.idNumber || "-"} onSave={(v) => updateItem("familyMembers", m.id, { idNumber: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }} title="มีผลต่อกฎหมายสินสมรส/สินส่วนตัว">สถานภาพสมรส</div>
                    <select
                      value={m.maritalStatus || ""}
                      onChange={(e) => updateItem("familyMembers", m.id, { maritalStatus: e.target.value })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", fontFamily: "Inter", border: "none" }}
                    >
                      <option value="">— เลือก —</option>
                      {MARITAL_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>กรุ๊ปเลือด</div>
                    <EditableText value={m.bloodType || "-"} onSave={(v) => updateItem("familyMembers", m.id, { bloodType: v })} style={{ fontSize: "12px" }} />
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>ผู้ถือทรัพย์สิน?</div>
                    <select
                      value={m.isAssetHolder ? "yes" : "no"}
                      onChange={(e) => updateItem("familyMembers", m.id, { isAssetHolder: e.target.value === "yes" })}
                      className="text-xs outline-none mt-0.5"
                      style={{ background: "transparent", color: "#EAE7E0", fontFamily: "Inter", border: "none" }}
                    >
                      <option value="no">ไม่ใช่</option>
                      <option value="yes">ใช่</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3" style={{ fontSize: "12px" }}>
                  <div>
                    <div style={{ color: "#8A93A0" }}>ผู้ติดต่อฉุกเฉิน</div>
                    <EditableText value={m.emergencyContactName || "-"} onSave={(v) => updateItem("familyMembers", m.id, { emergencyContactName: v })} style={{ fontSize: "12px" }} />
                  </div>
                  <div>
                    <div style={{ color: "#8A93A0" }}>เบอร์โทรฉุกเฉิน</div>
                    <EditableText value={m.emergencyContactPhone || "-"} onSave={(v) => updateItem("familyMembers", m.id, { emergencyContactPhone: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                  </div>
                </div>

                <div className="mt-3">
                  <div style={{ fontSize: "12px", color: "#8A93A0" }}>โรคประจำตัว / ยา / แพ้ยา</div>
                  <EditableText
                    value={m.medicalConditions || "เพิ่มข้อมูล..."}
                    onSave={(v) => updateItem("familyMembers", m.id, { medicalConditions: v })}
                    style={{ fontSize: "12.5px" }}
                  />
                </div>

                <div className="mt-2 pt-2" style={{ borderTop: "1px solid #1E2A38" }}>
                  <EditableText
                    value={m.notes || "เพิ่มบันทึกเพิ่มเติม..."}
                    onSave={(v) => updateItem("familyMembers", m.id, { notes: v })}
                    style={{ fontSize: "11.5px", color: "#8A93A0", fontStyle: "italic" }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState text="ยังไม่มีสมาชิกครอบครัว — เพิ่มด้วยปุ่มด้านบน" />
      )}
    </div>
  );
}

/* ================= shared components ================= */

/* ================= DEBT TAB (Debt Freedom) ================= */

const DEBT_CATEGORY_ICONS = {
  บ้าน: Home,
  รถ: Wallet,
  บัตรเครดิต: Wallet,
  ธุรกิจ: Building2,
  ส่วนบุคคล: Wallet,
  "กยศ.": Wallet,
  อื่นๆ: Wallet,
};

const MRTA_LABELS = { มี: "มี — หนี้หายถ้าผู้กู้เสียชีวิต", ไม่มี: "ไม่มี — ทายาทต้องรับภาระ", ไม่แน่ใจ: "ไม่แน่ใจ" };
const MRTA_COLORS = { มี: "#4FA37B", ไม่มี: "#C1554A", ไม่แน่ใจ: "#C9A227" };

function DebtTab({
  liabilities, debtStrategy, debtExtraPayment, debtSimSnowball, debtSimAvalanche, activeDebtSim,
  activeDebtsCount, totalLiabilities, totalMonthlyDebtPayment, weightedInterestRate,
  setModal, removeItem, updateItem, updateSettings,
}) {
  const orderedDebts = useMemo(() => {
    const byId = Object.fromEntries(liabilities.map((l) => [l.id, l]));
    const ranked = activeDebtSim.order.map((id) => byId[id]).filter(Boolean);
    const rest = liabilities.filter((l) => !activeDebtSim.order.includes(l.id));
    return [...ranked, ...rest];
  }, [liabilities, activeDebtSim.order]);

  const nextDebt = orderedDebts.find((l) => l.status !== "Closed" && l.status !== "Paid" && Number(l.currentBalance) > 0);
  const paidOffCount = liabilities.length - activeDebtsCount;
  const totalMinPayment = liabilities.reduce((s, l) => (l.status === "Closed" || l.status === "Paid" ? s : s + Number(l.monthlyPayment || 0)), 0);
  const totalBudget = totalMinPayment + debtExtraPayment;

  const betterStrategy =
    debtSimSnowball.totalInterest === debtSimAvalanche.totalInterest
      ? null
      : debtSimSnowball.totalInterest < debtSimAvalanche.totalInterest
      ? "snowball"
      : "avalanche";

  const rankLabels = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
  const [yearSystem, setYearSystem] = useState("be"); // "be" พ.ศ. or "ad" ค.ศ.

  return (
    <div className="flex flex-col gap-8">
      {/* hero */}
      <Card className="p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: "12px", color: "#8A93A0", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            <Flame size={13} color="#C9A227" /> วันที่ปลดหนี้ (โดยประมาณ)
            <button
              onClick={() => setYearSystem((y) => (y === "be" ? "ad" : "be"))}
              className="px-1.5 py-0.5 rounded-full normal-case"
              style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#8A93A0", fontSize: "10px", letterSpacing: 0 }}
              title="สลับ พ.ศ. / ค.ศ."
            >
              {yearSystem === "be" ? "พ.ศ." : "ค.ศ."} ⇄
            </button>
          </div>
          <div style={{ fontFamily: "Fraunces", fontSize: "2.2rem", fontWeight: 500, lineHeight: 1.15, marginTop: 6 }}>
            {activeDebtsCount === 0
              ? "ปลอดหนี้แล้ว 🎉"
              : formatDebtFreeDate(activeDebtSim.months, { capped: activeDebtSim.capped, feasible: activeDebtSim.feasible, yearSystem })}
          </div>
          <div style={{ fontSize: "13px", color: "#8A93A0", marginTop: 6, fontStyle: "italic" }}>"ทุกงวดที่จ่าย คือก้าวหนึ่งที่ใกล้อิสรภาพทางการเงิน"</div>
        </div>
        <div className="flex flex-col items-end gap-1" style={{ fontFamily: "JetBrains Mono" }}>
          <div style={{ fontSize: "12px", color: "#8A93A0" }}>ดอกเบี้ยที่จะจ่ายรวม (แผนปัจจุบัน)</div>
          <div style={{ fontSize: "1.4rem", color: "#C1554A" }}>{fmtTHB(activeDebtSim.totalInterest)}</div>
          {(!activeDebtSim.feasible || activeDebtSim.capped) && activeDebtsCount > 0 && (
            <div style={{ fontSize: "11px", color: "#C1554A", maxWidth: 240, textAlign: "right" }}>
              ⚠ ยอดผ่อนขั้นต่ำรวมอาจไม่พอจ่ายดอกเบี้ยของหนี้บางก้อน ลองเพิ่มเงินโปะ
            </div>
          )}
        </div>
      </Card>

      {/* stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="หนี้สินรวม" value={fmtCompact(totalLiabilities)} icon={TrendingDown} accent="#C1554A" />
        <StatCard label="ผ่อนขั้นต่ำรวม/เดือน" value={fmtCompact(totalMinPayment)} icon={Wallet} accent="#5B84B1" />
        <StatCard label="งบจ่ายหนี้รวม/เดือน" value={fmtCompact(totalBudget)} icon={PiggyBank} accent="#C9A227" />
        <StatCard label="หนี้ Active" value={`${activeDebtsCount} จาก ${liabilities.length}`} icon={Shield} accent="#4FA37B" />
      </div>

      {/* strategy chooser */}
      <Card className="p-6">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem", marginBottom: 4 }}>⚔️ เลือกกลยุทธ์ปลดหนี้</div>
        <div style={{ fontSize: "12px", color: "#8A93A0", marginBottom: 16 }}>Snowball ให้กำลังใจเร็ว (โปะก้อนเล็กก่อน) ส่วน Avalanche ประหยัดดอกเบี้ยสุด (โปะดอกเบี้ยสูงก่อน)</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <button
            onClick={() => updateSettings("debtSettings", { strategy: "snowball" })}
            className="p-4 rounded-xl text-left"
            style={{
              background: debtStrategy === "snowball" ? "#1E2A38" : "#101820",
              border: `1px solid ${debtStrategy === "snowball" ? "#C9A227" : "#1E2A38"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Snowflake size={15} color="#5B84B1" />
              <span style={{ fontWeight: 600, fontSize: "14px" }}>Snowball</span>
              {betterStrategy === "snowball" && <span className="px-1.5 py-0.5 rounded-full" style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "10px" }}>ประหยัดสุด</span>}
            </div>
            <div style={{ fontSize: "12px", color: "#8A93A0" }}>โปะยอดคงเหลือน้อยสุดก่อน</div>
            <div className="flex items-center gap-3 mt-2" style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }}>
              <span>{debtSimSnowball.months} เดือน</span>
              <span style={{ color: "#C1554A" }}>ดอกเบี้ย {fmtCompact(debtSimSnowball.totalInterest)}</span>
            </div>
          </button>
          <button
            onClick={() => updateSettings("debtSettings", { strategy: "avalanche" })}
            className="p-4 rounded-xl text-left"
            style={{
              background: debtStrategy === "avalanche" ? "#1E2A38" : "#101820",
              border: `1px solid ${debtStrategy === "avalanche" ? "#C9A227" : "#1E2A38"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Mountain size={15} color="#C9A227" />
              <span style={{ fontWeight: 600, fontSize: "14px" }}>Avalanche</span>
              {betterStrategy === "avalanche" && <span className="px-1.5 py-0.5 rounded-full" style={{ background: "#4FA37B22", color: "#4FA37B", fontSize: "10px" }}>ประหยัดสุด</span>}
            </div>
            <div style={{ fontSize: "12px", color: "#8A93A0" }}>โปะดอกเบี้ยสูงสุดก่อน</div>
            <div className="flex items-center gap-3 mt-2" style={{ fontFamily: "JetBrains Mono", fontSize: "13px" }}>
              <span>{debtSimAvalanche.months} เดือน</span>
              <span style={{ color: "#C1554A" }}>ดอกเบี้ย {fmtCompact(debtSimAvalanche.totalInterest)}</span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "#101820", border: "1px solid #1E2A38" }}>
          <PiggyBank size={15} color="#C9A227" />
          <span style={{ fontSize: "13px" }}>เงินโปะเพิ่ม/เดือน:</span>
          <EditableNumber value={debtExtraPayment} onSave={(v) => updateSettings("debtSettings", { extraPayment: v })} />
          <span style={{ fontSize: "12px", color: "#8A93A0" }}>บาท (นอกเหนือจากยอดผ่อนขั้นต่ำ)</span>
        </div>
      </Card>

      {/* next milestone */}
      {nextDebt && (
        <Card className="p-5 flex items-center gap-3" style={{ borderColor: "#C9A22755" }}>
          <Target size={18} color="#C9A227" />
          <div>
            <span style={{ fontSize: "13px" }}>🎯 เป้าหมายถัดไป: ปิด </span>
            <strong style={{ fontSize: "13px" }}>{nextDebt.name}</strong>
            <span style={{ fontSize: "13px", color: "#8A93A0" }}> — เหลืออีก {fmtTHB(nextDebt.currentBalance)}</span>
            {activeDebtSim.payoffMonth[nextDebt.id] && (
              <span style={{ fontSize: "12px", color: "#4FA37B", marginLeft: 6 }}>
                (คาดว่าจะปิดได้ {formatDebtFreeDate(activeDebtSim.payoffMonth[nextDebt.id], { yearSystem })})
              </span>
            )}
          </div>
        </Card>
      )}

      {/* payoff chart */}
      {activeDebtSim.schedule.length > 1 && (
        <Card className="p-6">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.05rem", marginBottom: 16 }}>เส้นทางสู่การปลดหนี้ (ยอดคงเหลือรวม)</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={activeDebtSim.schedule}>
              <defs>
                <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C1554A" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#C1554A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1E2A38" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={{ stroke: "#2A3949" }} tickLine={false} tickFormatter={(m) => `เดือน ${m}`} />
              <YAxis tickFormatter={fmtCompact} tick={{ fill: "#8A93A0", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip
                contentStyle={{ background: "#1E2A38", border: "1px solid #2A3949", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
                labelStyle={{ color: "#EAE7E0" }}
                itemStyle={{ color: "#EAE7E0" }}
                labelFormatter={(m) => `เดือนที่ ${m}`}
                formatter={(v) => [fmtTHB(v), "ยอดคงเหลือ"]}
              />
              <Area type="monotone" dataKey="balance" stroke="#C1554A" strokeWidth={2} fill="url(#debtGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* battle order list */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>ลำดับการโจมตีหนี้ ({debtStrategy === "avalanche" ? "Avalanche" : "Snowball"})</div>
          <button onClick={() => setModal({ type: "liability" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
            <Plus size={13} /> เพิ่มหนี้สิน
          </button>
        </div>
        <div style={{ fontSize: "11px", color: "#8A93A0", marginBottom: 16 }}>แตะตัวเลขเพื่อแก้ไขได้โดยตรง — ลำดับอัปเดตอัตโนมัติตามกลยุทธ์ที่เลือก</div>

        {orderedDebts.length ? (
          <div className="flex flex-col gap-4">
            {orderedDebts.map((l, i) => {
              const isPaidOff = l.status === "Closed" || l.status === "Paid" || Number(l.currentBalance) <= 0;
              const original = Number(l.originalAmount || 0);
              const balance = Number(l.currentBalance || 0);
              const paidOffPct = original ? Math.min(((original - balance) / original) * 100, 100) : 0;
              const payoffM = activeDebtSim.payoffMonth[l.id];
              const Icon = DEBT_CATEGORY_ICONS[l.category] || Wallet;
              const rankIdx = activeDebtSim.order.indexOf(l.id);
              const standalone = estimateStandalonepayoff(l);
              const hasMaturityDate = !!l.maturityDate;
              return (
                <div key={l.id} className="p-4 rounded-xl" style={{ background: "#101820", border: `1px solid ${isPaidOff ? "#4FA37B44" : "#1E2A38"}`, opacity: isPaidOff ? 0.6 : 1 }}>
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-start gap-2.5">
                      {rankIdx >= 0 && !isPaidOff && (
                        <span className="px-2 py-0.5 rounded-full shrink-0" style={{ background: "#C9A22722", color: "#C9A227", fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: 600 }}>
                          {rankLabels[rankIdx] || `${rankIdx + 1}th`}
                        </span>
                      )}
                      <Icon size={15} color="#8A93A0" style={{ marginTop: 2 }} />
                      <div>
                        <EditableText value={l.name} onSave={(v) => updateItem("liabilities", l.id, { name: v })} style={{ fontSize: "14px", fontWeight: 600 }} />
                        <div style={{ fontSize: "12px", color: "#8A93A0", marginTop: 2 }}>
                          <EditableText value={l.lender || "-"} onSave={(v) => updateItem("liabilities", l.id, { lender: v })} style={{ fontSize: "12px" }} /> · {l.category}
                          {l.borrower && <span> · ผู้กู้: {l.borrower}</span>}
                          {l.mrtaInsurance && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-full" style={{ background: `${MRTA_COLORS[l.mrtaInsurance]}22`, color: MRTA_COLORS[l.mrtaInsurance], fontSize: "10px" }}>
                              MRTA: {l.mrtaInsurance}
                            </span>
                          )}
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded-full"
                            style={{
                              background: l.status === "Active" ? "#4FA37B22" : l.status === "Paid" ? "#5B84B122" : "#8A93A022",
                              color: l.status === "Active" ? "#4FA37B" : l.status === "Paid" ? "#5B84B1" : "#8A93A0",
                              fontSize: "10px",
                            }}
                          >
                            {l.status || "Active"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="text-right">
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", color: "#C1554A" }}>
                          <EditableNumber value={l.currentBalance} onSave={(v) => updateItem("liabilities", l.id, { currentBalance: v })} />
                        </div>
                        {payoffM && !isPaidOff && <div style={{ fontSize: "11px", color: "#4FA37B" }}>ในแผนนี้ปิดได้ {formatDebtFreeDate(payoffM, { yearSystem })}</div>}
                      </div>
                      <button onClick={() => removeItem("liabilities", l.id)} style={{ color: "#8A93A0" }}><Trash2 size={14} /></button>
                    </div>
                  </div>

                  <div className="mb-2">
                    <div style={{ height: 6, borderRadius: 3, background: "#17212B", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${paidOffPct}%`, background: "#4FA37B", borderRadius: 3 }} />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span style={{ fontSize: "11px", color: "#8A93A0" }}>ผ่อนไปแล้ว {paidOffPct.toFixed(0)}%</span>
                      <span style={{ fontSize: "11px", color: "#8A93A0" }}>
                        เงินต้นเริ่มต้น: <EditableNumber value={l.originalAmount || 0} onSave={(v) => updateItem("liabilities", l.id, { originalAmount: v })} />
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3" style={{ fontSize: "12px" }}>
                    <div>
                      <div style={{ color: "#8A93A0" }}>ดอกเบี้ย</div>
                      <EditableText value={l.interestRate || ""} onSave={(v) => updateItem("liabilities", l.id, { interestRate: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12.5px" }} />
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>รูปแบบดอกเบี้ย</div>
                      <select
                        value={l.interestType || "reducing"}
                        onChange={(e) => updateItem("liabilities", l.id, { interestType: e.target.value })}
                        className="text-xs outline-none"
                        style={{ background: "transparent", color: "#EAE7E0", fontFamily: "JetBrains Mono", border: "none" }}
                      >
                        <option value="reducing">ลดต้นลดดอก</option>
                        <option value="flat">คงที่</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>ผ่อน/เดือน</div>
                      <span style={{ fontFamily: "JetBrains Mono" }}>
                        <EditableNumber value={l.monthlyPayment} onSave={(v) => updateItem("liabilities", l.id, { monthlyPayment: v })} />
                      </span>
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>สถานะ</div>
                      <select
                        value={l.status || "Active"}
                        onChange={(e) => updateItem("liabilities", l.id, { status: e.target.value })}
                        className="text-xs outline-none"
                        style={{ background: "transparent", color: "#EAE7E0", fontFamily: "JetBrains Mono", border: "none" }}
                      >
                        <option value="Active">Active</option>
                        <option value="Paid">Paid</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3" style={{ fontSize: "12px" }}>
                    <div>
                      <div style={{ color: "#8A93A0" }}>วันที่เริ่มกู้</div>
                      <EditableText value={l.startDate || "-"} onSave={(v) => updateItem("liabilities", l.id, { startDate: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>วันที่ครบกำหนด</div>
                      {hasMaturityDate ? (
                        <EditableText value={l.maturityDate} onSave={(v) => updateItem("liabilities", l.id, { maturityDate: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                      ) : standalone.feasible && standalone.date ? (
                        <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#C9A227" }} title="ประมาณจากยอดผ่อน/เดือน (ยังไม่ได้ระบุวันที่จริง)">
                          ~{formatDebtFreeDate(standalone.months, { yearSystem })}
                        </span>
                      ) : (
                        <span style={{ fontSize: "12px", color: "#8A93A0" }}>-</span>
                      )}
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>งวดที่เหลือ (ประมาณ)</div>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: "#8A93A0" }}>
                        {standalone.feasible && standalone.months ? `${standalone.months} งวด` : "-"}
                      </span>
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>หลักประกัน</div>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>
                        {l.hasCollateral === "มี" ? (
                          <EditableText value={l.collateralAsset || "ระบุ..."} onSave={(v) => updateItem("liabilities", l.id, { collateralAsset: v })} style={{ fontSize: "12px" }} />
                        ) : (
                          <select
                            value={l.hasCollateral || ""}
                            onChange={(e) => updateItem("liabilities", l.id, { hasCollateral: e.target.value })}
                            className="text-xs outline-none"
                            style={{ background: "transparent", color: "#8A93A0", border: "none" }}
                          >
                            <option value="">— ระบุ —</option>
                            <option value="มี">มี</option>
                            <option value="ไม่มี">ไม่มี</option>
                          </select>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3" style={{ fontSize: "12px" }}>
                    <div>
                      <div style={{ color: "#8A93A0" }}>ผู้กู้</div>
                      <EditableText value={l.borrower || "-"} onSave={(v) => updateItem("liabilities", l.id, { borrower: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>MRTA</div>
                      <select
                        value={l.mrtaInsurance || ""}
                        onChange={(e) => updateItem("liabilities", l.id, { mrtaInsurance: e.target.value })}
                        className="text-xs outline-none"
                        style={{ background: "transparent", color: "#EAE7E0", fontFamily: "JetBrains Mono", border: "none" }}
                      >
                        <option value="">— เลือก —</option>
                        <option value="มี">มี</option>
                        <option value="ไม่มี">ไม่มี</option>
                        <option value="ไม่แน่ใจ">ไม่แน่ใจ</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ color: "#8A93A0" }}>สิ้นสุด (ระบุปี)</div>
                      <EditableText value={l.endYear || "-"} onSave={(v) => updateItem("liabilities", l.id, { endYear: v })} style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }} />
                    </div>
                  </div>
                  {(l.notes || true) && (
                    <div className="mt-2 pt-2" style={{ borderTop: "1px solid #1E2A38" }}>
                      <EditableText
                        value={l.notes || "เพิ่มบันทึก..."}
                        onSave={(v) => updateItem("liabilities", l.id, { notes: v })}
                        style={{ fontSize: "11.5px", color: "#8A93A0", fontStyle: "italic" }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="ยังไม่มีหนี้สิน — เพิ่มด้วยปุ่มด้านบน" />
        )}
      </Card>
    </div>
  );
}

/* ================= shared components ================= */

function ListPanel({ title, rows, headers, renderRow, onAdd, onRemove }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontFamily: "Fraunces", fontSize: "1.1rem" }}>{title}</div>
        <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "#1E2A38", border: "1px solid #2A3949", color: "#EAE7E0" }}>
          <Plus size={13} /> เพิ่ม
        </button>
      </div>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={i === headers.length - 1 ? { textAlign: "right" } : {}}>{h}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {renderRow(r)}
                <td>
                  <button onClick={() => onRemove(r.id)} style={{ color: "#8A93A0" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState text="ยังไม่มีข้อมูล" />
      )}
    </Card>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
      <Circle size={22} color="#2A3949" />
      <span style={{ color: "#8A93A0", fontSize: "13px" }}>{text}</span>
    </div>
  );
}

/* ================= entry modal ================= */

// Cleans up the shared "estate detail" fields (owners/heirs/confidence/location/story) before saving
function estateFields(form) {
  return {
    owners: (form.owners || []).filter((r) => r.memberId).map((r) => ({ memberId: r.memberId, pct: Number(r.pct || 0) })),
    heirs: (form.heirs || []).filter((r) => r.memberId).map((r) => ({ memberId: r.memberId, pct: Number(r.pct || 0) })),
    confidence: form.confidence || "",
    documentLocation: form.documentLocation || "",
    story: form.story || "",
  };
}

// Shared block of "estate detail" fields — used in the add-forms for assets, real estate, precious metals, business equity
function EstateDetailFieldsBlock({ form, set, familyMembers }) {
  return (
    <div className="flex flex-col gap-3 pt-2 mt-1" style={{ borderTop: "1px solid #1E2A38" }}>
      <div style={{ fontSize: "11px", color: "#8A93A0" }}>รายละเอียดเพิ่มเติม (ไม่บังคับ ใส่เท่าที่รู้)</div>
      <SelectField
        label="ความมั่นใจในข้อมูล"
        value={form.confidence}
        onChange={(e) => set("confidence", e.target.value)}
        options={["", "Confirmed — ยืนยันแล้ว", "Estimated — ประมาณการ"]}
      />
      <InputField label="อยู่ที่ไหน / เอกสารอยู่ไหน" value={form.documentLocation} onChange={(e) => set("documentLocation", e.target.value)} placeholder="เช่น ตู้เซฟที่บ้าน, โฉนดอยู่ธนาคาร" />
      <PersonSplitEditor
        label="เจ้าของ (แบ่ง % ได้หลายคน)"
        value={form.owners}
        onChange={(v) => set("owners", v)}
        familyMembers={familyMembers}
      />
      <PersonSplitEditor
        label="ตั้งใจยกให้ (แบ่ง % ได้หลายคน)"
        value={form.heirs}
        onChange={(v) => set("heirs", v)}
        familyMembers={familyMembers}
        hint="ใช้ในแท็บ Estate Planning"
      />
      <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
        เรื่องราว
        <textarea
          value={form.story}
          onChange={(e) => set("story", e.target.value)}
          rows={2}
          placeholder="ทำไมถึงซื้อ อยากยกให้ใครเพราะอะไร..."
          className="px-3 py-2 rounded-lg outline-none text-sm resize-y"
          style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
        />
      </label>
    </div>
  );
}

function EntryModal({ modal, onClose, onSave, familyMembers, onAddLot, onSellFIFO, offshoreStocks, onAddManualSale }) {
  const { type } = modal;

  const [form, setForm] = useState(() => {
    if (type === "asset") return { name: "", category: "เงินสด", value: "", asOfDate: todayStr(), owners: [], heirs: [], confidence: "", documentLocation: "", story: "" };
    if (type === "liability")
      return {
        name: "", lender: "", borrower: "", category: "บ้าน", currentBalance: "", originalAmount: "",
        interestRate: "", interestType: "reducing", monthlyPayment: "", startDate: "", maturityDate: "", endYear: "",
        mrtaInsurance: "", hasCollateral: "", collateralAsset: "", status: "Active", notes: "",
      };
    if (type === "cashAccount") return { name: "", subCategory: "Cash", amount: "", currency: "THB", fxToThb: "1", yieldPct: "", asOfDate: todayStr() };
    if (type === "domesticFund") return { name: "", symbol: "", subCategory: "Mutual Funds", broker: "", units: "", avgPrice: "", currentPrice: "", dividendYr: "", dcaMonth: "", targetPct: "", asOfDate: todayStr() };
    if (type === "offshoreStock") return { name: "", symbol: "", subCategory: "Stocks", broker: "", units: "", avgPrice: "", currentPrice: "", dividendYr: "", dcaMonth: "", targetPct: "", asOfDate: todayStr() };
    if (type === "realEstate") return { name: "", subCategory: "Residential", purchasePrice: "", currentValue: "", rentalIncomeYr: "", asOfDate: todayStr(), owners: [], heirs: [], confidence: "", documentLocation: "", story: "" };
    if (type === "preciousMetal") return { name: "", subCategory: "Gold", qty: "", avgCost: "", marketPrice: "", asOfDate: todayStr(), owners: [], heirs: [], confidence: "", documentLocation: "", story: "" };
    if (type === "businessEquity") return { name: "", subCategory: "Startup Shares", ownershipPct: "", avgCost: "", currentValue: "", dividendYr: "", asOfDate: todayStr(), owners: [], heirs: [], confidence: "", documentLocation: "", story: "" };
    if (type === "transaction")
      return {
        date: todayStr(), type: "รายจ่าย", category: "", flowCategory: "", amount: "", memberId: "", note: "",
        frequency: "once", occurrences: "12",
      };
    if (type === "policy")
      return {
        owner: "", company: "", policyName: "", type_: "ประกันชีวิต", policyNumber: "",
        startDate: "", maturityDate: "", sumAssured: "", cashSurrenderValue: "", paymentMonth: "Jan", premium: "", beneficiary: "", status: "Active",
      };
    if (type === "bill") return { name: "", category: "อื่นๆ", amount: "", month: "Monthly", dueDay: "" };
    if (type === "coverageTarget") return { label: "", current: "", target: "", unit: "บาท" };
    if (type === "note") return { title: "", detail: "", icon: "estimate" };
    if (type === "familyMember")
      return {
        fullNameTh: "", fullNameEn: "", nickname: "", relationship: "", familyRole: "member", gender: "",
        generation: "G1", maritalStatus: "", idNumber: "",
        birthDate: "", birthDateCalendar: "ad",
        bloodType: "", medicalConditions: "", emergencyContactName: "", emergencyContactPhone: "", notes: "",
      };
    if (type === "estateHeir") return { memberId: "", assetDescription: "", notes: "" };
    if (type === "estateSuccession") return { businessName: "", successor: "", hasBuySellAgreement: "", valuationMethod: "", keyPersonInsurance: "" };
    if (type === "netWorthSnapshot") return { year: "", totalAssets: "", totalLiabilities: "" };
    if (type === "offshoreLot") return { date: todayStr(), units: "", pricePerUnit: "", currency: "USD" };
    if (type === "offshoreSell") return { date: todayStr(), units: "", pricePerUnit: "", currency: "USD" };
    if (type === "offshoreManualSale") return { stockId: "", date: todayStr(), units: "", salePricePerUnit: "", costPerUnit: "" };
    if (type === "fxRemittance") return { date: todayStr(), direction: "in", amount: "", currency: "USD", purpose: "", note: "" };
    return {};
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const titles = {
    asset: "เพิ่มสินทรัพย์", liability: "เพิ่มหนี้สิน", transaction: "เพิ่มธุรกรรม", policy: "เพิ่มกรมธรรม์ประกัน",
    bill: "เพิ่มรายการจ่ายประจำ", coverageTarget: "เพิ่มเป้าหมายความคุ้มครอง", note: "เพิ่มข้อควรรู้",
    cashAccount: "เพิ่มบัญชีเงินสด", domesticFund: "เพิ่มกองทุนในประเทศ", offshoreStock: "เพิ่มหุ้นต่างประเทศ",
    realEstate: "เพิ่มอสังหาริมทรัพย์", preciousMetal: "เพิ่มโลหะมีค่า", businessEquity: "เพิ่มหุ้นธุรกิจส่วนตัว",
    familyMember: "เพิ่มสมาชิกครอบครัว",
    estateHeir: "เพิ่มทายาท/รายการมรดก", estateSuccession: "เพิ่มแผนสืบทอดธุรกิจ", netWorthSnapshot: "เพิ่มข้อมูลปีย้อนหลัง",
    offshoreLot: "เพิ่มล็อตซื้อ", offshoreSell: "บันทึกการขาย (FIFO)", fxRemittance: "บันทึกเงินโอนเข้า-ออกต่างประเทศ",
    offshoreManualSale: "เพิ่มรายการขายเอง",
  };
  const keys = {
    asset: "assets", liability: "liabilities", transaction: "transactions", policy: "insurancePolicies",
    bill: "customBills", coverageTarget: "coverageTargets", note: "insuranceNotes",
    cashAccount: "cashAccounts", domesticFund: "domesticFunds", offshoreStock: "offshoreStocks",
    realEstate: "realEstate", preciousMetal: "preciousMetals", businessEquity: "businessEquity",
    familyMember: "familyMembers",
    estateHeir: "estateHeirs", estateSuccession: "estateBusinessSuccession", netWorthSnapshot: "netWorthSnapshots",
    fxRemittance: "fxRemittances",
  };

  function submit() {
    if (type === "asset") {
      if (!form.name || !form.value) return;
      onSave(keys[type], { name: form.name, category: form.category, value: Number(form.value), asOfDate: form.asOfDate, ...estateFields(form) });
    } else if (type === "liability") {
      if (!form.name) return;
      onSave(keys[type], {
        name: form.name,
        lender: form.lender,
        borrower: form.borrower,
        category: form.category,
        originalAmount: Number(form.originalAmount || form.currentBalance || 0),
        currentBalance: Number(form.currentBalance || 0),
        interestRate: form.interestRate,
        interestType: form.interestType,
        monthlyPayment: Number(form.monthlyPayment || 0),
        startDate: form.startDate,
        maturityDate: form.maturityDate,
        termMonths: 0,
        endYear: form.endYear,
        mrtaInsurance: form.mrtaInsurance,
        hasCollateral: form.hasCollateral,
        collateralAsset: form.collateralAsset,
        notes: form.notes,
        status: form.status || "Active",
      });
    } else if (type === "cashAccount") {
      if (!form.name || !form.amount) return;
      onSave(keys[type], {
        name: form.name, subCategory: form.subCategory, amount: Number(form.amount),
        currency: form.currency, fxToThb: Number(form.fxToThb || 1), yieldPct: Number(form.yieldPct || 0),
        asOfDate: form.asOfDate,
      });
    } else if (type === "domesticFund" || type === "offshoreStock") {
      if (!form.name || !form.units) return;
      onSave(keys[type], {
        name: form.name, symbol: form.symbol, subCategory: form.subCategory, broker: form.broker,
        units: Number(form.units), avgPrice: Number(form.avgPrice || 0), currentPrice: Number(form.currentPrice || form.avgPrice || 0),
        dividendYr: Number(form.dividendYr || 0), dcaMonth: Number(form.dcaMonth || 0), targetPct: Number(form.targetPct || 0),
        asOfDate: form.asOfDate,
      });
    } else if (type === "realEstate") {
      if (!form.name || !form.currentValue) return;
      onSave(keys[type], {
        name: form.name, subCategory: form.subCategory, purchasePrice: Number(form.purchasePrice || 0),
        currentValue: Number(form.currentValue), rentalIncomeYr: Number(form.rentalIncomeYr || 0),
        asOfDate: form.asOfDate, ...estateFields(form),
      });
    } else if (type === "preciousMetal") {
      if (!form.name || !form.qty) return;
      onSave(keys[type], {
        name: form.name, subCategory: form.subCategory, qty: Number(form.qty),
        avgCost: Number(form.avgCost || 0), marketPrice: Number(form.marketPrice || form.avgCost || 0),
        asOfDate: form.asOfDate, ...estateFields(form),
      });
    } else if (type === "businessEquity") {
      if (!form.name || !form.currentValue) return;
      onSave(keys[type], {
        name: form.name, subCategory: form.subCategory, ownershipPct: Number(form.ownershipPct || 0),
        avgCost: Number(form.avgCost || 0), currentValue: Number(form.currentValue), dividendYr: Number(form.dividendYr || 0),
        asOfDate: form.asOfDate, ...estateFields(form),
      });
    } else if (type === "transaction") {
      if (!form.amount || !form.category) return;
      if (form.frequency === "once" || !form.frequency) {
        const item = { ...form, amount: Number(form.amount) };
        delete item.occurrences;
        onSave(keys[type], item);
      } else {
        const intervalMonths = form.frequency === "monthly" ? 1 : form.frequency === "quarterly" ? 3 : 12;
        const count = Math.min(Math.max(Number(form.occurrences) || 1, 1), 60);
        const recurringId = uid();
        const items = [];
        for (let i = 0; i < count; i++) {
          const occDate = addMonthsToDate(form.date, i * intervalMonths);
          const item = { ...form, amount: Number(form.amount), date: occDate.toISOString().slice(0, 10), recurringId };
          delete item.occurrences;
          items.push(item);
        }
        onSave(keys[type], items);
      }
    } else if (type === "policy") {
      if (!form.owner || !form.policyName) return;
      onSave(keys[type], {
        owner: form.owner,
        company: form.company,
        policyName: form.policyName,
        type: form.type_,
        policyNumber: form.policyNumber,
        startDate: form.startDate,
        maturityDate: form.maturityDate,
        sumAssured: Number(form.sumAssured || 0),
        cashSurrenderValue: Number(form.cashSurrenderValue || 0),
        paymentMonth: form.paymentMonth,
        premium: Number(form.premium || 0),
        beneficiary: form.beneficiary,
        status: form.status,
      });
    } else if (type === "bill") {
      if (!form.name || !form.amount) return;
      onSave(keys[type], { name: form.name, category: form.category, amount: Number(form.amount), month: form.month, dueDay: form.dueDay ? Number(form.dueDay) : null });
    } else if (type === "coverageTarget") {
      if (!form.label || !form.target) return;
      onSave(keys[type], { label: form.label, current: Number(form.current || 0), target: Number(form.target), unit: form.unit });
    } else if (type === "note") {
      if (!form.title || !form.detail) return;
      onSave(keys[type], { title: form.title, detail: form.detail, icon: form.icon });
    } else if (type === "familyMember") {
      if (!form.fullNameTh && !form.fullNameEn && !form.nickname) return;
      onSave(keys[type], {
        fullNameTh: form.fullNameTh,
        fullNameEn: form.fullNameEn,
        nickname: form.nickname,
        relationship: form.relationship,
        familyRole: form.familyRole,
        gender: form.gender,
        generation: form.generation,
        maritalStatus: form.maritalStatus,
        idNumber: form.idNumber,
        birthDate: form.birthDate,
        birthDateCalendar: form.birthDateCalendar,
        bloodType: form.bloodType,
        medicalConditions: form.medicalConditions,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        notes: form.notes,
        isAssetHolder: false,
      });
    } else if (type === "estateHeir") {
      if (!form.memberId && !form.assetDescription) return;
      onSave(keys[type], { memberId: form.memberId, assetDescription: form.assetDescription, notes: form.notes });
    } else if (type === "estateSuccession") {
      if (!form.businessName) return;
      onSave(keys[type], {
        businessName: form.businessName,
        successor: form.successor,
        hasBuySellAgreement: form.hasBuySellAgreement,
        valuationMethod: form.valuationMethod,
        keyPersonInsurance: form.keyPersonInsurance,
      });
    } else if (type === "netWorthSnapshot") {
      if (!form.year) return;
      onSave(keys[type], {
        year: Number(form.year),
        totalAssets: Number(form.totalAssets || 0),
        totalLiabilities: Number(form.totalLiabilities || 0),
      });
    } else if (type === "offshoreLot") {
      if (!form.units || !form.pricePerUnit) return;
      onAddLot(modal.stockId, {
        date: form.date,
        units: Number(form.units),
        pricePerUnit: Number(form.pricePerUnit),
        currency: form.currency,
      });
    } else if (type === "offshoreSell") {
      if (!form.units || !form.pricePerUnit) return;
      onSellFIFO(modal.stockId, {
        date: form.date,
        units: Number(form.units),
        pricePerUnit: Number(form.pricePerUnit),
        currency: form.currency,
      });
    } else if (type === "offshoreManualSale") {
      if (!form.stockId || !form.units || !form.salePricePerUnit) return;
      onAddManualSale(form.stockId, {
        date: form.date,
        units: Number(form.units),
        salePricePerUnit: Number(form.salePricePerUnit),
        costPerUnit: Number(form.costPerUnit || 0),
      });
    } else if (type === "fxRemittance") {
      if (!form.amount) return;
      onSave(keys[type], {
        date: form.date,
        direction: form.direction,
        amount: Number(form.amount),
        currency: form.currency,
        purpose: form.purpose,
        note: form.note,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "#00000099" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div style={{ fontFamily: "Fraunces", fontSize: "1.2rem" }}>{titles[type]}</div>
            <button onClick={onClose}><X size={18} color="#8A93A0" /></button>
          </div>

          <div className="flex flex-col gap-3">
            {type === "asset" && (
              <>
                <InputField label="ชื่อรายการ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น บัญชีออมทรัพย์" />
                <SelectField
                  label="หมวดหมู่"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  options={["เงินสด", "การลงทุน", "ธุรกิจ", "อสังหาริมทรัพย์", "ยานพาหนะ", "คริปโต", "อื่นๆ"]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="มูลค่า (บาท)" type="number" value={form.value} onChange={(e) => set("value", e.target.value)} placeholder="0" />
                  <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
                </div>
                <EstateDetailFieldsBlock form={form} set={set} familyMembers={familyMembers} />
              </>
            )}
            {type === "liability" && (
              <>
                <div style={{ fontSize: "11.5px", color: "#8A93A0", marginBottom: 2 }}>ทุกช่องแก้ไขภายหลังได้ ใส่เท่าที่รู้ก่อน</div>
                <InputField label="ชื่อหนี้ *" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น สินเชื่อบ้าน SCB" />
                <SelectField
                  label="ประเภท"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  options={["บ้าน", "รถ", "บัตรเครดิต", "ธุรกิจ", "ส่วนบุคคล", "กยศ.", "อื่นๆ"]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="เจ้าหนี้" value={form.lender} onChange={(e) => set("lender", e.target.value)} placeholder="เช่น ธนาคารกสิกรไทย" />
                  <InputField label="ผู้กู้" value={form.borrower} onChange={(e) => set("borrower", e.target.value)} placeholder="เช่น ตัวเอง, คลินิก" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="เงินต้นเริ่มต้น (฿)" type="number" value={form.originalAmount} onChange={(e) => set("originalAmount", e.target.value)} placeholder="ไม่บังคับ" />
                  <InputField label="เงินต้นคงเหลือ (฿)" type="number" value={form.currentBalance} onChange={(e) => set("currentBalance", e.target.value)} placeholder="" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ดอกเบี้ย" value={form.interestRate} onChange={(e) => set("interestRate", e.target.value)} placeholder="เช่น MRR-1.5% หรือ 3.15" />
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    รูปแบบดอกเบี้ย
                    <select
                      value={form.interestType}
                      onChange={(e) => set("interestType", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="reducing">ลดต้นลดดอก</option>
                      <option value="flat">คงที่</option>
                    </select>
                  </label>
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -8 }}>
                  {form.interestType === "flat" ? "คงที่ (Flat Rate) — ดอกเบี้ยคิดจากเงินต้นเริ่มต้นตลอดสัญญา" : "ลดต้นลดดอก (Reducing Balance) — ดอกเบี้ยคิดจากยอดคงเหลือแต่ละงวด"}
                </div>
                <InputField label="ผ่อนต่อเดือน (฿)" type="number" value={form.monthlyPayment} onChange={(e) => set("monthlyPayment", e.target.value)} placeholder="" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="วันที่เริ่มกู้" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
                  <InputField label="วันที่ครบกำหนด" type="date" value={form.maturityDate} onChange={(e) => set("maturityDate", e.target.value)} />
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -8 }}>ถ้าไม่ทราบวันที่ครบกำหนด ระบบจะประมาณให้จากยอดผ่อนต่อเดือนโดยอัตโนมัติ</div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="มีหลักประกันหรือไม่?"
                    value={form.hasCollateral}
                    onChange={(e) => set("hasCollateral", e.target.value)}
                    options={["", "มี", "ไม่มี"]}
                  />
                  <InputField label="สินทรัพย์ค้ำประกัน" value={form.collateralAsset} onChange={(e) => set("collateralAsset", e.target.value)} placeholder="เช่น บ้าน, ที่ดิน" />
                </div>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  มีประกันคุ้มครองหนี้ (MRTA)?
                  <select
                    value={form.mrtaInsurance}
                    onChange={(e) => set("mrtaInsurance", e.target.value)}
                    className="px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    <option value="">— เลือก · select —</option>
                    <option value="มี">✓ มี — หนี้หายถ้าผู้กู้เสียชีวิต</option>
                    <option value="ไม่มี">✗ ไม่มี — ทายาทต้องรับภาระ</option>
                    <option value="ไม่แน่ใจ">? ไม่แน่ใจ</option>
                  </select>
                </label>
                <SelectField label="สถานะ" value={form.status} onChange={(e) => set("status", e.target.value)} options={["Active", "Paid", "Closed"]} />
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  บันทึก
                  <textarea
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    className="px-3 py-2 rounded-lg outline-none text-sm resize-y"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  />
                </label>
              </>
            )}
            {type === "cashAccount" && (
              <>
                <InputField label="ชื่อบัญชี" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น KBANK, TTB" />
                <InputField label="ประเภท" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)} placeholder="เช่น Cash, Savings" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="จำนวน" type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" />
                  <SelectField label="สกุลเงิน" value={form.currency} onChange={(e) => set("currency", e.target.value)} options={["THB", "USD", "JPY", "EUR", "อื่นๆ"]} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="อัตราแลกเปลี่ยน → THB" type="number" value={form.fxToThb} onChange={(e) => set("fxToThb", e.target.value)} placeholder="1" />
                  <InputField label="Yield % ต่อปี" type="number" value={form.yieldPct} onChange={(e) => set("yieldPct", e.target.value)} placeholder="0" />
                </div>
                <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
              </>
            )}
            {(type === "domesticFund" || type === "offshoreStock") && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ชื่อ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น Vanguard S&P 500" />
                  <InputField label="สัญลักษณ์" value={form.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="เช่น VOO" />
                </div>
                <InputField label="ประเภทย่อย" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)} placeholder="เช่น Stocks, Retirement Funds" />
                <InputField label="Broker / ผู้ดูแลบัญชี" value={form.broker} onChange={(e) => set("broker", e.target.value)} placeholder="เช่น Interactive Brokers, บลจ.กสิกรไทย" list="broker-suggestions-list" />
                <InputField label="จำนวนหน่วย" type="number" value={form.units} onChange={(e) => set("units", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ต้นทุนเฉลี่ย/หน่วย" type="number" value={form.avgPrice} onChange={(e) => set("avgPrice", e.target.value)} placeholder="0" />
                  <InputField label="ราคาปัจจุบัน/หน่วย" type="number" value={form.currentPrice} onChange={(e) => set("currentPrice", e.target.value)} placeholder="0" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="เป้าหมายสัดส่วน %" type="number" value={form.targetPct} onChange={(e) => set("targetPct", e.target.value)} placeholder="0" />
                  <InputField label="DCA ต่อเดือน (บาท)" type="number" value={form.dcaMonth} onChange={(e) => set("dcaMonth", e.target.value)} placeholder="0" />
                </div>
                <InputField label="เงินปันผล/ปี" type="number" value={form.dividendYr} onChange={(e) => set("dividendYr", e.target.value)} placeholder="ไม่บังคับ" />
                <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
              </>
            )}
            {type === "realEstate" && (
              <>
                <InputField label="ชื่อ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น บ้าน, ที่ดิน" />
                <InputField label="ประเภท" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)} placeholder="เช่น Residential, Land" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ราคาซื้อ (บาท)" type="number" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} placeholder="0" />
                  <InputField label="มูลค่าปัจจุบัน (บาท)" type="number" value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} placeholder="0" />
                </div>
                <InputField label="รายได้ค่าเช่า/ปี" type="number" value={form.rentalIncomeYr} onChange={(e) => set("rentalIncomeYr", e.target.value)} placeholder="ไม่บังคับ" />
                <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
                <EstateDetailFieldsBlock form={form} set={set} familyMembers={familyMembers} />
              </>
            )}
            {type === "preciousMetal" && (
              <>
                <InputField label="ชื่อ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น ทองคำ" />
                <InputField label="ประเภท" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)} placeholder="เช่น Gold, Silver" />
                <InputField label="จำนวน (บาททอง/ออนซ์)" type="number" value={form.qty} onChange={(e) => set("qty", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ต้นทุนเฉลี่ย/หน่วย" type="number" value={form.avgCost} onChange={(e) => set("avgCost", e.target.value)} placeholder="0" />
                  <InputField label="ราคาตลาดปัจจุบัน/หน่วย" type="number" value={form.marketPrice} onChange={(e) => set("marketPrice", e.target.value)} placeholder="0" />
                </div>
                <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
                <EstateDetailFieldsBlock form={form} set={set} familyMembers={familyMembers} />
              </>
            )}
            {type === "businessEquity" && (
              <>
                <InputField label="ชื่อธุรกิจ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น Wellvera" />
                <InputField label="ประเภท" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)} placeholder="เช่น Startup Shares" />
                <InputField label="สัดส่วนถือหุ้น %" type="number" value={form.ownershipPct} onChange={(e) => set("ownershipPct", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ต้นทุน (บาท)" type="number" value={form.avgCost} onChange={(e) => set("avgCost", e.target.value)} placeholder="0" />
                  <InputField label="มูลค่าปัจจุบัน (บาท)" type="number" value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} placeholder="0" />
                </div>
                <InputField label="เงินปันผล/ปี" type="number" value={form.dividendYr} onChange={(e) => set("dividendYr", e.target.value)} placeholder="ไม่บังคับ" />
                <InputField label="ณ วันที่" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} />
                <EstateDetailFieldsBlock form={form} set={set} familyMembers={familyMembers} />
              </>
            )}
            {type === "transaction" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="วันที่" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                  <SelectField
                    label="ประเภท"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, flowCategory: "" }))}
                    options={["รายรับ", "รายจ่าย", "เงินออม"]}
                  />
                </div>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  หมวดกระแสเงินสด (สำหรับสรุปในแท็บกระแสเงินสด)
                  <select
                    value={form.flowCategory}
                    onChange={(e) => set("flowCategory", e.target.value)}
                    className="px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    <option value="">— เลือก —</option>
                    {(form.type === "รายรับ" ? CASHIN_CATEGORIES : CASHOUT_CATEGORIES).map((c) => (
                      <option key={c.key} value={c.key}>{c.emoji} {c.key}</option>
                    ))}
                  </select>
                </label>
                <InputField label="หมวดหมู่ (ชื่อรายการ)" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="เช่น รายได้คลินิก, ค่าใช้จ่ายบ้าน" />
                <InputField label="จำนวนเงิน (บาท)" type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    ความถี่ (สำหรับรายการประจำ)
                    <select
                      value={form.frequency}
                      onChange={(e) => set("frequency", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="once">ครั้งเดียว</option>
                      <option value="monthly">🔁 ทุกเดือน</option>
                      <option value="quarterly">🔁 ทุก 3 เดือน</option>
                      <option value="yearly">🔁 ทุกปี</option>
                    </select>
                  </label>
                  {form.frequency !== "once" && (
                    <InputField
                      label="สร้างล่วงหน้ากี่ครั้ง"
                      type="number"
                      value={form.occurrences}
                      onChange={(e) => set("occurrences", e.target.value)}
                      placeholder="เช่น 12"
                    />
                  )}
                </div>
                {form.frequency !== "once" && (
                  <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -8 }}>
                    ระบบจะสร้างธุรกรรมล่วงหน้าให้ {Math.min(Math.max(Number(form.occurrences) || 1, 1), 60)} ครั้ง เริ่มจากวันที่ที่เลือก ไม่ต้องกรอกซ้ำทุกเดือน
                  </div>
                )}
                {familyMembers && familyMembers.length > 0 && (
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    สมาชิก (ไม่บังคับ)
                    <select
                      value={form.memberId}
                      onChange={(e) => set("memberId", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="">— ไม่ระบุ —</option>
                      {familyMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.nickname || m.fullNameTh || "ไม่ระบุชื่อ"}</option>
                      ))}
                    </select>
                  </label>
                )}
                <InputField label="หมายเหตุ" value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="ไม่บังคับ" />
              </>
            )}
            {type === "policy" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="เจ้าของกรมธรรม์" value={form.owner} onChange={(e) => set("owner", e.target.value)} placeholder="เช่น นิว (New)" />
                  <InputField label="บริษัทประกัน" value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="เช่น AIA, TLI" />
                </div>
                <InputField label="ชื่อกรมธรรม์" value={form.policyName} onChange={(e) => set("policyName", e.target.value)} placeholder="เช่น AIA easy 10/10" />
                <SelectField
                  label="ประเภท"
                  value={form.type_}
                  onChange={(e) => set("type_", e.target.value)}
                  options={["ประกันชีวิต", "Term Life", "ประกันบำนาญ", "ประกันสะสมทรัพย์", "ประกันสุขภาพ IPD", "โรคร้ายแรง", "อุบัติเหตุ", "อื่นๆ"]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="วันเริ่มต้น" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
                  <InputField label="วันครบกำหนด" type="date" value={form.maturityDate} onChange={(e) => set("maturityDate", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ทุนประกัน (บาท)" type="number" value={form.sumAssured} onChange={(e) => set("sumAssured", e.target.value)} placeholder="0" />
                  <InputField label="เบี้ยประกัน/ปี (บาท)" type="number" value={form.premium} onChange={(e) => set("premium", e.target.value)} placeholder="0" />
                </div>
                <InputField
                  label="มูลค่าเวนคืนปัจจุบัน (บาท)"
                  type="number"
                  value={form.cashSurrenderValue}
                  onChange={(e) => set("cashSurrenderValue", e.target.value)}
                  placeholder="0 — เฉพาะแบบสะสมทรัพย์/บำนาญ/Unit Link ที่มีมูลค่าคืน"
                />
                <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -8 }}>
                  Term Life / ประกันสุขภาพ / โรคร้ายแรง ปกติไม่มีมูลค่าคืน ใส่ 0 หรือเว้นว่างได้ · ยอดนี้จะถูกนับรวมเข้า Net Worth
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="เดือนที่ชำระ"
                    value={form.paymentMonth}
                    onChange={(e) => set("paymentMonth", e.target.value)}
                    options={["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Monthly"]}
                  />
                  <SelectField label="สถานะ" value={form.status} onChange={(e) => set("status", e.target.value)} options={["Active", "Pending", "ปิดวงเงินสำเร็จ", "หมดอายุ"]} />
                </div>
                <InputField label="ผู้รับผลประโยชน์" value={form.beneficiary} onChange={(e) => set("beneficiary", e.target.value)} placeholder="ไม่บังคับ" />
              </>
            )}
            {type === "bill" && (
              <>
                <InputField label="ชื่อรายการ" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น ค่าน้ำค่าไฟ, ค่าเทอมลูก" />
                <SelectField
                  label="หมวดหมู่"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  options={["สาธารณูปโภค", "การศึกษา", "ประกัน", "ผ่อนหนี้", "อื่นๆ"]}
                />
                <InputField label="จำนวนเงิน (บาท)" type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="ความถี่ / เดือนที่จ่าย"
                    value={form.month}
                    onChange={(e) => set("month", e.target.value)}
                    options={["Monthly", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]}
                  />
                  <InputField label="วันที่ต้องจ่าย (1-31)" type="number" value={form.dueDay} onChange={(e) => set("dueDay", e.target.value)} placeholder="เช่น 5" />
                </div>
              </>
            )}
            {type === "coverageTarget" && (
              <>
                <InputField label="รายการความคุ้มครอง" value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="เช่น ความคุ้มครองอุบัติเหตุกลุ่ม" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ปัจจุบัน" type="number" value={form.current} onChange={(e) => set("current", e.target.value)} placeholder="0" />
                  <InputField label="เป้าหมาย" type="number" value={form.target} onChange={(e) => set("target", e.target.value)} placeholder="0" />
                </div>
                <InputField label="หน่วย" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="เช่น บาท, บาท/วัน" />
              </>
            )}
            {type === "note" && (
              <>
                <InputField label="หัวข้อ" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="เช่น Home Insurance" />
                <InputField label="รายละเอียด" value={form.detail} onChange={(e) => set("detail", e.target.value)} placeholder="เช่น วงเงิน / 2 — คุ้มครอง นิว และ ฝ้าย" />
                <SelectField
                  label="ไอคอน"
                  value={form.icon}
                  onChange={(e) => set("icon", e.target.value)}
                  options={["claim", "home", "clinic", "coop", "estimate"]}
                />
              </>
            )}
            {type === "familyMember" && (
              <>
                <div style={{ fontSize: "11.5px", color: "#8A93A0", marginBottom: 2 }}>ทุกช่องแก้ไขภายหลังได้ ไม่ต้องกรอกละเอียดตั้งแต่แรก</div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ชื่อ-นามสกุล (ไทย)" value={form.fullNameTh} onChange={(e) => set("fullNameTh", e.target.value)} placeholder="ไม่บังคับ" />
                  <InputField label="ชื่อ-นามสกุล (อังกฤษ)" value={form.fullNameEn} onChange={(e) => set("fullNameEn", e.target.value)} placeholder="ไม่บังคับ" />
                </div>
                <InputField label="ชื่อเล่น" value={form.nickname} onChange={(e) => set("nickname", e.target.value)} placeholder="เช่น นิว" />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="ความสัมพันธ์"
                    value={form.relationship}
                    onChange={(e) => set("relationship", e.target.value)}
                    options={["", ...RELATIONSHIP_OPTIONS]}
                  />
                  <SelectField
                    label="เพศ"
                    value={form.gender}
                    onChange={(e) => set("gender", e.target.value)}
                    options={["", ...GENDER_OPTIONS]}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs mb-1.5" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    บทบาทในครอบครัว
                    <span title="Family Role บอกว่าใครมีสิทธิ์ทำอะไรกับข้อมูลนี้ — เช่น ใครดูแลจัดการภาพรวม ใครตัดสินใจเรื่องเงิน ใครแค่ดูอย่างเดียว" style={{ cursor: "help", color: "#C9A227" }}>
                      [นี่คืออะไร?]
                    </span>
                  </div>
                  <select
                    value={form.familyRole}
                    onChange={(e) => set("familyRole", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    {Object.entries(FAMILY_ROLES).map(([key, r]) => (
                      <option key={key} value={key}>{r.emoji} {r.label} — {r.sublabel}</option>
                    ))}
                  </select>
                </div>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  Generation Index (รุ่น)
                  <select
                    value={form.generation}
                    onChange={(e) => set("generation", e.target.value)}
                    className="px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    {Object.entries(GENERATIONS).map(([key, g]) => (
                      <option key={key} value={key}>{g.label}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                  <InputField
                    label="วันเดือนปีเกิด"
                    value={form.birthDate}
                    onChange={(e) => set("birthDate", e.target.value)}
                    placeholder="เช่น 15/03/2533 — ใช้คำนวณอายุอัตโนมัติ"
                  />
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    ปฏิทิน
                    <select
                      value={form.birthDateCalendar}
                      onChange={(e) => set("birthDateCalendar", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="ad">ค.ศ.</option>
                      <option value="be">พ.ศ.</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="เลขบัตร ปชช. / Passport" value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} placeholder="ไม่บังคับ" />
                  <SelectField
                    label="สถานภาพสมรส"
                    value={form.maritalStatus}
                    onChange={(e) => set("maritalStatus", e.target.value)}
                    options={["", ...MARITAL_STATUS_OPTIONS]}
                  />
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -8 }}>สถานภาพสมรสมีผลต่อกฎหมายสินสมรส/สินส่วนตัว</div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="กรุ๊ปเลือด" value={form.bloodType} onChange={(e) => set("bloodType", e.target.value)} placeholder="ไม่บังคับ" />
                  <InputField label="โรคประจำตัว/ยา/แพ้ยา" value={form.medicalConditions} onChange={(e) => set("medicalConditions", e.target.value)} placeholder="ไม่บังคับ" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ผู้ติดต่อฉุกเฉิน" value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="แจ้งใคร" />
                  <InputField label="เบอร์โทรผู้ติดต่อฉุกเฉิน" value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="ไม่บังคับ" />
                </div>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  บันทึกเพิ่มเติม
                  <textarea
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    className="px-3 py-2 rounded-lg outline-none text-sm resize-y"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  />
                </label>
              </>
            )}
            {type === "estateHeir" && (
              <>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  ทายาท
                  <select
                    value={form.memberId}
                    onChange={(e) => set("memberId", e.target.value)}
                    className="px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    <option value="">— เลือกทายาท —</option>
                    {familyMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.nickname || m.fullNameTh || "ไม่ระบุชื่อ"}</option>
                    ))}
                  </select>
                </label>
                <InputField label="ทรัพย์สินที่จะยกให้" value={form.assetDescription} onChange={(e) => set("assetDescription", e.target.value)} placeholder="เช่น บ้าน, หุ้นคลินิก 20%" />
                <InputField label="บันทึกเพิ่มเติม" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="ไม่บังคับ" />
              </>
            )}
            {type === "estateSuccession" && (
              <>
                <InputField label="ชื่อธุรกิจ" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="เช่น คลินิกแพทย์ศิริพงษ์" />
                <InputField label="ผู้รับช่วงต่อ" value={form.successor} onChange={(e) => set("successor", e.target.value)} placeholder="ไม่บังคับ" />
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    สัญญา Buy-Sell
                    <select
                      value={form.hasBuySellAgreement}
                      onChange={(e) => set("hasBuySellAgreement", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="">— เลือก —</option>
                      <option value="มี">มี</option>
                      <option value="ไม่มี">ไม่มี</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    Key-person Insurance
                    <select
                      value={form.keyPersonInsurance}
                      onChange={(e) => set("keyPersonInsurance", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="">— เลือก —</option>
                      <option value="มี">มี</option>
                      <option value="ไม่มี">ไม่มี</option>
                    </select>
                  </label>
                </div>
                <InputField label="วิธีประเมินมูลค่าธุรกิจ" value={form.valuationMethod} onChange={(e) => set("valuationMethod", e.target.value)} placeholder="ไม่บังคับ" />
              </>
            )}
            {type === "netWorthSnapshot" && (
              <>
                <InputField label="ปี (พ.ศ.)" type="number" value={form.year} onChange={(e) => set("year", e.target.value)} placeholder="เช่น 2569" />
                <InputField label="สินทรัพย์รวมปีนั้น (บาท)" type="number" value={form.totalAssets} onChange={(e) => set("totalAssets", e.target.value)} placeholder="0" />
                <InputField label="หนี้สินรวมปีนั้น (บาท)" type="number" value={form.totalLiabilities} onChange={(e) => set("totalLiabilities", e.target.value)} placeholder="0" />
                <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>Net Worth และ % การเติบโตจะคำนวณให้อัตโนมัติ</div>
              </>
            )}
            {type === "offshoreLot" && (
              <>
                <div style={{ fontSize: "12.5px", color: "#EAE7E0" }}>หุ้น/กองทุน: <b>{modal.stockName}</b></div>
                <InputField label="วันที่ซื้อ" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="จำนวนหน่วย" type="number" value={form.units} onChange={(e) => set("units", e.target.value)} placeholder="0" />
                  <InputField label="ราคา/หน่วย" type="number" value={form.pricePerUnit} onChange={(e) => set("pricePerUnit", e.target.value)} placeholder="0" />
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>
                  ล็อตนี้จะถูกใช้คำนวณต้นทุนเฉลี่ยและ FIFO ตอนขายในอนาคต — ถ้าหุ้นตัวนี้มียอดถืออยู่เดิม (ยังไม่เคยเพิ่มล็อตมาก่อน) ระบบจะรวมยอดเดิมเป็น "ล็อตแรก" ให้อัตโนมัติ ไม่หายไปไหน
                </div>
              </>
            )}
            {type === "offshoreSell" && (
              <>
                <div style={{ fontSize: "12.5px", color: "#EAE7E0" }}>หุ้น/กองทุน: <b>{modal.stockName}</b></div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0", marginTop: -6 }}>ถืออยู่ {(modal.availableUnits || 0).toLocaleString()} หน่วย</div>
                <InputField label="วันที่ขาย" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="จำนวนที่ขาย" type="number" value={form.units} onChange={(e) => set("units", e.target.value)} placeholder="0" />
                  <InputField label="ราคาขาย/หน่วย" type="number" value={form.pricePerUnit} onChange={(e) => set("pricePerUnit", e.target.value)} placeholder="0" />
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>ระบบจะตัดล็อตเก่าสุดก่อน (FIFO) และคำนวณกำไร/ขาดทุนที่เกิดขึ้นจริงให้อัตโนมัติ</div>
              </>
            )}
            {type === "offshoreManualSale" && (
              <>
                <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                  หุ้น/กองทุน
                  <select
                    value={form.stockId}
                    onChange={(e) => set("stockId", e.target.value)}
                    className="px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                  >
                    <option value="">— เลือก —</option>
                    {(offshoreStocks || []).map((st) => (
                      <option key={st.id} value={st.id}>{st.name} ({st.symbol})</option>
                    ))}
                  </select>
                </label>
                <InputField label="วันที่ขาย" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                <InputField label="จำนวนที่ขาย" type="number" value={form.units} onChange={(e) => set("units", e.target.value)} placeholder="0" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="ต้นทุน/หน่วย ตอนซื้อ" type="number" value={form.costPerUnit} onChange={(e) => set("costPerUnit", e.target.value)} placeholder="0" />
                  <InputField label="ราคาขาย/หน่วย" type="number" value={form.salePricePerUnit} onChange={(e) => set("salePricePerUnit", e.target.value)} placeholder="0" />
                </div>
                <div style={{ fontSize: "10.5px", color: "#8A93A0" }}>
                  ใช้สำหรับกรอกรายการขายเอง (เช่น รายการเก่าก่อนเริ่มใช้ระบบล็อต) — กำไร/ขาดทุนคำนวณจากตัวเลขที่กรอกตรงๆ ไม่ตัดล็อต
                </div>
              </>
            )}
            {type === "fxRemittance" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="วันที่" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                  <label className="flex flex-col gap-1.5 text-xs" style={{ color: "#8A93A0", fontFamily: "Inter" }}>
                    ทิศทาง
                    <select
                      value={form.direction}
                      onChange={(e) => set("direction", e.target.value)}
                      className="px-3 py-2 rounded-lg outline-none text-sm"
                      style={{ background: "#101820", border: "1px solid #2A3949", color: "#EAE7E0", fontFamily: "Inter" }}
                    >
                      <option value="in">🔽 โอนเข้าไทย</option>
                      <option value="out">🔼 โอนออกไปต่างประเทศ</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="จำนวนเงิน" type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" />
                  <InputField label="สกุลเงิน" value={form.currency} onChange={(e) => set("currency", e.target.value)} placeholder="USD" />
                </div>
                <InputField label="วัตถุประสงค์" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="เช่น โอนกำไรจากการขายหุ้นกลับไทย" />
                <InputField label="บันทึกเพิ่มเติม" value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="ไม่บังคับ" />
              </>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm" style={{ border: "1px solid #2A3949", color: "#8A93A0" }}>
              ยกเลิก
            </button>
            <button onClick={submit} className="flex-1 py-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5" style={{ background: "#C9A227", color: "#101820", fontWeight: 600 }}>
              บันทึก <ChevronRight size={14} />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

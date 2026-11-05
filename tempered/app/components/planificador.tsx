"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { CalendarDays, Check, CircleDollarSign, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import {
  getBalanceTransactions,
  getOutstandingDebt,
  getPaidAmount,
  type Currency,
  type Debt,
  type DebtType,
} from "@/lib/debt-payments";
import {
  executePlannedIncome,
  PLANNER_CATEGORIES,
  readPlannedAssignments,
  removePlannedIncome,
  savePlannedIncome,
  type PlannedAssignment,
  type PlannedIncome,
  type PlannedIncomeInput,
  type PlannedExpenseAssignment,
} from "@/lib/planner";
import {
  assessNextPlannedIncome,
  DEFAULT_PLANNER_ALERT_THRESHOLDS,
  type PlannerAlertThresholds,
} from "@/lib/planner-health";
import { useSession } from "./session-context";
import { localDateString } from "./task-data";
import BackButton from "./back-button";
import PlannerHealthBanner from "./planner-health-banner";
import PlannerAlertSettings from "./planner-alert-settings";
import { usePlannerAlertThresholds } from "./use-planner-alert-thresholds";

function money(amount: number, currency: Currency) {
  return `${currency} ${amount.toFixed(2)}`;
}

function getCommitmentHealth(percentage: number, thresholds: PlannerAlertThresholds) {
  if (percentage >= thresholds.critical) {
    return {
      label: "Crítico",
      bar: "bg-red-400",
      text: "text-red-200",
      panel: "border-red-300/40 bg-red-950/40 text-red-100",
      message: "⚠️ Ingreso altamente comprometido. Evita sumar nuevas deudas.",
    };
  }
  if (percentage >= thresholds.danger) {
    return {
      label: "Peligro",
      bar: "bg-orange-400",
      text: "text-orange-200",
      panel: "border-orange-300/40 bg-orange-950/40 text-orange-100",
      message: "Tu margen de maniobra está en riesgo. Pausa nuevos compromisos y revisa tus pagos.",
    };
  }
  if (percentage >= thresholds.caution) {
    return {
      label: "Precaución",
      bar: "bg-amber-300",
      text: "text-amber-200",
      panel: "border-amber-300/40 bg-amber-950/35 text-amber-100",
      message: "Tu margen disponible es reducido; revisa nuevos compromisos con cuidado.",
    };
  }
  return {
    label: "Saludable",
    bar: "bg-emerald-400",
    text: "text-emerald-200",
    panel: "border-emerald-300/35 bg-emerald-950/30 text-emerald-100",
    message: "Mantienes un margen de maniobra saludable.",
  };
}

function readDebt(id: string, userId: string, data: Record<string, unknown>): Debt | null {
  const amount = Number(data.amount);
  if (
    typeof data.title !== "string"
    || (data.type !== "payable" && data.type !== "receivable")
    || !Number.isFinite(amount)
    || (data.currency !== "Bs" && data.currency !== "$")
    || typeof data.dueDate !== "string"
  ) {
    return null;
  }
  const paidAmount = getPaidAmount(data, amount);
  return {
    id,
    userId,
    title: data.title,
    type: data.type,
    amount,
    currency: data.currency,
    dueDate: data.dueDate,
    paid: data.paid === true || paidAmount >= amount - 0.005,
    paidAmount,
    balanceTransactions: getBalanceTransactions(data),
  };
}

function readIncome(id: string, userId: string, data: Record<string, unknown>): PlannedIncome | null {
  const assignments = readPlannedAssignments(data);
  if (
    data.userId !== userId
    || typeof data.title !== "string"
    || typeof data.amount !== "number"
    || !Number.isFinite(data.amount)
    || (data.currency !== "Bs" && data.currency !== "$")
    || typeof data.estimatedDate !== "string"
    || (data.status !== "pendiente" && data.status !== "ejecutado")
    || !assignments
  ) {
    return null;
  }
  return {
    id,
    userId,
    title: data.title,
    amount: data.amount,
    currency: data.currency,
    estimatedDate: data.estimatedDate,
    status: data.status,
    assignments,
  };
}

export default function Planificador() {
  const { userId } = useSession();
  const [incomes, setIncomes] = useState<PlannedIncome[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [incomeOwnerId, setIncomeOwnerId] = useState<string | null>(null);
  const [debtOwnerId, setDebtOwnerId] = useState<string | null>(null);
  const [incomesLoading, setIncomesLoading] = useState(true);
  const [debtsLoading, setDebtsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("Bs");
  const [debtFilter, setDebtFilter] = useState<DebtType>("payable");
  const [estimatedDate, setEstimatedDate] = useState(localDateString());
  const [assignments, setAssignments] = useState<PlannedAssignment[]>([]);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>(PLANNER_CATEGORIES.Bs[0]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [today, setToday] = useState(localDateString());
  const alertThresholds = usePlannerAlertThresholds(userId);

  useEffect(() => {
    if (!userId) return;

    const ownerId = userId;
    const stopIncomes = onSnapshot(
      query(collection(db, "plannedIncomes"), where("userId", "==", ownerId)),
      (snapshot) => {
        const nextIncomes = snapshot.docs.map((item) => readIncome(item.id, ownerId, item.data()));
        if (nextIncomes.some((income) => income === null)) {
          setError("Hay un ingreso proyectado con datos incompletos; revisa sus datos en Firestore.");
        }
        setIncomes(nextIncomes.filter((income): income is PlannedIncome => income !== null));
        setIncomeOwnerId(ownerId);
        setIncomesLoading(false);
      },
      () => {
        setError("No se pudieron cargar los ingresos proyectados.");
        setIncomeOwnerId(ownerId);
        setIncomesLoading(false);
      },
    );
    const stopDebts = onSnapshot(
      query(collection(db, "debts"), where("userId", "==", ownerId)),
      (snapshot) => {
        const nextDebts = snapshot.docs.map((item) => readDebt(item.id, ownerId, item.data()));
        if (nextDebts.some((debt) => debt === null)) {
          setError("Hay una deuda con datos incompletos; no podrá asignarse al plan.");
        }
        setDebts(nextDebts.filter((debt): debt is Debt => debt !== null));
        setDebtOwnerId(ownerId);
        setDebtsLoading(false);
      },
      () => {
        setError("No se pudieron cargar las deudas.");
        setDebtOwnerId(ownerId);
        setDebtsLoading(false);
      },
    );
    return () => {
      stopIncomes();
      stopDebts();
    };
  }, [userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const orderedIncomes = useMemo(
    () => [...incomes].sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate)),
    [incomes],
  );
  const debtsById = useMemo(() => new Map(debts.map((debt) => [debt.id, debt])), [debts]);
  const reservedDebtIds = useMemo(() => new Set(incomes
    .filter((income) => income.status === "pendiente" && income.id !== editingId)
    .flatMap((income) => income.assignments.flatMap((assignment) => assignment.type === "debt" ? [assignment.debtId] : []))), [editingId, incomes]);
  const assignedDebtIds = assignments.flatMap((assignment) => assignment.type === "debt" ? [assignment.debtId] : []);
  const plannedExpenses = assignments.filter(
    (assignment): assignment is PlannedExpenseAssignment => assignment.type === "expense",
  );
  const availableDebts = useMemo(
    () => debts
      .filter((debt) => (
        debt.type === debtFilter
        && debt.currency === currency
        && (!debt.paid || assignedDebtIds.includes(debt.id))
        && (!reservedDebtIds.has(debt.id) || assignedDebtIds.includes(debt.id))
      ))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [assignedDebtIds, currency, debtFilter, debts, reservedDebtIds],
  );
  const payableDebtCount = debts.filter((debt) => debt.type === "payable" && debt.currency === currency && (!debt.paid || assignedDebtIds.includes(debt.id))).length;
  const receivableDebtCount = debts.filter((debt) => debt.type === "receivable" && debt.currency === currency && (!debt.paid || assignedDebtIds.includes(debt.id))).length;

  const resetForm = () => {
    setEditingId("");
    setTitle("");
    setAmount("");
    setCurrency("Bs");
    setDebtFilter("payable");
    setEstimatedDate(localDateString());
    setAssignments([]);
    setExpenseTitle("");
    setExpenseAmount("");
    setExpenseCategory(PLANNER_CATEGORIES.Bs[0]);
    setFormOpen(false);
  };

  const openNewForm = () => {
    resetForm();
    setError("");
    setNotice("");
    setFormOpen(true);
  };

  const editIncome = (income: PlannedIncome) => {
    setEditingId(income.id);
    setTitle(income.title);
    setAmount(String(income.amount));
    setCurrency(income.currency);
    setEstimatedDate(income.estimatedDate);
    setAssignments(income.assignments);
    setExpenseTitle("");
    setExpenseAmount("");
    setExpenseCategory(PLANNER_CATEGORIES[income.currency][0]);
    setError("");
    setNotice("");
    setFormOpen(true);
  };

  const toggleDebt = (debtId: string) => {
    if (assignedDebtIds.includes(debtId)) {
      setAssignments((current) => current.filter((item) => item.type !== "debt" || item.debtId !== debtId));
      setError("");
      return;
    }
    previewAssignment({ type: "debt", debtId });
  };

  const addExpense = () => {
    const numericAmount = Number(expenseAmount);
    if (!expenseTitle.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Indica el concepto del gasto y un monto mayor que cero.");
      return;
    }
    if (!PLANNER_CATEGORIES[currency].includes(expenseCategory)) {
      setError("Selecciona una categoría válida para la moneda del ingreso.");
      return;
    }
    previewAssignment({
      type: "expense",
      title: expenseTitle.trim(),
      category: expenseCategory,
      amount: Math.round(numericAmount * 100) / 100,
      currency,
    });
  };

  const removeExpense = (expenseIndex: number) => {
    setAssignments((current) => {
      let currentIndex = -1;
      return current.filter((item) => {
        if (item.type !== "expense") return true;
        currentIndex += 1;
        return currentIndex !== expenseIndex;
      });
    });
  };

  const formCommitment = assignedDebtIds.reduce((total, debtId) => {
    const debt = debtsById.get(debtId);
    return total + (debt ? getOutstandingDebt(debt) : 0);
  }, plannedExpenses.reduce((total, expense) => total + expense.amount, 0));
  const missingAssignments = assignedDebtIds.filter((debtId) => !debtsById.has(debtId));
  const formIncomeAmount = Number(amount) || 0;
  const effectiveAlertThresholds = userId ? alertThresholds : DEFAULT_PLANNER_ALERT_THRESHOLDS;
  const formCommitmentPercentage = formIncomeAmount > 0
    ? formCommitment / formIncomeAmount * 100
    : formCommitment > 0 ? 100 : 0;
  const formHealth = getCommitmentHealth(formCommitmentPercentage, effectiveAlertThresholds);
  const exceedsCapacity = formCommitment > formIncomeAmount + 0.005;

  const currentMonth = localDateString().slice(0, 7);
  const nextIncomeAssessment = useMemo(() => assessNextPlannedIncome(
    incomes,
    debts,
    today,
    effectiveAlertThresholds,
  ), [debts, effectiveAlertThresholds, incomes, today]);
  const monthlySummary = useMemo(() => {
    const result: Record<Currency, { income: number; committed: number }> = {
      Bs: { income: 0, committed: 0 },
      "$": { income: 0, committed: 0 },
    };
    for (const income of incomes) {
      if (income.estimatedDate.slice(0, 7) !== currentMonth || income.status !== "pendiente") continue;
      const debtCommitment = income.assignments.reduce((total, assignment) => {
        if (assignment.type !== "debt") return total;
        const debt = debtsById.get(assignment.debtId);
        return total + (debt ? getOutstandingDebt(debt) : 0);
      }, 0);
      const expenseCommitment = income.assignments.reduce(
        (total, assignment) => total + (assignment.type === "expense" ? assignment.amount : 0),
        0,
      );
      result[income.currency].income += income.amount;
      result[income.currency].committed += debtCommitment + expenseCommitment;
    }
    return result;
  }, [currentMonth, debtsById, incomes]);

  function previewAssignment(assignment: PlannedAssignment) {
    if (assignment.type === "debt") {
      if (assignedDebtIds.includes(assignment.debtId)) return;
      const debt = debtsById.get(assignment.debtId);
      if (!debt) return;
      const nextCommitted = formCommitment + getOutstandingDebt(debt);
      const nextPercentage = formIncomeAmount > 0 ? nextCommitted / formIncomeAmount * 100 : 100;
      const nextHealth = getCommitmentHealth(nextPercentage, effectiveAlertThresholds);
      setAssignments((current) => [...current, assignment]);
      setNotice("");
      if (nextPercentage >= effectiveAlertThresholds.caution) {
        setError(nextCommitted > formIncomeAmount + 0.005
          ? `Sin respaldo suficiente: esta asignación elevaría el compromiso a ${nextPercentage.toFixed(0)}% y supera el ingreso.`
          : `Alerta ${nextHealth.label.toLowerCase()}: esta asignación elevaría el compromiso a ${nextPercentage.toFixed(0)}% del ingreso.`);
      } else {
        setError("");
      }
      return;
    }

    const nextCommitted = formCommitment + assignment.amount;
    const nextPercentage = formIncomeAmount > 0 ? nextCommitted / formIncomeAmount * 100 : 100;
    const nextHealth = getCommitmentHealth(nextPercentage, effectiveAlertThresholds);
    setAssignments((current) => [...current, assignment]);
    setExpenseTitle("");
    setExpenseAmount("");
    setError(nextPercentage >= effectiveAlertThresholds.caution
      ? nextCommitted > formIncomeAmount + 0.005
        ? `Sin respaldo suficiente: este gasto elevaría el compromiso a ${nextPercentage.toFixed(0)}% y supera el ingreso.`
        : `Alerta ${nextHealth.label.toLowerCase()}: este gasto elevaría el compromiso a ${nextPercentage.toFixed(0)}% del ingreso.`
      : "");
    setNotice("");
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!userId || saving || busyId) return;
    if (!title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !estimatedDate) {
      setError("Completa el título, un monto mayor que cero y una fecha estimada.");
      return;
    }
    if (missingAssignments.length > 0) {
      setError("Quita las deudas que ya no están disponibles antes de guardar el plan.");
      return;
    }
    if (assignedDebtIds.some((debtId) => debtsById.get(debtId)?.currency !== currency)) {
      setError("Todas las deudas asignadas deben usar la misma moneda del ingreso.");
      return;
    }
    if (plannedExpenses.some((expense) => expense.currency !== currency)) {
      setError("Todos los gastos deben usar la misma moneda del ingreso.");
      return;
    }
    if (formCommitment > numericAmount + 0.005) {
      setError("No puedes guardar un plan que supera el monto del ingreso. Reduce o quita compromisos.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const input: PlannedIncomeInput = {
        title,
        amount: numericAmount,
        currency,
        estimatedDate,
        assignments,
      };
      await savePlannedIncome(userId, input, editingId || undefined);
      setNotice(editingId ? "Ingreso proyectado actualizado." : "Ingreso proyectado creado.");
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el ingreso proyectado.");
    } finally {
      setSaving(false);
    }
  };

  const runPlan = async (income: PlannedIncome) => {
    if (!userId || busyId || saving) return;
    setBusyId(income.id);
    setError("");
    setNotice("");
    try {
      await executePlannedIncome(userId, income.id);
      setNotice(`Plan "${income.title}" ejecutado; los pagos y balances se están sincronizando.`);
    } catch (executionError) {
      setError(executionError instanceof Error ? executionError.message : "No se pudo ejecutar el plan.");
    } finally {
      setBusyId("");
    }
  };

  const removeIncome = async (income: PlannedIncome) => {
    if (!userId || busyId || saving || !window.confirm(`¿Eliminar el ingreso "${income.title}"?`)) return;
    setBusyId(income.id);
    setError("");
    setNotice("");
    try {
      await removePlannedIncome(userId, income.id);
      setNotice("Ingreso proyectado eliminado.");
      if (editingId === income.id) resetForm();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "No se pudo eliminar el ingreso proyectado.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BackButton href="/isorropia">Volver al menú</BackButton>
      </div>
      <header className="mt-10 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Isorropia Kairos / Proyección financiera</p>
        <h1 className="mt-4 text-3xl uppercase tracking-widest text-[#ddab36] sm:text-5xl">Planificador</h1>
        <p className="mt-5 text-sm leading-7 text-white/65">
          Proyecta tus ingresos, asigna compromisos y decide con anticipación cuánto quedará libre.
        </p>
      </header>

      {!userId && <p className="mt-6 border border-[#ddab36]/35 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" aria-live="polite" className="mt-6 border border-emerald-300/40 bg-emerald-950/40 p-4 text-sm text-emerald-100">{notice}</p>}

      {userId && <PlannerAlertSettings key={`${userId}-${alertThresholds.caution}-${alertThresholds.danger}-${alertThresholds.critical}`} userId={userId} thresholds={alertThresholds} />}

      {userId && <PlannerHealthBanner assessment={nextIncomeAssessment} />}

      <section className="mt-8 border border-[#ddab36]/40 bg-black/55 p-5 sm:p-6" aria-labelledby="monthly-financial-health">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Panorama del mes · {currentMonth}</p>
            <h2 id="monthly-financial-health" className="mt-2 text-lg uppercase tracking-wider text-[#ddab36]">Salud financiera global</h2>
          </div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] uppercase text-white/55">Bs y $ por separado</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {(["Bs", "$"] as const).map((summaryCurrency) => {
            const summary = monthlySummary[summaryCurrency];
            const percentage = summary.income > 0 ? summary.committed / summary.income * 100 : 0;
            const health = getCommitmentHealth(percentage, effectiveAlertThresholds);
            const freeAmount = summary.income - summary.committed;
            return (
              <article key={summaryCurrency} className={`border p-4 ${summary.income > 0 ? health.panel : "border-white/10 bg-white/5 text-white/70"}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs uppercase tracking-wider">{summaryCurrency === "Bs" ? "Bolívares" : "Dólares"}</h3>
                  {summary.income > 0 && <span className="rounded-full border border-current/30 px-2.5 py-1 text-[10px] uppercase">{health.label} · {percentage.toFixed(0)}%</span>}
                </div>
                {summary.income > 0 ? (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[9px] uppercase opacity-70">Proyectado</p><p className="mt-1 text-sm font-semibold">{money(summary.income, summaryCurrency)}</p></div>
                      <div><p className="text-[9px] uppercase opacity-70">Comprometido</p><p className="mt-1 text-sm font-semibold">{money(summary.committed, summaryCurrency)}</p></div>
                      <div><p className="text-[9px] uppercase opacity-70">Libre real</p><p className={`mt-1 text-sm font-semibold ${freeAmount < -0.005 ? "text-red-200" : ""}`}>{money(freeAmount, summaryCurrency)}</p></div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-label={`Compromiso mensual en ${summaryCurrency}`} aria-valuenow={Math.round(percentage)} aria-valuemin={0} aria-valuemax={100}>
                      <div className={`h-full rounded-full ${health.bar}`} style={{ width: `${Math.min(100, percentage)}%` }} />
                    </div>
                    <p className="mt-3 text-xs leading-5">{percentage >= effectiveAlertThresholds.critical ? "⚠️ Dinero libre real en zona crítica. Evita asumir nuevas deudas." : health.message}</p>
                  </>
                ) : (
                  <p className="mt-3 text-xs leading-5">Sin ingresos proyectados pendientes para este mes en esta moneda.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg uppercase tracking-wider text-white">Ingresos proyectados</h2>
        <button
          type="button"
          onClick={openNewForm}
          disabled={!userId || saving || Boolean(busyId)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#ddab36] px-4 py-3 text-xs font-bold uppercase text-[#121212] hover:bg-[#f0c55a] disabled:opacity-50"
        >
          <Plus aria-hidden="true" size={16} /> Nuevo ingreso
        </button>
      </div>

      {formOpen && (
        <form onSubmit={(event) => void submit(event)} className="mt-5 border border-[#ddab36]/40 bg-black/60 p-5 sm:p-7">
          <h2 className="text-lg uppercase text-[#ddab36]">{editingId ? "Editar ingreso" : "Nuevo ingreso proyectado"}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem]">
            <label className="text-xs uppercase text-white/65">
              Título
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={!userId || saving} placeholder="Ej. Quincena 15 de noviembre" className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" />
            </label>
            <label className="text-xs uppercase text-white/65">
              Monto
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" />
            </label>
            <label className="text-xs uppercase text-white/65">
              Moneda
              <select value={currency} onChange={(event) => {
                const nextCurrency = event.target.value as Currency;
                setCurrency(nextCurrency);
                setAssignments((current) => current.filter((item) => item.type === "debt"
                  ? debtsById.get(item.debtId)?.currency === nextCurrency
                  : item.currency === nextCurrency));
                setExpenseCategory(PLANNER_CATEGORIES[nextCurrency][0]);
              }} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none">
                <option value="Bs">Bolívares (Bs)</option>
                <option value="$">Dólares ($)</option>
              </select>
            </label>
            <label className="text-xs uppercase text-white/65">
              Fecha estimada
              <input type="date" value={estimatedDate} onChange={(event) => setEstimatedDate(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" />
            </label>
          </div>

          <fieldset className="mt-6">
            <legend className="text-xs uppercase text-white/70">Deudas a liquidar · {currency}</legend>
            <div className="mt-3 inline-flex w-full max-w-xl rounded-xl border border-[#ddab36]/30 bg-black/45 p-1" role="group" aria-label="Filtrar deudas por tipo">
              {([
                { value: "payable", label: "Deudas que debo", count: payableDebtCount },
                { value: "receivable", label: "Me deben", count: receivableDebtCount },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={debtFilter === option.value}
                  onClick={() => setDebtFilter(option.value)}
                  className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[10px] uppercase transition-colors sm:text-xs ${debtFilter === option.value ? "bg-[#ddab36] font-bold text-[#121212]" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
                >
                  <span>{option.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${debtFilter === option.value ? "bg-black/15" : "bg-white/10"}`}>{option.count}</span>
                </button>
              ))}
            </div>
            {availableDebts.length === 0 && missingAssignments.length === 0 ? (
              <p className="mt-3 text-sm text-white/50">No hay deudas pendientes en esta vista y moneda.</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {availableDebts.map((debt) => {
                  const outstanding = getOutstandingDebt(debt);
                  return (
                    <label key={debt.id} className="flex min-w-0 cursor-pointer items-start gap-3 border border-white/10 bg-white/5 p-3">
                      <input type="checkbox" checked={assignedDebtIds.includes(debt.id)} onChange={() => toggleDebt(debt.id)} disabled={!userId || saving} className="mt-1 size-4 shrink-0 accent-[#ddab36]" />
                      <span className="min-w-0 flex-1">
                        <span className="block wrap-break-word text-sm text-white">{debt.title}</span>
                        <span className="mt-1 block text-xs text-white/55">{debt.type === "payable" ? "Debo" : "Me deben"} · Pendiente {money(outstanding, debt.currency)} · vence {debt.dueDate}</span>
                      </span>
                    </label>
                  );
                })}
                {missingAssignments.map((debtId) => (
                  <div key={debtId} className="flex items-center justify-between gap-3 border border-red-300/30 bg-red-950/30 p-3 text-xs text-red-100">
                    <span>Deuda no disponible · {debtId}</span>
                    <button type="button" onClick={() => toggleDebt(debtId)} className="min-h-9 shrink-0 rounded border border-red-200/40 px-2 uppercase hover:bg-red-900/40">Quitar</button>
                  </div>
                ))}
              </div>
            )}
            {assignedDebtIds.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase text-white/45">Deudas ya asignadas al ingreso</p>
                <ul className="mt-2 space-y-2">
                  {assignedDebtIds.map((debtId) => {
                    const debt = debtsById.get(debtId);
                    return (
                      <li key={debtId} className="flex items-center justify-between gap-3 border border-white/10 bg-white/5 p-3 text-xs">
                        <span className="min-w-0 wrap-break-word text-white/75">{debt?.title ?? `Deuda no disponible · ${debtId}`} {debt && <span className="text-white/45">· {debt.type === "payable" ? "Debo" : "Me deben"}</span>}</span>
                        <button type="button" onClick={() => toggleDebt(debtId)} className="min-h-9 shrink-0 rounded border border-red-300/30 px-2 uppercase text-red-100 hover:bg-red-950/40">Quitar</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </fieldset>

          <fieldset className="mt-6 border-t border-white/10 pt-5">
            <legend className="text-xs uppercase text-white/70">Gastos fijos / por categoría</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
              <label className="text-xs uppercase text-white/65">
                Concepto
                <input value={expenseTitle} onChange={(event) => setExpenseTitle(event.target.value)} maxLength={120} disabled={!userId || saving} placeholder="Ej. Condominio" className="mt-2 min-h-11 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" />
              </label>
              <label className="text-xs uppercase text-white/65">
                Monto · {currency}
                <input type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} disabled={!userId || saving} className="mt-2 min-h-11 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" />
              </label>
              <label className="text-xs uppercase text-white/65">
                Categoría
                <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} disabled={!userId || saving} className="mt-2 min-h-11 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-2 text-sm text-white outline-none">
                  {PLANNER_CATEGORIES[currency].map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <button type="button" onClick={addExpense} disabled={!userId || saving} className="min-h-11 self-end rounded-lg border border-[#ddab36]/45 px-4 py-2 text-xs uppercase text-[#ddab36] hover:bg-[#ddab36]/10 disabled:opacity-50">Añadir gasto</button>
            </div>
            {plannedExpenses.length > 0 && (
              <ul className="mt-4 space-y-2">
                {plannedExpenses.map((expense, index) => (
                  <li key={`${expense.title}-${index}`} className="flex items-center justify-between gap-3 border border-white/10 bg-white/5 p-3 text-sm">
                    <span className="min-w-0 wrap-break-word text-white">{expense.title} <span className="text-white/45">· {expense.category}</span></span>
                    <span className="flex shrink-0 items-center gap-3 text-white/75">
                      {money(expense.amount, expense.currency)}
                      <button type="button" onClick={() => removeExpense(index)} aria-label={`Quitar gasto ${expense.title}`} className="min-h-9 rounded border border-red-300/30 px-2 text-xs uppercase text-red-100 hover:bg-red-950/40">Quitar</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <p className={`mt-4 text-sm ${formCommitment > Number(amount || 0) ? "text-red-200" : "text-white/60"}`}>
            Comprometido: {money(formCommitment, currency)} · Libre: {money(formIncomeAmount - formCommitment, currency)} · {formIncomeAmount > 0 ? `${formCommitmentPercentage.toFixed(0)}% comprometido` : "Indica el monto del ingreso"}
          </p>
          {(formCommitment > formIncomeAmount + 0.005 || (formIncomeAmount > 0 && formCommitmentPercentage >= effectiveAlertThresholds.caution)) && (
            <div role="status" aria-live="polite" className={`mt-3 border p-3 text-xs leading-5 ${exceedsCapacity ? "border-red-300/50 bg-red-950/50 text-red-100" : formHealth.panel}`}>
              {exceedsCapacity
                ? `⚠️ Sin respaldo suficiente: los compromisos superan el ingreso en ${money(formCommitment - formIncomeAmount, currency)}. Reduce o quita asignaciones antes de guardar.`
                : `${formHealth.label}: ${formHealth.message}`}
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="submit" disabled={!userId || saving || Boolean(busyId)} className="min-h-11 rounded-lg bg-[#ddab36] px-5 py-3 text-xs font-bold uppercase text-[#121212] disabled:opacity-50">
              {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear ingreso"}
            </button>
            <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-lg border border-white/25 px-5 py-3 text-xs uppercase text-white/80 disabled:opacity-50">Cancelar</button>
          </div>
        </form>
      )}

      {!userId ? null : (incomesLoading || debtsLoading || incomeOwnerId !== userId || debtOwnerId !== userId) ? (
        <p role="status" className="mt-6 text-sm text-white/60">Sincronizando ingresos y deudas...</p>
      ) : orderedIncomes.length === 0 ? (
        <p className="mt-5 border border-white/15 bg-black/35 p-6 text-sm text-white/60">Aún no tienes ingresos proyectados. Crea uno para organizar tus próximos compromisos.</p>
      ) : (
        <section className="mt-5 grid gap-4 lg:grid-cols-2" aria-label="Ingresos proyectados">
          {orderedIncomes.map((income) => {
            const incomeDebtIds = income.assignments.flatMap(
              (assignment) => assignment.type === "debt" ? [assignment.debtId] : [],
            );
            const assigned = incomeDebtIds.map((id) => debtsById.get(id)).filter((debt): debt is Debt => Boolean(debt));
            const missingCount = incomeDebtIds.length - assigned.length;
            const expenses = income.assignments.filter(
              (assignment): assignment is PlannedExpenseAssignment => assignment.type === "expense",
            );
            const debtCommitment = assigned.reduce(
              (total, debt) => total + (income.status === "ejecutado" ? debt.paidAmount : getOutstandingDebt(debt)),
              0,
            );
            const expenseCommitment = expenses.reduce((total, expense) => total + expense.amount, 0);
            const committed = debtCommitment + expenseCommitment;
            const percentage = income.amount > 0 ? committed / income.amount * 100 : 0;
            const coverage = Math.min(100, percentage);
            const health = getCommitmentHealth(percentage, effectiveAlertThresholds);
            const freeAmount = income.amount - committed;
            const canExecute = income.status === "pendiente"
              && missingCount === 0
              && assigned.every((debt) => debt.currency === income.currency)
              && expenses.every((expense) => expense.currency === income.currency)
              && committed <= income.amount + 0.005;

            return (
              <article key={income.id} className={`border bg-black/45 p-5 sm:p-6 ${income.status === "ejecutado" ? "border-emerald-300/30" : "border-[#ddab36]/35"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="wrap-break-word text-base uppercase text-white">{income.title}</h3>
                    <p className="mt-2 flex items-center gap-2 text-xs text-white/55"><CalendarDays aria-hidden="true" size={14} /> Estimado: {income.estimatedDate}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${income.status === "ejecutado" ? "border-emerald-300/40 text-emerald-200" : "border-amber-200/40 text-amber-100"}`}>
                    {income.status}
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                  <div className="min-w-0 border border-white/10 bg-white/5 p-3"><p className="text-[10px] uppercase text-white/45">Ingreso</p><p className="mt-2 wrap-break-word text-sm font-semibold text-white">{money(income.amount, income.currency)}</p></div>
                  <div className="min-w-0 border border-white/10 bg-white/5 p-3"><p className="text-[10px] uppercase text-white/45">Comprometido</p><p className="mt-2 wrap-break-word text-sm font-semibold text-amber-100">{money(committed, income.currency)}</p></div>
                  <div className={`min-w-0 border p-3 ${freeAmount < -0.005 ? "border-red-300/30 bg-red-950/30" : "border-white/10 bg-white/5"}`}><p className="text-[10px] uppercase text-white/45">Libre</p><p className={`mt-2 wrap-break-word text-sm font-semibold ${freeAmount < -0.005 ? "text-red-200" : "text-emerald-200"}`}>{money(freeAmount, income.currency)}</p></div>
                </div>

                <div className="mt-4" aria-label={`Cobertura de compromisos: ${Math.round(percentage)} por ciento`}>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Compromiso de ${income.title}`} aria-valuenow={Math.min(100, Math.round(percentage))} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full rounded-full transition-all ${health.bar}`} style={{ width: `${coverage}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className={`text-[10px] uppercase ${health.text}`}>{health.label}</p>
                    <p className="text-right text-[10px] uppercase text-white/55">{Math.round(percentage)}% comprometido</p>
                  </div>
                  <p className={`mt-2 text-xs leading-5 ${health.text}`}>{health.message}</p>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase text-white/45">Deudas a liquidar</p>
                    {assigned.length === 0 && missingCount === 0 ? (
                      <p className="mt-2 text-xs text-white/50">Sin deudas asignadas.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {assigned.map((debt) => (
                          <li key={debt.id} className="flex items-center justify-between gap-3 text-xs text-white/70">
                            <span className="min-w-0 wrap-break-word">{debt.title}{debt.paid ? " · Saldada" : ""}</span>
                            <span className="shrink-0">{money(income.status === "ejecutado" ? debt.paidAmount : getOutstandingDebt(debt), debt.currency)}</span>
                          </li>
                        ))}
                        {missingCount > 0 && <li className="text-xs text-red-200">{missingCount} deuda(s) ya no disponible(s); edita el plan antes de ejecutarlo.</li>}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-white/45">Gastos fijos / por categoría</p>
                    {expenses.length === 0 ? (
                      <p className="mt-2 text-xs text-white/50">Sin gastos asignados.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {expenses.map((expense, index) => (
                          <li key={`${expense.title}-${index}`} className="flex items-center justify-between gap-3 text-xs text-white/70">
                            <span className="min-w-0 wrap-break-word">{expense.title} <span className="text-white/45">· {expense.category}</span></span>
                            <span className="shrink-0">{money(expense.amount, expense.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {income.status === "pendiente" && (
                    <>
                      <button type="button" onClick={() => editIncome(income)} disabled={Boolean(busyId) || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#ddab36]/40 px-3 py-2 text-xs uppercase text-[#ddab36] hover:bg-[#ddab36]/10 disabled:opacity-50"><Pencil aria-hidden="true" size={14} /> Editar</button>
                      <button type="button" onClick={() => void removeIncome(income)} disabled={Boolean(busyId) || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-950/50 disabled:opacity-50"><Trash2 aria-hidden="true" size={14} /> Eliminar</button>
                      <button type="button" onClick={() => void runPlan(income)} disabled={!userId || Boolean(busyId) || saving || !canExecute} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#ddab36] px-4 py-2 text-xs font-bold uppercase text-[#121212] hover:bg-[#f0c55a] disabled:cursor-not-allowed disabled:opacity-50">
                        {busyId === income.id ? <CircleDollarSign aria-hidden="true" className="animate-pulse" size={15} /> : <Check aria-hidden="true" size={15} />}
                        {busyId === income.id ? "Ejecutando..." : "Ejecutar plan / cobrar"}
                      </button>
                    </>
                  )}
                  {busyId && busyId !== income.id && <span className="self-center text-xs text-white/45">Procesando otro ingreso...</span>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

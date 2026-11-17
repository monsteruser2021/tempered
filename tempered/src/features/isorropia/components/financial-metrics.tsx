"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, Coins, Download, Scale, TrendingUp, Wallet } from "lucide-react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "@/shared/ui/back-button";
import { useSession } from "@/shared/auth/session-context";
import FinancialMetricsCharts, {
  type ActiveDebtPoint,
  type ExpenseCategoryPoint,
  type MonthlyChartPoint,
} from "./financial-metrics-charts";
import { captureFinancialChartImages } from "./financial-metrics-chart-images";
import type { ExportMovement } from "./financial-metrics-export";

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const bsCategories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];

type Reparto = { id: string; month: number; year: number };
type Debt = { title: string; type: "receivable" | "payable"; amount: number; paidAmount: number; currency: "Bs" | "$"; dueDate: string; paid: boolean };
type Income = { description: string; totalBs: number; percentages: Record<string, number>; isRollover: boolean };
type BsTransaction = { category: string; date: string; description: string; incomeBs: number; expenseBs: number; isTransfer: boolean; isCurrencyExchange: boolean; isDebtPayment: boolean; isDebtCollection: boolean; exchangeRate: number; transferId: string; sourceSaleId: string };
type DollarTransaction = { category: string; date: string; description: string; incomeUsd: number; expenseUsd: number; isCurrencyExchange: boolean; isRollover: boolean; isDebtPayment: boolean; isDebtCollection: boolean; isPlannedIncome: boolean; exchangeRate: number; transferId: string; sourceSaleId: string };
type PeriodData = { incomes: Income[]; bsTransactions: BsTransaction[]; dollarTransactions: DollarTransaction[] };
type CurrencyTotals = { capitalRecovered: number; realizedGain: number };
type DebtAmounts = Record<"Bs" | "$", number>;
type DebtTotals = { receivable: DebtAmounts; payable: DebtAmounts };

const emptyPeriodData = (): PeriodData => ({ incomes: [], bsTransactions: [], dollarTransactions: [] });
const emptyDebtTotals = (): DebtTotals => ({ receivable: { Bs: 0, "$": 0 }, payable: { Bs: 0, "$": 0 } });
const formatAmount = (value: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function getPreviousPeriod(reparto: Reparto | undefined, repartos: Reparto[]) {
  if (!reparto) return undefined;
  const previousDate = new Date(reparto.year, reparto.month - 1, 1);
  return repartos.find((item) => item.year === previousDate.getFullYear() && item.month === previousDate.getMonth());
}

function getMonthlyTotals(data: PeriodData | undefined) {
  if (!data) return { income: 0, expenses: 0, incomeUsd: 0, expensesUsd: 0 };
  const incomeFromReparto = data.incomes
    .filter((item) => !item.isRollover)
    .reduce((sum, item) => sum + item.totalBs, 0);
  const dollarTransferIds = new Set(data.dollarTransactions.map((item) => item.transferId).filter(Boolean));
  const externalTransactions = data.bsTransactions.filter((item) => !item.isTransfer && !item.isCurrencyExchange && !item.isDebtCollection && item.category !== "Inversión" && !item.sourceSaleId && !(item.transferId && dollarTransferIds.has(item.transferId)));
  const dollarTransactions = data.dollarTransactions.filter((item) => !item.isRollover && !item.isCurrencyExchange && !item.isDebtCollection && (item.isPlannedIncome || item.category !== "Inversiones") && !item.transferId && !item.sourceSaleId);
  return {
    income: incomeFromReparto + externalTransactions.reduce((sum, item) => sum + item.incomeBs, 0),
    expenses: externalTransactions.reduce((sum, item) => sum + item.expenseBs, 0),
    incomeUsd: dollarTransactions.reduce((sum, item) => sum + item.incomeUsd, 0),
    expensesUsd: dollarTransactions.reduce((sum, item) => sum + item.expenseUsd, 0),
  };
}

function getVariation(current: number, previous: number, hasPrevious: boolean) {
  if (!hasPrevious) return null;
  if (previous === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Variation({ value, label, increaseIsPositive = true }: { value: number | null; label: string; increaseIsPositive?: boolean }) {
  if (value === null) return <span className="text-xs text-white/45">Sin periodo anterior</span>;
  if (!Number.isFinite(value)) return <span className="text-xs text-[#ddab36]">Nuevo</span>;
  const isIncrease = value >= 0;
  const Icon = isIncrease ? ArrowUpRight : ArrowDownRight;
  const isPositive = value === 0 || increaseIsPositive === isIncrease;
  return <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${value === 0 ? "text-white/55" : isPositive ? "text-emerald-300" : "text-rose-300"}`}><Icon size={14} aria-hidden="true" />{Math.abs(value).toFixed(1)}% {label}</span>;
}

function MetricCard({ title, icon: Icon, children, className = "", alert }: { title: string; icon: typeof Wallet; children: React.ReactNode; className?: string; alert?: "warning" | "critical" }) {
  const alertStyle = alert === "critical"
    ? { borderColor: "rgb(251 113 133 / 0.55)", backgroundColor: "rgb(76 5 25 / 0.26)" }
    : alert === "warning" ? { borderColor: "rgb(251 191 36 / 0.5)", backgroundColor: "rgb(69 26 3 / 0.24)" } : undefined;
  return <article className={`min-w-0 rounded-lg border border-[#ddab36]/20 bg-[#161616]/85 p-5 shadow-lg shadow-black/20 sm:p-6 ${className}`} style={alertStyle}>
    <h2 className="flex items-center gap-2 text-xs uppercase text-white/65"><Icon size={16} className="text-[#ddab36]" aria-hidden="true" />{title}</h2>
    <div className="mt-5">{children}</div>
  </article>;
}

export default function FinancialMetrics() {
  const { userId } = useSession();
  const [repartos, setRepartos] = useState<Reparto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [budgetThreshold, setBudgetThreshold] = useState(80);
  const [exporting, setExporting] = useState(false);
  const [periodData, setPeriodData] = useState<Record<string, PeriodData>>({});
  const [loadedCollections, setLoadedCollections] = useState<Record<string, boolean>>({});
  const [debts, setDebts] = useState<Debt[]>([]);
  const [repartosLoaded, setRepartosLoaded] = useState(false);
  const [debtsLoaded, setDebtsLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof userId !== "string" || userId.trim() === "") return;
    const ownerId = userId.trim();
    return onSnapshot(
      query(collection(db, "distributions"), where("userId", "==", ownerId)),
      (snapshot) => {
        const next = snapshot.docs.map((item) => ({ id: item.id, month: Number(item.data().month), year: Number(item.data().year) }))
          .sort((first, second) => second.year - first.year || second.month - first.month);
        const now = new Date();
        const current = next.find((item) => item.year === now.getFullYear() && item.month === now.getMonth());
        setRepartos(next);
        setSelectedId((currentId) => currentId && next.some((item) => item.id === currentId) ? currentId : current?.id ?? next[0]?.id ?? "");
        setRepartosLoaded(true);
      },
      () => { setError("No se pudieron cargar los periodos financieros."); setRepartosLoaded(true); },
    );
  }, [userId]);

  useEffect(() => {
    if (typeof userId !== "string" || userId.trim() === "") return;
    const ownerId = userId.trim();
    return onSnapshot(
      query(collection(db, "debts"), where("userId", "==", ownerId)),
      (snapshot) => {
        setDebts(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            title: String(data.title ?? "Deuda sin título"),
            type: data.type === "payable" ? "payable" : "receivable",
            amount: Number(data.amount ?? 0),
            paidAmount: typeof data.paidAmount === "number" ? Number(data.paidAmount) : data.paid === true ? Number(data.amount ?? 0) : 0,
            currency: data.currency === "$" ? "$" : "Bs",
            dueDate: String(data.dueDate ?? ""),
            paid: data.paid === true,
          };
        }));
        setDebtsLoaded(true);
      },
      () => { setError("No se pudieron cargar las deudas."); setDebtsLoaded(true); },
    );
  }, [userId]);

  const selectedReparto = repartos.find((item) => item.id === selectedId);
  const previousReparto = getPreviousPeriod(selectedReparto, repartos);

  useEffect(() => {
    if (typeof userId !== "string" || userId.trim() === "" || !repartos.length) return;
    const unsubscribers: (() => void)[] = [];

    const updatePeriodData = <K extends keyof PeriodData>(id: string, key: K, value: PeriodData[K]) => {
      setPeriodData((current) => ({ ...current, [id]: { ...emptyPeriodData(), ...current[id], [key]: value } }));
      setLoadedCollections((current) => ({ ...current, [`${id}:${key}`]: true }));
    };

    repartos.forEach((reparto) => {
      const base = doc(db, "distributions", reparto.id);
      unsubscribers.push(onSnapshot(collection(base, "dollarTransactions"), (snapshot) => {
        updatePeriodData(reparto.id, "dollarTransactions", snapshot.docs.map((item) => ({
          category: String(item.data().category ?? ""),
          date: String(item.data().date ?? ""),
          description: String(item.data().description ?? ""),
          incomeUsd: Number(item.data().incomeUsd ?? 0),
          expenseUsd: Number(item.data().expenseUsd ?? 0),
          isCurrencyExchange: item.data().isCurrencyExchange === true,
          isDebtPayment: item.data().isDebtPayment === true || item.data().debtMovementType === "payment",
          isDebtCollection: item.data().isDebtCollection === true || item.data().debtMovementType === "collection",
          isPlannedIncome: item.data().isPlannedIncome === true,
          isRollover: item.data().isRollover === true,
          exchangeRate: Number(item.data().exchangeRate ?? 0),
          transferId: String(item.data().transferId ?? ""),
          sourceSaleId: String(item.data().sourceSaleId ?? ""),
        })));
      }, () => setError("No se pudieron cargar las compras de divisas.")));

      unsubscribers.push(onSnapshot(collection(base, "transactions"), (snapshot) => {
        updatePeriodData(reparto.id, "bsTransactions", snapshot.docs.map((item) => ({
          category: String(item.data().category ?? ""),
          date: String(item.data().date ?? ""),
          description: String(item.data().description ?? ""),
          incomeBs: Number(item.data().incomeBs ?? 0),
          expenseBs: Number(item.data().expenseBs ?? 0),
          isTransfer: item.data().isTransfer === true || Boolean(item.data().transferId),
          isCurrencyExchange: item.data().isCurrencyExchange === true,
          isDebtPayment: item.data().isDebtPayment === true || item.data().debtMovementType === "payment",
          isDebtCollection: item.data().isDebtCollection === true || item.data().debtMovementType === "collection",
          exchangeRate: Number(item.data().exchangeRate ?? 0),
          transferId: String(item.data().transferId ?? ""),
          sourceSaleId: String(item.data().sourceSaleId ?? ""),
        })));
      }, () => setError("No se pudieron cargar los movimientos del periodo.")));

      unsubscribers.push(onSnapshot(collection(base, "incomes"), (snapshot) => {
        updatePeriodData(reparto.id, "incomes", snapshot.docs.map((item) => ({
          description: String(item.data().description ?? ""),
          totalBs: Number(item.data().totalBs ?? 0),
          percentages: (item.data().percentages ?? {}) as Record<string, number>,
          isRollover: item.data().isRollover === true,
        })));
      }, () => setError("No se pudieron cargar los ingresos del periodo.")));
    });

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [repartos, previousReparto?.id, selectedId, userId]);

  const selectedData = periodData[selectedId] ?? emptyPeriodData();
  const previousData = previousReparto ? periodData[previousReparto.id] : undefined;
  const currentTotals = getMonthlyTotals(selectedData);
  const previousTotals = getMonthlyTotals(previousData);
  const debtTotals = useMemo(() => {
    if (!selectedReparto) return emptyDebtTotals();
    const monthPrefix = `${selectedReparto.year}-${String(selectedReparto.month + 1).padStart(2, "0")}`;
    return debts.reduce<DebtTotals>((totals, debt) => {
      if (!debt.paid && debt.dueDate.startsWith(`${monthPrefix}-`)) totals[debt.type][debt.currency] += Math.max(0, debt.amount - debt.paidAmount);
      return totals;
    }, emptyDebtTotals());
  }, [debts, selectedReparto]);

  const metrics = useMemo(() => {
    const currentIncome = currentTotals.income;
    const currentExpenses = currentTotals.expenses;
    const investmentBs = selectedData.bsTransactions
      .filter((item) => item.category === "Inversión" && !item.isTransfer && !item.isCurrencyExchange)
      .reduce((sum, item) => sum + item.expenseBs, 0);
    const investmentUsd = selectedData.dollarTransactions
      .filter((item) => item.category === "Inversiones" && !item.isRollover && !item.isCurrencyExchange && !item.transferId)
      .reduce((sum, item) => sum + item.expenseUsd, 0);
    const bsBalance = selectedData.incomes.reduce((sum, income) => sum + bsCategories.reduce((allocated, category) => allocated + income.totalBs * Number(income.percentages[category] ?? 0) / 100, 0), 0)
      + selectedData.bsTransactions.reduce((sum, transaction) => sum + transaction.incomeBs - transaction.expenseBs, 0);
    const usdBalance = selectedData.dollarTransactions.reduce((sum, transaction) => sum + transaction.incomeUsd - transaction.expenseUsd, 0);
    const throughSelectedPeriod = selectedReparto
      ? repartos.filter((item) => item.year < selectedReparto.year || (item.year === selectedReparto.year && item.month <= selectedReparto.month))
      : [];
    const exchanges = throughSelectedPeriod.map((reparto) => {
      const data = periodData[reparto.id] ?? emptyPeriodData();
      const bsTransferIds = new Set(data.bsTransactions.map((item) => item.transferId).filter(Boolean));
      const usdTransferIds = new Set(data.dollarTransactions.map((item) => item.transferId).filter(Boolean));
      const dollarPurchases = data.dollarTransactions.filter((item) => item.isCurrencyExchange || (item.transferId && bsTransferIds.has(item.transferId)));
      const bolivarPayments = data.bsTransactions.filter((item) => item.isCurrencyExchange || (item.transferId && usdTransferIds.has(item.transferId)));
      return {
        dollars: dollarPurchases.reduce((sum, item) => sum + item.incomeUsd, 0),
        bolivares: bolivarPayments.reduce((sum, item) => sum + item.expenseBs, 0),
      };
    });
    const dollarsBought = exchanges.reduce((sum, item) => sum + item.dollars, 0);
    const bolivaresInvested = exchanges.reduce((sum, item) => sum + item.bolivares, 0);
    const averagePurchaseRate = dollarsBought > 0 ? bolivaresInvested / dollarsBought : null;
    const localAssets = Math.max(0, bsBalance);
    const foreignAssetsInBs = averagePurchaseRate === null ? 0 : Math.max(0, usdBalance) * averagePurchaseRate;
    const comparableAssets = localAssets + foreignAssetsInBs;
    const investmentTotals: Record<"Bs" | "$", CurrencyTotals> = {
      Bs: { capitalRecovered: 0, realizedGain: 0 },
      "$": { capitalRecovered: 0, realizedGain: 0 },
    };
    selectedData.bsTransactions.filter((item) => item.sourceSaleId).forEach((item) => {
      if (item.category === "Inversión") investmentTotals.Bs.capitalRecovered += item.incomeBs;
      if (item.category === "Ahorro") investmentTotals.Bs.realizedGain += item.incomeBs;
    });
    selectedData.dollarTransactions.filter((item) => item.sourceSaleId).forEach((item) => {
      if (item.category === "Inversiones") investmentTotals["$"].capitalRecovered += item.incomeUsd;
      if (item.category === "Ahorro") investmentTotals["$"].realizedGain += item.incomeUsd;
    });
    return {
      currentIncome,
      currentExpenses,
      currentIncomeUsd: currentTotals.incomeUsd,
      currentExpensesUsd: currentTotals.expensesUsd,
      investmentBs,
      investmentUsd,
      savingsRate: currentIncome > 0 ? ((currentIncome - currentExpenses - investmentBs) / currentIncome) * 100 : null,
      incomeVariation: getVariation(currentIncome, previousTotals.income, Boolean(previousReparto)),
      expenseVariation: getVariation(currentExpenses, previousTotals.expenses, Boolean(previousReparto)),
      bsBalance,
      usdBalance,
      dollarsBought,
      bolivaresInvested,
      averagePurchaseRate,
      localAssetShare: comparableAssets > 0 ? (localAssets / comparableAssets) * 100 : null,
      foreignAssetShare: comparableAssets > 0 ? (foreignAssetsInBs / comparableAssets) * 100 : null,
      investmentTotals,
    };
  }, [currentTotals, repartos, periodData, previousReparto, previousTotals, selectedData, selectedReparto]);

  const expenseRatios = [
    ...(metrics.currentIncome > 0 ? [metrics.currentExpenses / metrics.currentIncome * 100] : []),
    ...(metrics.currentIncomeUsd > 0 ? [metrics.currentExpensesUsd / metrics.currentIncomeUsd * 100] : []),
  ];
  const investmentRatios = [
    ...(metrics.currentIncome > 0 ? [metrics.investmentBs / metrics.currentIncome * 100] : []),
    ...(metrics.currentIncomeUsd > 0 ? [metrics.investmentUsd / metrics.currentIncomeUsd * 100] : []),
  ];
  const operatingExpenseAlert = getAlertLevel(expenseRatios, budgetThreshold);
  const investmentAlert = getAlertLevel(investmentRatios, budgetThreshold);
  const budgetAlert = operatingExpenseAlert || investmentAlert;
  const operatingExpenseRatio = metrics.currentIncome > 0 ? metrics.currentExpenses / metrics.currentIncome * 100 : null;
  const investmentRatioBs = metrics.currentIncome > 0 ? metrics.investmentBs / metrics.currentIncome * 100 : null;
  const investmentRatioUsd = metrics.currentIncomeUsd > 0 ? metrics.investmentUsd / metrics.currentIncomeUsd * 100 : null;

  if (!userId) return <main className="flex min-h-screen items-center justify-center px-5 py-10"><section className="w-full max-w-3xl rounded-xl border border-white/15 bg-black/30 p-8 text-center text-white"><p className="text-sm text-white/70">Inicia sesión para consultar tus métricas financieras.</p><BackButton href="/isorropia">Volver a Isorropia</BackButton></section></main>;

  const periodLoading = Boolean(selectedId) && ["incomes", "bsTransactions", "dollarTransactions"].some((key) => !loadedCollections[`${selectedId}:${key}`]);
  const historyLoading = repartos.some((item) => !loadedCollections[`${item.id}:dollarTransactions`] || !loadedCollections[`${item.id}:bsTransactions`] || !loadedCollections[`${item.id}:incomes`]);
  const previousLoading = Boolean(previousReparto) && ["incomes", "bsTransactions"].some((key) => !loadedCollections[`${previousReparto?.id}:${key}`]);
  const loading = !repartosLoaded || !debtsLoaded || periodLoading || previousLoading || historyLoading;
  const selectedPeriodLabel = selectedReparto ? `${monthNames[selectedReparto.month]} ${selectedReparto.year}` : "Sin reparto de fondos";

  const monthlyChartData: MonthlyChartPoint[] = selectedReparto
    ? repartos
      .filter((item) => item.year < selectedReparto.year || (item.year === selectedReparto.year && item.month <= selectedReparto.month))
      .slice(0, 12)
      .reverse()
      .map((item) => {
        const totals = getMonthlyTotals(periodData[item.id]);
        return {
          period: `${monthNames[item.month].slice(0, 3)} ${String(item.year).slice(-2)}`,
          incomeBs: totals.income,
          expenseBs: totals.expenses,
          incomeUsd: totals.incomeUsd,
          expenseUsd: totals.expensesUsd,
        };
      })
    : [];
  const expenseChartData: ExpenseCategoryPoint[] = (() => {
    const categories = ["Gastos Básicos", "Ahorros", "Otros Gastos", "Pago de Deudas"];
    const totals = Object.fromEntries(categories.map((category) => [category, { bs: 0, usd: 0 }])) as Record<string, { bs: number; usd: number }>;
    const addExpense = (currency: "bs" | "usd", category: string, amount: number, isDebtPayment: boolean) => {
      if (amount <= 0) return;
      const group = isDebtPayment
        ? "Pago de Deudas"
        : category.toLocaleLowerCase("es") === "gastos básicos"
          ? "Gastos Básicos"
          : ["ahorro", "fondo de emergencia"].includes(category.toLocaleLowerCase("es"))
            ? "Ahorros"
            : "Otros Gastos";
      totals[group][currency] += amount;
    };
    selectedData.bsTransactions.forEach((item) => {
      if (!item.isTransfer && !item.isCurrencyExchange && !item.isDebtCollection) addExpense("bs", item.category, item.expenseBs, item.isDebtPayment);
    });
    selectedData.dollarTransactions.forEach((item) => {
      if (!item.isRollover && !item.isCurrencyExchange && !item.isDebtCollection && !item.transferId) addExpense("usd", item.category, item.expenseUsd, item.isDebtPayment);
    });
    return categories.map((category) => ({ category, ...totals[category] }));
  })();
  const incomeChartData: ExpenseCategoryPoint[] = (() => {
    const totals = new Map<string, { bs: number; usd: number }>();
    const addIncome = (currency: "bs" | "usd", category: string, amount: number) => {
      if (amount <= 0) return;
      const label = category.trim() || "Sin categoría";
      const current = totals.get(label) ?? { bs: 0, usd: 0 };
      current[currency] += amount;
      totals.set(label, current);
    };

    selectedData.incomes.filter((income) => !income.isRollover).forEach((income) => {
      let allocatedPercentage = 0;
      Object.entries(income.percentages).forEach(([category, rawPercentage]) => {
        const percentage = Number(rawPercentage);
        if (!Number.isFinite(percentage) || percentage <= 0) return;
        allocatedPercentage += percentage;
        addIncome("bs", category, income.totalBs * percentage / 100);
      });
      if (allocatedPercentage < 100) addIncome("bs", "Sin asignación", income.totalBs * (100 - allocatedPercentage) / 100);
    });

    const dollarTransferIds = new Set(selectedData.dollarTransactions.map((item) => item.transferId).filter(Boolean));
    selectedData.bsTransactions
      .filter((item) => !item.isTransfer && !item.isCurrencyExchange && !item.isDebtCollection && item.category !== "Inversión" && !item.sourceSaleId && !(item.transferId && dollarTransferIds.has(item.transferId)))
      .forEach((item) => addIncome("bs", item.category, item.incomeBs));
    selectedData.dollarTransactions
      .filter((item) => !item.isRollover && !item.isCurrencyExchange && !item.isDebtCollection && (item.isPlannedIncome || item.category !== "Inversiones") && !item.transferId && !item.sourceSaleId)
      .forEach((item) => addIncome("usd", item.category, item.incomeUsd));

    return Array.from(totals, ([category, amounts]) => ({ category, ...amounts }));
  })();
  const activeDebtChartData: ActiveDebtPoint[] = debts.flatMap((debt) => {
    const amount = Math.max(0, debt.amount - debt.paidAmount);
    return !debt.paid && amount > 0
      ? [{ title: debt.title, type: debt.type, currency: debt.currency, amount }]
      : [];
  });

  const exportSelectedPeriod = async () => {
    if (!selectedReparto) return;
    setExporting(true);
    setError("");
    try {
      const movements: ExportMovement[] = [];
      const periodStart = `${selectedReparto.year}-${String(selectedReparto.month + 1).padStart(2, "0")}-01`;
      const addMovement = (date: string, description: string, category: string, type: string, currency: "Bs" | "$", amount: number) => {
        if (amount > 0) movements.push({ date, description, category, type, currency, amount });
      };
      selectedData.incomes.forEach((income) => {
        const allocations = Object.entries(income.percentages)
          .filter(([, percentage]) => Number(percentage) > 0)
          .map(([category, percentage]) => `${category} (${Number(percentage)}%)`)
          .join(", ");
        addMovement(periodStart, income.description || "Ingreso del periodo", allocations || "Sin asignación", income.isRollover ? "Saldo arrastrado" : "Ingreso", "Bs", income.totalBs);
      });
      selectedData.bsTransactions.forEach((transaction) => {
        const type = transaction.isCurrencyExchange ? "Compra de divisas" : transaction.isTransfer ? "Transferencia" : transaction.isDebtPayment ? "Pago de deuda" : transaction.isDebtCollection ? "Cobro de deuda" : transaction.sourceSaleId ? "Ingreso por inversión" : "Movimiento";
        addMovement(transaction.date, transaction.description, transaction.category, transaction.incomeBs > 0 ? (type === "Movimiento" ? "Ingreso" : type) : type, "Bs", transaction.incomeBs);
        addMovement(transaction.date, transaction.description, transaction.category, transaction.expenseBs > 0 ? (type === "Movimiento" ? "Egreso" : type) : type, "Bs", transaction.expenseBs);
      });
      selectedData.dollarTransactions.forEach((transaction) => {
        const type = transaction.isRollover ? "Saldo arrastrado" : transaction.isCurrencyExchange ? "Compra de divisas" : transaction.transferId ? "Transferencia" : transaction.isDebtPayment ? "Pago de deuda" : transaction.isDebtCollection ? "Cobro de deuda" : transaction.sourceSaleId ? "Ingreso por inversión" : "Movimiento";
        addMovement(transaction.date, transaction.description, transaction.category, transaction.incomeUsd > 0 && type === "Movimiento" ? "Ingreso" : type, "$", transaction.incomeUsd);
        addMovement(transaction.date, transaction.description, transaction.category, transaction.expenseUsd > 0 && type === "Movimiento" ? "Egreso" : type, "$", transaction.expenseUsd);
      });
      const charts = await captureFinancialChartImages();
      const { exportFinancialMetrics } = await import("./financial-metrics-export");
      await exportFinancialMetrics({
        period: selectedPeriodLabel,
        metrics: [
          { label: "Ingresos totales", bs: metrics.currentIncome, usd: metrics.currentIncomeUsd },
          { label: "Gastos operativos", bs: metrics.currentExpenses, usd: metrics.currentExpensesUsd },
          { label: "Inversión registrada", bs: metrics.investmentBs, usd: metrics.investmentUsd },
          { label: "Saldo al cierre", bs: metrics.bsBalance, usd: metrics.usdBalance },
          { label: "Saldo por cobrar", bs: debtTotals.receivable.Bs, usd: debtTotals.receivable["$"] },
          { label: "Saldo por pagar", bs: debtTotals.payable.Bs, usd: debtTotals.payable["$"] },
          { label: "Capital recuperado", bs: metrics.investmentTotals.Bs.capitalRecovered, usd: metrics.investmentTotals["$"].capitalRecovered },
          { label: "Ganancia neta realizada", bs: metrics.investmentTotals.Bs.realizedGain, usd: metrics.investmentTotals["$"].realizedGain },
        ],
        expenses: expenseChartData,
        totalIncome: { bs: metrics.currentIncome, usd: metrics.currentIncomeUsd },
        debts: activeDebtChartData,
        movements,
        charts,
      });
    } catch (exportError) {
      console.error("No se pudo exportar el informe financiero:", exportError);
      setError("No se pudo generar el archivo Excel. Inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  return <main className="min-h-screen w-full px-4 py-8 text-white sm:px-6 sm:py-10">
    <section className="mx-auto w-full max-w-7xl">
      <BackButton href="/isorropia">Volver a Isorropia</BackButton>
      <header className="mt-8 flex flex-col gap-5 border-b border-[#ddab36]/20 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase text-white/45">Isorropia / Análisis</p><h1 className="font-display mt-3 text-2xl uppercase text-[#ddab36] sm:text-4xl">Métricas financieras</h1><p className="mt-3 text-sm text-white/55">Ingresos, retención, activos y rendimiento de inversión.</p></div>
        <div className="grid w-full gap-3 sm:max-w-sm sm:grid-cols-2">
          <label className="text-xs uppercase text-white/60">Periodo analizado<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!repartos.length} className="mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-[#171717] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36]">{repartos.length ? repartos.map((item) => <option key={item.id} value={item.id}>{monthNames[item.month]} {item.year}</option>) : <option value="">No hay periodos</option>}</select></label>
          <fieldset>
            <legend className="text-xs uppercase text-white/60">Umbral de alerta</legend>
            <div className="mt-2 flex min-h-11 rounded-lg border border-white/20 bg-[#171717] p-1" role="group" aria-label="Porcentaje de ingreso para alertas">
              {[70, 80, 90].map((threshold) => <button key={threshold} type="button" aria-pressed={budgetThreshold === threshold} onClick={() => setBudgetThreshold(threshold)} className={`min-w-0 flex-1 rounded-md px-2 text-xs tabular-nums transition ${budgetThreshold === threshold ? "bg-[#ddab36] text-[#121212]" : "text-white/60 hover:bg-white/10"}`}>{threshold}%</button>)}
            </div>
          </fieldset>
          {budgetAlert && <p role="status" className={`col-span-full text-xs ${budgetAlert === "critical" ? "text-rose-200" : "text-amber-200"}`}>El gasto operativo o la inversión alcanzó el umbral seleccionado.</p>}
          <button type="button" onClick={() => void exportSelectedPeriod()} disabled={!selectedReparto || loading || exporting} className="col-span-full inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#ddab36]/40 bg-[#ddab36]/10 px-4 py-2 text-xs uppercase text-[#f1cb74] transition hover:bg-[#ddab36]/20 disabled:cursor-not-allowed disabled:opacity-40"><Download size={16} aria-hidden="true" />{exporting ? "Preparando Excel..." : "Exportar reporte Excel"}</button>
        </div>
      </header>

      {error && <p role="alert" className="mt-5 rounded-lg border border-rose-400/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
      {loading ? <p className="mt-8 text-sm text-white/50">Cargando métricas en tiempo real...</p> : !selectedReparto ? <p className="mt-8 rounded-lg border border-dashed border-white/20 p-8 text-center text-sm text-white/55">Crea un reparto de fondos para comenzar a ver el análisis financiero.</p> : <>
        <p className="mt-6 text-xs uppercase text-white/45">Resumen de {selectedPeriodLabel}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard title="Tasa de ahorro / retención" icon={Wallet} alert={operatingExpenseAlert}>
            <p className="font-display text-3xl text-[#ddab36]">{metrics.savingsRate === null ? "--" : `${metrics.savingsRate.toFixed(1)}%`}</p>
            <p className="mt-3 text-xs leading-5 text-white/50">Ingreso operativo menos gastos, sobre el ingreso total del periodo.</p>
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="text-white/55">Gastos / ingresos en Bs</span><span className={operatingExpenseAlert ? "text-amber-200" : "text-white/70"}>{operatingExpenseRatio === null ? "Sin ingresos" : `${operatingExpenseRatio.toFixed(1)}%`}</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full transition-[width] ${operatingExpenseAlert ? "bg-amber-400" : "bg-[#ddab36]"}`} style={{ width: `${Math.max(0, Math.min(100, operatingExpenseRatio ?? 0))}%` }} /></div>
              {operatingExpenseAlert && <p role="status" className="mt-2 text-xs text-amber-200">Los gastos superan el umbral del {budgetThreshold}%.</p>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs"><div><p className="text-white/45">Ingresos</p><p className="mt-1 text-white">Bs {formatAmount(metrics.currentIncome)}</p></div><div><p className="text-white/45">Gastos operativos</p><p className="mt-1 text-white">Bs {formatAmount(metrics.currentExpenses)}</p></div></div>
          </MetricCard>

          <MetricCard title="Inversión vs. ganancia" icon={TrendingUp} className="sm:col-span-2 xl:col-span-1" alert={investmentAlert}>
            <div className="space-y-4">{(["Bs", "$"] as const).map((currency) => {
              const totals = metrics.investmentTotals[currency];
              const roi = totals.capitalRecovered > 0 ? totals.realizedGain / totals.capitalRecovered * 100 : null;
              return <div key={currency}>
                <div className="flex items-center justify-between gap-3 text-xs"><span className="text-white/55">{currency === "Bs" ? "Bolívares" : "Dólares"}</span><span className="text-[#ddab36]">ROI realizado {roi === null ? "--" : `${roi.toFixed(1)}%`}</span></div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10" aria-label={`ROI realizado ${currency}: ${roi === null ? "sin datos" : `${roi.toFixed(1)}%`}`}><span className="bg-[#ddab36] transition-[width]" style={{ width: `${roi === null ? 0 : Math.max(0, Math.min(100, roi / (100 + Math.max(0, roi)) * 100))}%` }} /></div>
                <p className="mt-2 text-xs leading-5 text-white/55">Capital recuperado {currency} {formatAmount(totals.capitalRecovered)} <span className="px-1 text-white/25">/</span> Ganancia neta {currency} {formatAmount(totals.realizedGain)}</p>
              </div>;
            })}</div>
            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="text-white/55">Inversión / ingreso del periodo</span><span className={investmentAlert ? "text-amber-200" : "text-white/70"}>Bs {investmentRatioBs === null ? "--" : `${investmentRatioBs.toFixed(1)}%`} · $ {investmentRatioUsd === null ? "--" : `${investmentRatioUsd.toFixed(1)}%`}</span></div>
              <div className="mt-2 flex h-2 gap-1"><span className="h-full flex-1 overflow-hidden rounded-full bg-white/10"><span className={`block h-full ${investmentAlert ? "bg-amber-400" : "bg-[#ddab36]"}`} style={{ width: `${Math.max(0, Math.min(100, investmentRatioBs ?? 0))}%` }} /></span><span className="h-full flex-1 overflow-hidden rounded-full bg-white/10"><span className={`block h-full ${investmentAlert ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.max(0, Math.min(100, investmentRatioUsd ?? 0))}%` }} /></span></div>
              {investmentAlert && <p role="status" className="mt-2 text-xs text-amber-200">La inversión supera el umbral del {budgetThreshold}% en su moneda.</p>}
            </div>
            <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">Calculado con capital recuperado y ganancias netas vinculados a ventas registradas en los repartos de fondos de este periodo.</p>
          </MetricCard>

          <MetricCard title="Reparto de activos" icon={ChartNoAxesCombined}>
            <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-white/45">Saldo local</p><p className="mt-1 text-lg text-white">Bs {formatAmount(metrics.bsBalance)}</p><p className="mt-1 text-xs text-[#ddab36]">{metrics.localAssetShare === null ? "--" : `${metrics.localAssetShare.toFixed(1)}% estimado`}</p></div><div><p className="text-xs text-white/45">Saldo extranjero</p><p className="mt-1 text-lg text-white">$ {formatAmount(metrics.usdBalance)}</p><p className="mt-1 text-xs text-[#ddab36]">{metrics.foreignAssetShare === null ? "--" : `${metrics.foreignAssetShare.toFixed(1)}% estimado`}</p></div></div>
            <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-white/10" aria-label="Proporción estimada de activos por moneda"><span className="bg-[#ddab36]" style={{ width: `${metrics.localAssetShare ?? 0}%` }} /><span className="bg-emerald-400" style={{ width: `${metrics.foreignAssetShare ?? 0}%` }} /></div>
            <p className="mt-3 text-[11px] leading-5 text-white/40">{metrics.averagePurchaseRate === null ? "Registra una compra de divisas para estimar el peso relativo." : `Estimación a Bs ${formatAmount(metrics.averagePurchaseRate)} por dólar (tasa histórica promedio de compra, no tasa de mercado actual).`}</p>
          </MetricCard>

          <MetricCard title="Compra acumulada de divisas" icon={Coins}>
            <div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-white/45">Dólares adquiridos</p><p className="mt-2 text-xl text-emerald-300">$ {formatAmount(metrics.dollarsBought)}</p></div><div><p className="text-xs text-white/45">Bolívares invertidos</p><p className="mt-2 text-xl text-[#ddab36]">Bs {formatAmount(metrics.bolivaresInvested)}</p></div></div>
            <p className="mt-5 border-t border-white/10 pt-3 text-xs text-white/50">Acumulado hasta {selectedPeriodLabel}. Tasa promedio: {metrics.averagePurchaseRate === null ? "Sin operaciones" : `Bs ${formatAmount(metrics.averagePurchaseRate)} / $`}</p>
          </MetricCard>

          <MetricCard title="Variación intermensual" icon={ArrowUpRight}>
            <div className="space-y-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-white/45">Ingresos</p><p className="mt-1 text-sm text-white">Bs {formatAmount(metrics.currentIncome)}</p></div><Variation value={metrics.incomeVariation} label="vs. mes anterior" /></div><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-white/45">Gastos</p><p className="mt-1 text-sm text-white">Bs {formatAmount(metrics.currentExpenses)}</p></div><Variation value={metrics.expenseVariation} label="vs. mes anterior" increaseIsPositive={false} /></div></div>
            <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">Comparación entre {selectedPeriodLabel} y {previousReparto ? `${monthNames[previousReparto.month]} ${previousReparto.year}` : "el periodo previo"}. Se excluyen traspasos y compras de divisas de ingresos/gastos operativos.</p>
          </MetricCard>

          <MetricCard title="Deudas y exposición" icon={Scale}>
            <p className="text-xs text-white/45">Pendientes con vencimiento en {selectedPeriodLabel}</p>
            <div className="mt-4 grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] gap-2 border-b border-white/10 pb-2 text-[10px] uppercase text-white/40">
              <span>Moneda</span><span className="text-right">Cobrar</span><span className="text-right">Pagar</span><span className="text-right">Neto</span>
            </div>
            {(["Bs", "$"] as const).map((currency) => {
              const receivable = debtTotals.receivable[currency];
              const payable = debtTotals.payable[currency];
              const net = receivable - payable;
              return <div key={currency} className="grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] gap-2 border-b border-white/5 py-3 text-xs tabular-nums last:border-0">
                <span className="text-white/70">{currency}</span>
                <span className="text-right text-emerald-300">{formatAmount(receivable)}</span>
                <span className="text-right text-rose-300">{formatAmount(payable)}</span>
                <span className={`text-right ${net > 0 ? "text-emerald-300" : net < 0 ? "text-rose-300" : "text-white/55"}`}>{net > 0 ? "+" : ""}{formatAmount(net)}</span>
              </div>;
            })}
            <p className="mt-2 text-[11px] leading-5 text-white/40">Neto positivo: más por cobrar. Neto negativo: más por pagar. Las monedas se muestran por separado.</p>
          </MetricCard>
        </div>
        <FinancialMetricsCharts
          monthlyData={monthlyChartData}
          incomeData={incomeChartData}
          expenseData={expenseChartData}
          debtData={activeDebtChartData}
        />
      </>}
    </section>
  </main>;
}

function getAlertLevel(ratios: number[], threshold: number): "warning" | "critical" | undefined {
  if (ratios.some((ratio) => ratio >= threshold + 20)) return "critical";
  if (ratios.some((ratio) => ratio >= threshold)) return "warning";
  return undefined;
}
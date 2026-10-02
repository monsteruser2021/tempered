"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, Coins, Scale, TrendingUp, Wallet } from "lucide-react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { useSession } from "./session-context";

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const bsCategories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];

type Distribution = { id: string; month: number; year: number };
type Debt = { type: "receivable" | "payable"; amount: number; currency: "Bs" | "$"; dueDate: string; paid: boolean };
type Income = { totalBs: number; percentages: Record<string, number>; isRollover: boolean };
type BsTransaction = { category: string; incomeBs: number; expenseBs: number; isTransfer: boolean; isCurrencyExchange: boolean; transferId: string; sourceSaleId: string };
type DollarTransaction = { category: string; incomeUsd: number; expenseUsd: number; isCurrencyExchange: boolean; transferId: string; sourceSaleId: string };
type PeriodData = { incomes: Income[]; bsTransactions: BsTransaction[]; dollarTransactions: DollarTransaction[] };
type CurrencyTotals = { capitalRecovered: number; realizedGain: number };
type DebtAmounts = Record<"Bs" | "$", number>;
type DebtTotals = { receivable: DebtAmounts; payable: DebtAmounts };

const emptyPeriodData = (): PeriodData => ({ incomes: [], bsTransactions: [], dollarTransactions: [] });
const emptyDebtTotals = (): DebtTotals => ({ receivable: { Bs: 0, "$": 0 }, payable: { Bs: 0, "$": 0 } });
const formatAmount = (value: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function getPreviousPeriod(distribution: Distribution | undefined, distributions: Distribution[]) {
  if (!distribution) return undefined;
  const previousDate = new Date(distribution.year, distribution.month - 1, 1);
  return distributions.find((item) => item.year === previousDate.getFullYear() && item.month === previousDate.getMonth());
}

function getMonthlyTotals(data: PeriodData | undefined) {
  if (!data) return { income: 0, expenses: 0 };
  const incomeFromDistribution = data.incomes
    .filter((item) => !item.isRollover)
    .reduce((sum, item) => sum + item.totalBs, 0);
  const dollarTransferIds = new Set(data.dollarTransactions.map((item) => item.transferId).filter(Boolean));
  const externalTransactions = data.bsTransactions.filter((item) => !item.isTransfer && !item.isCurrencyExchange && !(item.transferId && dollarTransferIds.has(item.transferId)));
  return {
    income: incomeFromDistribution + externalTransactions.reduce((sum, item) => sum + item.incomeBs, 0),
    expenses: externalTransactions.reduce((sum, item) => sum + item.expenseBs, 0),
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

function MetricCard({ title, icon: Icon, children, className = "" }: { title: string; icon: typeof Wallet; children: React.ReactNode; className?: string }) {
  return <article className={`min-w-0 rounded-lg border border-[#ddab36]/20 bg-[#161616]/85 p-5 shadow-lg shadow-black/20 sm:p-6 ${className}`}>
    <h2 className="flex items-center gap-2 text-xs uppercase text-white/65"><Icon size={16} className="text-[#ddab36]" aria-hidden="true" />{title}</h2>
    <div className="mt-5">{children}</div>
  </article>;
}

export default function FinancialMetrics() {
  const { userId } = useSession();
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [periodData, setPeriodData] = useState<Record<string, PeriodData>>({});
  const [loadedCollections, setLoadedCollections] = useState<Record<string, boolean>>({});
  const [debts, setDebts] = useState<Debt[]>([]);
  const [distributionsLoaded, setDistributionsLoaded] = useState(false);
  const [debtsLoaded, setDebtsLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, "distributions"), where("userId", "==", userId)),
      (snapshot) => {
        const next = snapshot.docs.map((item) => ({ id: item.id, month: Number(item.data().month), year: Number(item.data().year) }))
          .sort((first, second) => second.year - first.year || second.month - first.month);
        const now = new Date();
        const current = next.find((item) => item.year === now.getFullYear() && item.month === now.getMonth());
        setDistributions(next);
        setSelectedId((currentId) => currentId && next.some((item) => item.id === currentId) ? currentId : current?.id ?? next[0]?.id ?? "");
        setDistributionsLoaded(true);
      },
      () => { setError("No se pudieron cargar los periodos financieros."); setDistributionsLoaded(true); },
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, "debts"), where("userId", "==", userId)),
      (snapshot) => {
        setDebts(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            type: data.type === "payable" ? "payable" : "receivable",
            amount: Number(data.amount ?? 0),
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

  const selectedDistribution = distributions.find((item) => item.id === selectedId);
  const previousDistribution = getPreviousPeriod(selectedDistribution, distributions);

  useEffect(() => {
    if (!distributions.length) return;
    const detailedIds = new Set([selectedId, previousDistribution?.id].filter(Boolean));
    const unsubscribers: (() => void)[] = [];

    const updatePeriodData = <K extends keyof PeriodData>(id: string, key: K, value: PeriodData[K]) => {
      setPeriodData((current) => ({ ...current, [id]: { ...emptyPeriodData(), ...current[id], [key]: value } }));
      setLoadedCollections((current) => ({ ...current, [`${id}:${key}`]: true }));
    };

    distributions.forEach((distribution) => {
      const base = doc(db, "distributions", distribution.id);
      unsubscribers.push(onSnapshot(collection(base, "dollarTransactions"), (snapshot) => {
        updatePeriodData(distribution.id, "dollarTransactions", snapshot.docs.map((item) => ({
          category: String(item.data().category ?? ""),
          incomeUsd: Number(item.data().incomeUsd ?? 0),
          expenseUsd: Number(item.data().expenseUsd ?? 0),
          isCurrencyExchange: item.data().isCurrencyExchange === true,
          transferId: String(item.data().transferId ?? ""),
          sourceSaleId: String(item.data().sourceSaleId ?? ""),
        })));
      }, () => setError("No se pudieron cargar las compras de divisas.")));

      unsubscribers.push(onSnapshot(collection(base, "transactions"), (snapshot) => {
        updatePeriodData(distribution.id, "bsTransactions", snapshot.docs.map((item) => ({
          category: String(item.data().category ?? ""),
          incomeBs: Number(item.data().incomeBs ?? 0),
          expenseBs: Number(item.data().expenseBs ?? 0),
          isTransfer: item.data().isTransfer === true || Boolean(item.data().transferId),
          isCurrencyExchange: item.data().isCurrencyExchange === true,
          transferId: String(item.data().transferId ?? ""),
          sourceSaleId: String(item.data().sourceSaleId ?? ""),
        })));
      }, () => setError("No se pudieron cargar los movimientos del periodo.")));

      if (!detailedIds.has(distribution.id)) return;
      unsubscribers.push(onSnapshot(collection(base, "incomes"), (snapshot) => {
        updatePeriodData(distribution.id, "incomes", snapshot.docs.map((item) => ({
          totalBs: Number(item.data().totalBs ?? 0),
          percentages: (item.data().percentages ?? {}) as Record<string, number>,
          isRollover: item.data().isRollover === true,
        })));
      }, () => setError("No se pudieron cargar los ingresos del periodo.")));
    });

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [distributions, previousDistribution?.id, selectedId]);

  const selectedData = periodData[selectedId] ?? emptyPeriodData();
  const previousData = previousDistribution ? periodData[previousDistribution.id] : undefined;
  const currentTotals = getMonthlyTotals(selectedData);
  const previousTotals = getMonthlyTotals(previousData);
  const debtTotals = useMemo(() => {
    if (!selectedDistribution) return emptyDebtTotals();
    const monthPrefix = `${selectedDistribution.year}-${String(selectedDistribution.month + 1).padStart(2, "0")}`;
    return debts.reduce<DebtTotals>((totals, debt) => {
      if (!debt.paid && debt.dueDate.startsWith(`${monthPrefix}-`)) totals[debt.type][debt.currency] += debt.amount;
      return totals;
    }, emptyDebtTotals());
  }, [debts, selectedDistribution]);

  const metrics = useMemo(() => {
    const currentIncome = currentTotals.income;
    const currentExpenses = currentTotals.expenses;
    const bsBalance = selectedData.incomes.reduce((sum, income) => sum + bsCategories.reduce((allocated, category) => allocated + income.totalBs * Number(income.percentages[category] ?? 0) / 100, 0), 0)
      + selectedData.bsTransactions.reduce((sum, transaction) => sum + transaction.incomeBs - transaction.expenseBs, 0);
    const usdBalance = selectedData.dollarTransactions.reduce((sum, transaction) => sum + transaction.incomeUsd - transaction.expenseUsd, 0);
    const throughSelectedPeriod = selectedDistribution
      ? distributions.filter((item) => item.year < selectedDistribution.year || (item.year === selectedDistribution.year && item.month <= selectedDistribution.month))
      : [];
    const exchanges = throughSelectedPeriod.map((distribution) => {
      const data = periodData[distribution.id] ?? emptyPeriodData();
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
      savingsRate: currentIncome > 0 ? ((currentIncome - currentExpenses) / currentIncome) * 100 : null,
      incomeVariation: getVariation(currentIncome, previousTotals.income, Boolean(previousDistribution)),
      expenseVariation: getVariation(currentExpenses, previousTotals.expenses, Boolean(previousDistribution)),
      bsBalance,
      usdBalance,
      dollarsBought,
      bolivaresInvested,
      averagePurchaseRate,
      localAssetShare: comparableAssets > 0 ? (localAssets / comparableAssets) * 100 : null,
      foreignAssetShare: comparableAssets > 0 ? (foreignAssetsInBs / comparableAssets) * 100 : null,
      investmentTotals,
    };
  }, [currentTotals, distributions, periodData, previousDistribution, previousTotals, selectedData, selectedDistribution]);

  if (!userId) return <main className="flex min-h-screen items-center justify-center px-5 py-10"><section className="w-full max-w-3xl rounded-xl border border-white/15 bg-black/30 p-8 text-center text-white"><p className="text-sm text-white/70">Inicia sesión para consultar tus métricas financieras.</p><BackButton href="/isorropia">Volver a Isorropia</BackButton></section></main>;

  const periodLoading = Boolean(selectedId) && ["incomes", "bsTransactions", "dollarTransactions"].some((key) => !loadedCollections[`${selectedId}:${key}`]);
  const historyLoading = distributions.some((item) => !loadedCollections[`${item.id}:dollarTransactions`] || !loadedCollections[`${item.id}:bsTransactions`]);
  const previousLoading = Boolean(previousDistribution) && ["incomes", "bsTransactions"].some((key) => !loadedCollections[`${previousDistribution?.id}:${key}`]);
  const loading = !distributionsLoaded || !debtsLoaded || periodLoading || previousLoading || historyLoading;
  const selectedPeriodLabel = selectedDistribution ? `${monthNames[selectedDistribution.month]} ${selectedDistribution.year}` : "Sin distribución";

  return <main className="min-h-screen w-full px-4 py-8 text-white sm:px-6 sm:py-10">
    <section className="mx-auto w-full max-w-7xl">
      <BackButton href="/isorropia">Volver a Isorropia</BackButton>
      <header className="mt-8 flex flex-col gap-5 border-b border-[#ddab36]/20 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase text-white/45">Isorropia / Análisis</p><h1 className="font-display mt-3 text-2xl uppercase text-[#ddab36] sm:text-4xl">Métricas financieras</h1><p className="mt-3 text-sm text-white/55">Ingresos, retención, activos y rendimiento de inversión.</p></div>
        <label className="w-full text-xs uppercase text-white/60 sm:max-w-64">Periodo analizado<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!distributions.length} className="mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-[#171717] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36]">{distributions.length ? distributions.map((item) => <option key={item.id} value={item.id}>{monthNames[item.month]} {item.year}</option>) : <option value="">No hay periodos</option>}</select></label>
      </header>

      {error && <p role="alert" className="mt-5 rounded-lg border border-rose-400/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
      {loading ? <p className="mt-8 text-sm text-white/50">Cargando métricas en tiempo real...</p> : !selectedDistribution ? <p className="mt-8 rounded-lg border border-dashed border-white/20 p-8 text-center text-sm text-white/55">Crea una distribución para comenzar a ver el análisis financiero.</p> : <>
        <p className="mt-6 text-xs uppercase text-white/45">Resumen de {selectedPeriodLabel}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard title="Tasa de ahorro / retención" icon={Wallet}>
            <p className="font-display text-3xl text-[#ddab36]">{metrics.savingsRate === null ? "--" : `${metrics.savingsRate.toFixed(1)}%`}</p>
            <p className="mt-3 text-xs leading-5 text-white/50">Ingreso operativo menos gastos, sobre el ingreso total del periodo.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs"><div><p className="text-white/45">Ingresos</p><p className="mt-1 text-white">Bs {formatAmount(metrics.currentIncome)}</p></div><div><p className="text-white/45">Gastos operativos</p><p className="mt-1 text-white">Bs {formatAmount(metrics.currentExpenses)}</p></div></div>
          </MetricCard>

          <MetricCard title="Inversión vs. ganancia" icon={TrendingUp} className="sm:col-span-2 xl:col-span-1">
            <div className="space-y-4">{(["Bs", "$"] as const).map((currency) => {
              const totals = metrics.investmentTotals[currency];
              const roi = totals.capitalRecovered > 0 ? totals.realizedGain / totals.capitalRecovered * 100 : null;
              return <div key={currency}>
                <div className="flex items-center justify-between gap-3 text-xs"><span className="text-white/55">{currency === "Bs" ? "Bolívares" : "Dólares"}</span><span className="text-[#ddab36]">ROI realizado {roi === null ? "--" : `${roi.toFixed(1)}%`}</span></div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10" aria-label={`ROI realizado ${currency}: ${roi === null ? "sin datos" : `${roi.toFixed(1)}%`}`}><span className="bg-[#ddab36] transition-[width]" style={{ width: `${roi === null ? 0 : Math.max(0, Math.min(100, roi / (100 + Math.max(0, roi)) * 100))}%` }} /></div>
                <p className="mt-2 text-xs leading-5 text-white/55">Capital recuperado {currency} {formatAmount(totals.capitalRecovered)} <span className="px-1 text-white/25">/</span> Ganancia neta {currency} {formatAmount(totals.realizedGain)}</p>
              </div>;
            })}</div>
            <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">Calculado con capital recuperado y ganancias netas vinculados a ventas registradas en las distribuciones de este periodo.</p>
          </MetricCard>

          <MetricCard title="Distribución de activos" icon={ChartNoAxesCombined}>
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
            <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">Comparación entre {selectedPeriodLabel} y {previousDistribution ? `${monthNames[previousDistribution.month]} ${previousDistribution.year}` : "el periodo previo"}. Se excluyen traspasos y compras de divisas de ingresos/gastos operativos.</p>
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
      </>}
    </section>
  </main>;
}
"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type FinancialCurrency = "Bs" | "$";
export type MonthlyChartPoint = {
  period: string;
  incomeBs: number;
  expenseBs: number;
  incomeUsd: number;
  expenseUsd: number;
};
export type ExpenseCategoryPoint = { category: string; bs: number; usd: number };
export type ActiveDebtPoint = {
  title: string;
  type: "receivable" | "payable";
  currency: FinancialCurrency;
  amount: number;
};

type Props = {
  monthlyData: MonthlyChartPoint[];
  incomeData: ExpenseCategoryPoint[];
  expenseData: ExpenseCategoryPoint[];
  debtData: ActiveDebtPoint[];
};

const chartColors = [
  { color: "#168bff", highlight: "#8bc8ff" },
  { color: "#ec274f", highlight: "#ff8ba1" },
  { color: "#14c985", highlight: "#83f0c4" },
  { color: "#8b5cf6", highlight: "#c4a8ff" },
  { color: "#ff4fa3", highlight: "#ffa3d0" },
  { color: "#ff7a1a", highlight: "#ffbd78" },
  { color: "#ffd21f", highlight: "#fff19b" },
  { color: "#17c7d4", highlight: "#91f3f5" },
];
const compactAmount = (value: number, currency: FinancialCurrency) =>
  `${currency} ${new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
const fullAmount = (value: number, currency: FinancialCurrency) =>
  `${currency} ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const tooltipStyle = {
  backgroundColor: "#17130b",
  border: "1px solid #d6a52b80",
  borderRadius: 8,
  color: "#fff7e0",
};

function useCompactViewport() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const updateViewport = () => setIsCompact(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  return isCompact;
}

function CurrencyPicker({ value, onChange }: { value: FinancialCurrency; onChange: (value: FinancialCurrency) => void }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-amber-200/15 bg-[#100e09] p-1" role="group" aria-label="Moneda de las gráficas">
      {(["Bs", "$"] as const).map((currency) => (
        <button
          key={currency}
          type="button"
          onClick={() => onChange(currency)}
          aria-pressed={currency === value}
          className={`min-h-9 min-w-12 rounded-md px-3 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${currency === value ? "bg-gradient-to-b from-amber-200 to-amber-500 font-semibold text-[#211702]" : "text-white/65 hover:bg-white/10"}`}
        >
          {currency}
        </button>
      ))}
    </div>
  );
}

function EmptyChart({ children }: { children: string }) {
  return <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-white/50">{children}</p>;
}

function CategoryDonut({
  data,
  currency,
  kind,
}: {
  data: ExpenseCategoryPoint[];
  currency: FinancialCurrency;
  kind: "income" | "expense";
}) {
  const amounts = data
    .map((item, index) => ({ name: item.category, value: currency === "Bs" ? item.bs : item.usd, colorIndex: index }))
    .filter((item) => item.value > 0);
  const total = amounts.reduce((sum, item) => sum + item.value, 0);
  const gradientPrefix = `${kind}-${currency === "Bs" ? "bs" : "usd"}-gradient`;
  const chartName = `${kind === "income" ? "incomes" : "expenses"}-${currency === "Bs" ? "bs" : "usd"}`;
  const title = kind === "income" ? "Ingresos por Categoría" : "Gastos por Categoría";
  const currencyLabel = currency === "Bs" ? "BS" : currency;

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-amber-300/20 bg-gradient-to-br from-[#211a0d] via-[#17140e] to-[#100f0d] p-3 shadow-lg shadow-black/20 sm:p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-100/90">{title} - {currencyLabel}</h3>
      <div className="mt-2 grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div data-financial-chart={chartName} className="relative mx-auto h-56 w-full min-w-0 max-w-[300px] sm:h-64 sm:max-w-none">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {chartColors.map((palette, index) => (
                  <linearGradient key={palette.color} id={`${gradientPrefix}-${index}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={palette.highlight} />
                    <stop offset="100%" stopColor={palette.color} />
                  </linearGradient>
                ))}
              </defs>
              <Pie data={amounts} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="52%" outerRadius="82%" paddingAngle={3} stroke="#17130b" strokeWidth={2} isAnimationActive={false}>
                {amounts.map((item) => <Cell key={item.name} fill={`url(#${gradientPrefix}-${item.colorIndex % chartColors.length})`} />)}
              </Pie>
              <Tooltip
                formatter={(value) => fullAmount(Number(value), currency)}
                contentStyle={tooltipStyle}
                itemStyle={{ color: "#fff1c2" }}
              />
            </PieChart>
          </ResponsiveContainer>
          {amounts.length === 0 && <EmptyChart>{kind === "income" ? "Sin ingresos registrados en esta moneda." : "Sin gastos registrados en esta moneda."}</EmptyChart>}
        </div>
        <ul className="grid min-w-0 grid-cols-1 gap-1.5 sm:gap-2" aria-label={`${title} en ${currency}`}>
          {amounts.map((item) => {
            const percentage = total > 0 ? item.value / total * 100 : 0;
            const palette = chartColors[item.colorIndex % chartColors.length];
            return (
              <li key={item.name} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-[11px] sm:text-xs">
                <span className="flex min-w-0 items-center gap-2 text-white/80">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: palette.color }} aria-hidden="true" />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-amber-100">
                  {fullAmount(item.value, currency)} <span className="text-white/55">({percentage.toFixed(1)}%)</span>
                </span>
              </li>
            );
          })}
          {amounts.length === 0 && <li className="text-xs text-white/50">No hay importes que detallar.</li>}
        </ul>
      </div>
    </article>
  );
}

export default function FinancialMetricsCharts({ monthlyData, incomeData, expenseData, debtData }: Props) {
  const [currency, setCurrency] = useState<FinancialCurrency>("Bs");
  const isCompact = useCompactViewport();
  const activeDebts = debtData
    .filter((item) => item.currency === currency && item.amount > 0)
    .sort((first, second) => second.amount - first.amount)
    .slice(0, 8);
  const visibleMonthlyData = isCompact ? monthlyData.slice(-4) : monthlyData;

  return (
    <section className="mt-8 min-w-0" aria-label="Gráficas financieras">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-100">Visualización financiera</h2>
          <p className="mt-1 text-xs text-white/50">Selecciona la moneda para actualizar las dos categorías y las comparativas.</p>
        </div>
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </div>

      <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <CategoryDonut data={incomeData} currency={currency} kind="income" />
        <CategoryDonut data={expenseData} currency={currency} kind="expense" />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <article className="min-w-0 overflow-hidden rounded-xl border border-amber-300/20 bg-gradient-to-br from-[#211a0d] via-[#17140e] to-[#100f0d] p-3 shadow-lg shadow-black/20 sm:p-5">
          <h3 className="text-xs font-semibold uppercase text-amber-100/80">Ingresos vs. egresos mensuales · {currency}</h3>
          <div data-financial-chart="monthly" className="relative mt-3 h-72 min-w-0 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleMonthlyData} margin={{ top: isCompact ? 25 : 12, right: isCompact ? 4 : 12, left: -12, bottom: 4 }} barGap={isCompact ? 2 : 5}>
                <defs>
                  <linearGradient id="income-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff0a8" />
                    <stop offset="100%" stopColor="#d99b18" />
                  </linearGradient>
                  <linearGradient id="expense-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff9b72" />
                    <stop offset="100%" stopColor="#a63f24" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f4ce7330" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: "#f6e8c2", fontSize: isCompact ? 9 : 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#e7d5ad", fontSize: 9 }} axisLine={false} tickLine={false} width={49} tickFormatter={(value: number) => new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 }).format(value)} />
                {!isCompact && (
                  <Tooltip
                    formatter={(value) => fullAmount(Number(value), currency)}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: "#fff1c2" }}
                  />
                )}
                <Bar dataKey={currency === "Bs" ? "incomeBs" : "incomeUsd"} name="Ingresos" fill="url(#income-gradient)" radius={[4, 4, 0, 0]} maxBarSize={isCompact ? 22 : 34} isAnimationActive={false}>
                  {isCompact && <LabelList dataKey={currency === "Bs" ? "incomeBs" : "incomeUsd"} position="top" formatter={(value) => compactAmount(Number(value), currency)} fill="#fff0b3" fontSize={8} fontWeight={700} />}
                </Bar>
                <Bar dataKey={currency === "Bs" ? "expenseBs" : "expenseUsd"} name="Egresos" fill="url(#expense-gradient)" radius={[4, 4, 0, 0]} maxBarSize={isCompact ? 22 : 34} isAnimationActive={false}>
                  {isCompact && <LabelList dataKey={currency === "Bs" ? "expenseBs" : "expenseUsd"} position="top" formatter={(value) => compactAmount(Number(value), currency)} fill="#ffd6a0" fontSize={8} fontWeight={700} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {visibleMonthlyData.length === 0 && <EmptyChart>Sin datos mensuales.</EmptyChart>}
          </div>
          {isCompact && visibleMonthlyData.length > 0 && (
            <ul className="mt-2 grid grid-cols-1 gap-1.5 border-t border-amber-200/10 pt-2" aria-label={`Valores mensuales de ingresos y egresos en ${currency}`}>
              {visibleMonthlyData.map((item) => (
                <li key={item.period} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[11px] tabular-nums">
                  <span className="truncate text-white/65">{item.period}</span>
                  <span className="text-amber-100">Ing. {fullAmount(currency === "Bs" ? item.incomeBs : item.incomeUsd, currency)}</span>
                  <span className="text-orange-200">Egr. {fullAmount(currency === "Bs" ? item.expenseBs : item.expenseUsd, currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/70">
            <span><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-[#e9b949]" aria-hidden="true" />Ingresos · dorado</span>
            <span><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-[#c65331]" aria-hidden="true" />Egresos · terracota</span>
          </div>
        </article>

        <article className="min-w-0 overflow-hidden rounded-xl border border-amber-300/20 bg-gradient-to-br from-[#211a0d] via-[#17140e] to-[#100f0d] p-3 shadow-lg shadow-black/20 sm:col-span-2 sm:p-5">
          <h3 className="text-xs font-semibold uppercase text-amber-100/80">Deudas activas por saldo pendiente · {currency}</h3>
          <div data-financial-chart="debts" className="relative mt-3 h-80 min-w-0 sm:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeDebts} layout="vertical" margin={{ top: 8, right: isCompact ? 72 : 92, left: 2, bottom: 4 }}>
                <defs>
                  <linearGradient id="debt-receivable-gradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#c48612" />
                    <stop offset="100%" stopColor="#ffe17b" />
                  </linearGradient>
                  <linearGradient id="debt-payable-gradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#963f27" />
                    <stop offset="100%" stopColor="#f28a55" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f4ce7330" strokeDasharray="3 5" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#e7d5ad", fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) => new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
                  domain={[0, (max: number) => max * 1.3]}
                />
                <YAxis
                  type="category"
                  dataKey="title"
                  width={isCompact ? 88 : 150}
                  tick={{ fill: "#f6e8c2", fontSize: isCompact ? 9 : 10 }}
                  tickFormatter={(value: string) => value.length > (isCompact ? 14 : 24) ? `${value.slice(0, isCompact ? 13 : 23)}…` : value}
                  axisLine={false}
                  tickLine={false}
                />
                {!isCompact && (
                  <Tooltip
                    formatter={(value) => fullAmount(Number(value), currency)}
                    labelFormatter={(label, payload) => `${label} · ${payload[0]?.payload.type === "payable" ? "Por pagar" : "Por cobrar"}`}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: "#fff1c2" }}
                  />
                )}
                <Bar dataKey="amount" name="Saldo pendiente" radius={[0, 5, 5, 0]} isAnimationActive={false}>
                  {activeDebts.map((item, index) => (
                    <Cell key={`${item.title}-${index}`} fill={item.type === "payable" ? "url(#debt-payable-gradient)" : "url(#debt-receivable-gradient)"} />
                  ))}
                  {isCompact && <LabelList dataKey="amount" position="right" formatter={(value) => compactAmount(Number(value), currency)} fill="#fff0b3" fontSize={9} fontWeight={700} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {activeDebts.length === 0 && <EmptyChart>No hay deudas activas en esta moneda.</EmptyChart>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/70" aria-label="Colores por tipo de deuda">
            <span><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-[#f0c64f]" aria-hidden="true" />Por cobrar · dorado</span>
            <span><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-[#d96a3d]" aria-hidden="true" />Por pagar · terracota</span>
            <span className="text-white/45">Se muestran hasta ocho saldos activos.</span>
          </div>
          <ul className="sr-only" aria-label={`Deudas ordenadas por saldo pendiente en ${currency}`}>
            {activeDebts.map((item, index) => (
              <li key={`${item.title}-${index}`}>{item.title}, {item.type === "payable" ? "por pagar" : "por cobrar"}: {fullAmount(item.amount, currency)}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

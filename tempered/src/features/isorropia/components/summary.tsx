"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { useSession } from "./session-context";
import GlobalBalanceSummary from "./global-balance-summary";

const bsCategories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];
const dollarCategories = ["Inversiones", "Ahorro", "Fondo de emergencia"];
const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Currency = "bs" | "usd";
type Reparto = { id: string; month: number; year: number };
type Transaction = { category: string; income: number; expense: number };
type Income = { total: number; percentages: Record<string, number> };

export default function Summary() {
  const { userId: currentUserId } = useSession();
  const [currency, setCurrency] = useState<Currency>("bs");
  const [currencyDirection, setCurrencyDirection] = useState<"forward" | "back">("forward");
  const [repartos, setRepartos] = useState<Reparto[]>([]);
  const [repartoId, setRepartoId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [transactionsKey, setTransactionsKey] = useState("");
  const [incomesKey, setIncomesKey] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const categories = currency === "bs" ? bsCategories : dollarCategories;
  const transactionCollection = currency === "bs" ? "transactions" : "dollarTransactions";
  const incomeField = currency === "bs" ? "incomeBs" : "incomeUsd";
  const expenseField = currency === "bs" ? "expenseBs" : "expenseUsd";
  const symbol = currency === "bs" ? "Bs" : "$";

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "") return;
    const userId = currentUserId.trim();
    return onSnapshot(
      query(collection(db, "distributions"), where("userId", "==", userId)),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => ({ id: item.id, month: Number(item.data().month), year: Number(item.data().year) }))
          .sort((first, second) => second.year - first.year || second.month - first.month);
        setRepartos(next);
        const now = new Date();
        const currentMonth = next.find((item) => item.year === now.getFullYear() && item.month === now.getMonth());
        setRepartoId(currentMonth?.id ?? next[0]?.id ?? "");
      },
      () => setErrorMsg("No se pudieron cargar los periodos disponibles."),
    );
  }, [currentUserId]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "" || !repartoId) return;
    const dataKey = `${currency}:${repartoId}`;

    const stopTransactions = onSnapshot(
      collection(db, "distributions", repartoId, transactionCollection),
      (snapshot) => {
        setTransactions(snapshot.docs.map((item) => ({
          category: String(item.data().category ?? ""),
          income: Number(item.data()[incomeField] ?? 0),
          expense: Number(item.data()[expenseField] ?? 0),
        })));
        setTransactionsKey(dataKey);
      },
      () => setErrorMsg("No se pudieron cargar los saldos."),
    );

    if (currency !== "bs") return stopTransactions;
    const stopIncomes = onSnapshot(
      collection(db, "distributions", repartoId, "incomes"),
      (snapshot) => {
        setIncomes(snapshot.docs.map((item) => ({
          total: Number(item.data().totalBs ?? 0),
          percentages: (item.data().percentages ?? {}) as Record<string, number>,
        })));
        setIncomesKey(dataKey);
      },
      () => setErrorMsg("No se pudieron cargar los ingresos asignados."),
    );
    return () => { stopTransactions(); stopIncomes(); };
  }, [currentUserId, currency, repartoId, expenseField, incomeField, transactionCollection]);

  const balances = useMemo(() => categories.map((category) => {
    const dataKey = `${currency}:${repartoId}`;
    const manual = transactionsKey === dataKey ? transactions
      .filter((item) => item.category === category)
      .reduce((sum, item) => sum + item.income - item.expense, 0) : 0;
    const initial = currency === "bs" && incomesKey === dataKey
      ? incomes.reduce((sum, income) => sum + income.total * Number(income.percentages[category] ?? 0) / 100, 0)
      : 0;
    return { category, balance: initial + manual };
  }), [categories, currency, repartoId, incomes, incomesKey, transactions, transactionsKey]);

  const selectedReparto = repartos.find((item) => item.id === repartoId);
  const changeCurrency = (next: Currency) => {
    if (next === currency) return;
    setCurrencyDirection(next === "usd" ? "forward" : "back");
    setCurrency(next);
  };

  if (!currentUserId) return <Message text="Inicia sesión para acceder al resumen." />;

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <section className="w-full max-w-3xl rounded-3xl border border-white/25 bg-white/10 p-5 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <BackButton href="/isorropia">Volver al menú</BackButton>
        <h1 className="font-display mt-8 text-center text-2xl uppercase tracking-[0.08em] text-[#adc0fa] sm:text-4xl">Resumen</h1>
        {selectedReparto && currentUserId && <GlobalBalanceSummary key={`${currentUserId}-${selectedReparto.id}`} userId={currentUserId} repartoId={selectedReparto.id} />}
        <div className="mx-auto mt-8 flex max-w-xl rounded-xl border border-white/20 bg-black/15 p-1" role="group" aria-label="Moneda">
          <button type="button" onClick={() => changeCurrency("bs")} aria-pressed={currency === "bs"} className={`min-h-11 transform-gpu flex-1 rounded-lg text-xs uppercase transition-[transform,background-color] duration-200 active:scale-95 ${currency === "bs" ? "bg-[#adc0fa] text-[#121212]" : "text-white/70 hover:bg-white/10"}`}>Bolívares (Bs)</button>
          <button type="button" onClick={() => changeCurrency("usd")} aria-pressed={currency === "usd"} className={`min-h-11 transform-gpu flex-1 rounded-lg text-xs uppercase transition-[transform,background-color] duration-200 active:scale-95 ${currency === "usd" ? "bg-[#adc0fa] text-[#121212]" : "text-white/70 hover:bg-white/10"}`}>Dólares ($)</button>
        </div>
        {errorMsg && <p className="mx-auto mt-5 max-w-xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-xs text-red-200">{errorMsg}</p>}
        {!selectedReparto ? (
          <p className="mx-auto mt-8 max-w-xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">No hay un reparto de fondos mensual disponible.</p>
        ) : (
          <section key={`${currency}-${repartoId}`} className={`mx-auto mt-8 max-w-xl rounded-2xl border border-white/15 bg-black/15 p-5 sm:p-7 ${currencyDirection === "forward" ? "slide-panel-forward" : "slide-panel-back"}`}>
            <div className="flex flex-col gap-2 border-b border-white/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm uppercase tracking-[0.08em] text-white/90">Saldos disponibles</h2>
              <p className="text-xs text-white/50">{monthNames[selectedReparto.month]} {selectedReparto.year}</p>
            </div>
            <div className="mt-4 divide-y divide-white/10">
              {balances.map((item) => (
                <div key={item.category} className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm">
                  <span className="text-white/85">{item.category}</span>
                  <span className={`shrink-0 tabular-nums ${item.balance > 0 ? "text-emerald-300" : item.balance < 0 ? "text-red-300" : "text-white/50"}`}>
                    {symbol} {item.balance.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center px-4 py-8"><section className="w-full max-w-4xl rounded-3xl border border-white/25 bg-white/10 p-8 text-center text-white shadow-2xl shadow-black/30 backdrop-blur-xl"><p className="text-sm text-white/70">{text}</p><BackButton href="/isorropia">Volver al menú</BackButton></section></main>;
}
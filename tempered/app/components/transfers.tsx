"use client";

import BackButton from "./back-button";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useSession } from "./session-context";

const bsCategories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];
const dollarCategories = ["Inversiones", "Ahorro", "Fondo de emergencia"];
const exchangeOriginCategories = ["Ahorro", "Inversión"];
const exchangeDestinationCategories = ["Ahorro", "Inversiones"];
const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
type Currency = "bs" | "usd";
type Distribution = { id: string; month: number; year: number };
type Transaction = { category: string; income: number; expense: number };
type Income = { total: number; percentages: Record<string, number> };
type ExchangeTransaction = { category: string; incomeBs: number; expenseBs: number };
type ExchangeRow = { id: string; date: string; description: string; transferId: string; isCurrencyExchange: boolean; exchangeRate: number; spentBs: number; purchasedUsd: number };
type ExchangeAudit = Omit<ExchangeRow, "transferId" | "isCurrencyExchange">;

export default function Transfers() {
  const { userId: currentUserId } = useSession();
  const [currency, setCurrency] = useState<Currency>("bs");
  const [currencyDirection, setCurrencyDirection] = useState<"forward" | "back">("forward");
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [distributionId, setDistributionId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [exchangeTransactions, setExchangeTransactions] = useState<ExchangeTransaction[]>([]);
  const [exchangeIncomes, setExchangeIncomes] = useState<Income[]>([]);
  const [exchangeAudit, setExchangeAudit] = useState<ExchangeAudit[]>([]);
  const [exchangeAuditPeriod, setExchangeAuditPeriod] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().slice(0, 10));
  const [exchangeOrigin, setExchangeOrigin] = useState("");
  const [exchangeDestination, setExchangeDestination] = useState("");
  const [exchangeDescription, setExchangeDescription] = useState("");
  const [exchangeUsd, setExchangeUsd] = useState("");
  const [exchangeBs, setExchangeBs] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = currency === "bs" ? bsCategories : dollarCategories;
  const transactionCollection = currency === "bs" ? "transactions" : "dollarTransactions";
  const incomeField = currency === "bs" ? "incomeBs" : "incomeUsd";
  const expenseField = currency === "bs" ? "expenseBs" : "expenseUsd";
  const symbol = currency === "bs" ? "Bs" : "$";

  useEffect(() => {
    if (!currentUserId) return;
    return onSnapshot(query(collection(db, "distributions"), where("userId", "==", currentUserId)), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, month: Number(item.data().month), year: Number(item.data().year) })).sort((a, b) => b.year - a.year || b.month - a.month);
      setDistributions(next);
      setDistributionId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    }, () => setErrorMsg("No se pudieron cargar los periodos."));
  }, [currentUserId]);

  useEffect(() => {
    if (!distributionId) return;
    const stopTransactions = onSnapshot(collection(db, "distributions", distributionId, transactionCollection), (snapshot) => {
      setTransactions(snapshot.docs.map((item) => ({ category: String(item.data().category ?? ""), income: Number(item.data()[incomeField] ?? 0), expense: Number(item.data()[expenseField] ?? 0) })));
    }, () => setErrorMsg("No se pudieron cargar los saldos."));
    if (currency !== "bs") {
      return stopTransactions;
    }
    const stopIncomes = onSnapshot(collection(db, "distributions", distributionId, "incomes"), (snapshot) => {
      setIncomes(snapshot.docs.map((item) => ({ total: Number(item.data().totalBs ?? 0), percentages: (item.data().percentages ?? {}) as Record<string, number> })));
    }, () => setErrorMsg("No se pudieron cargar los ingresos distribuidos."));
    return () => { stopTransactions(); stopIncomes(); };
  }, [currency, distributionId, expenseField, incomeField, transactionCollection]);

  useEffect(() => {
    if (!distributionId) return;
    const stopTransactions = onSnapshot(collection(db, "distributions", distributionId, "transactions"), (snapshot) => {
      setExchangeTransactions(snapshot.docs.map((item) => ({ category: String(item.data().category ?? ""), incomeBs: Number(item.data().incomeBs ?? 0), expenseBs: Number(item.data().expenseBs ?? 0) })));
    }, () => setErrorMsg("No se pudieron cargar los saldos en bolívares."));
    const stopIncomes = onSnapshot(collection(db, "distributions", distributionId, "incomes"), (snapshot) => {
      setExchangeIncomes(snapshot.docs.map((item) => ({ total: Number(item.data().totalBs ?? 0), percentages: (item.data().percentages ?? {}) as Record<string, number> })));
    }, () => setErrorMsg("No se pudieron cargar los ingresos distribuidos."));
    return () => { stopTransactions(); stopIncomes(); };
  }, [distributionId]);

  useEffect(() => {
    if (!distributionId) return;
    let bolivarRows: ExchangeRow[] = [];
    let dollarRows: ExchangeRow[] = [];
    const rebuildAudit = () => {
      const bolivarTransferIds = new Set(bolivarRows.map((item) => item.transferId).filter(Boolean));
      const bolivarByTransfer = new Map(bolivarRows.filter((item) => item.transferId).map((item) => [item.transferId, item]));
      const entries = dollarRows
        .filter((item) => item.isCurrencyExchange || (item.transferId && bolivarTransferIds.has(item.transferId)))
        .map((item) => {
          const origin = bolivarByTransfer.get(item.transferId);
          const spentBs = item.spentBs || origin?.spentBs || 0;
          const purchasedUsd = item.purchasedUsd || 0;
          return {
            id: item.id,
            date: item.date,
            description: item.description,
            spentBs,
            purchasedUsd,
            exchangeRate: item.exchangeRate || origin?.exchangeRate || (purchasedUsd > 0 ? spentBs / purchasedUsd : 0),
          };
        })
        .sort((first, second) => second.date.localeCompare(first.date));
      setExchangeAudit(entries);
      setExchangeAuditPeriod(distributionId);
    };
    const stopBolivarRows = onSnapshot(collection(db, "distributions", distributionId, "transactions"), (snapshot) => {
      bolivarRows = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          date: String(data.date ?? ""),
          description: String(data.description ?? ""),
          transferId: String(data.transferId ?? ""),
          isCurrencyExchange: data.isCurrencyExchange === true,
          exchangeRate: Number(data.exchangeRate ?? 0),
          spentBs: Number(data.spentBs ?? data.expenseBs ?? 0),
          purchasedUsd: Number(data.purchasedUsd ?? 0),
        };
      });
      rebuildAudit();
    }, () => setErrorMsg("No se pudo cargar la bitácora de divisas."));
    const stopDollarRows = onSnapshot(collection(db, "distributions", distributionId, "dollarTransactions"), (snapshot) => {
      dollarRows = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          date: String(data.date ?? ""),
          description: String(data.description ?? ""),
          transferId: String(data.transferId ?? ""),
          isCurrencyExchange: data.isCurrencyExchange === true,
          exchangeRate: Number(data.exchangeRate ?? 0),
          spentBs: Number(data.spentBs ?? 0),
          purchasedUsd: Number(data.purchasedUsd ?? data.incomeUsd ?? 0),
        };
      });
      rebuildAudit();
    }, () => setErrorMsg("No se pudo cargar la bitácora de divisas."));
    return () => { stopBolivarRows(); stopDollarRows(); };
  }, [distributionId]);

  const balances = useMemo(() => categories.map((category) => {
    const manual = transactions.filter((item) => item.category === category).reduce((sum, item) => sum + item.income - item.expense, 0);
    const initial = currency === "bs" ? incomes.reduce((sum, income) => sum + income.total * Number(income.percentages[category] ?? 0) / 100, 0) : 0;
    return { category, balance: initial + manual };
  }), [categories, currency, incomes, transactions]);
  const originBalance = balances.find((item) => item.category === origin)?.balance ?? 0;
  const exchangeBalances = useMemo(() => exchangeOriginCategories.map((category) => {
    const initial = exchangeIncomes.reduce((sum, income) => sum + income.total * Number(income.percentages[category] ?? 0) / 100, 0);
    const manual = exchangeTransactions.filter((item) => item.category === category).reduce((sum, item) => sum + item.incomeBs - item.expenseBs, 0);
    return { category, balance: initial + manual };
  }), [exchangeIncomes, exchangeTransactions]);
  const exchangeOriginBalance = exchangeBalances.find((item) => item.category === exchangeOrigin)?.balance ?? 0;
  const selectedDistribution = distributions.find((item) => item.id === distributionId);
  const visibleExchangeAudit = exchangeAuditPeriod === distributionId ? exchangeAudit : [];
  const lastDay = selectedDistribution ? new Date(selectedDistribution.year, selectedDistribution.month + 1, 0).getDate() : 0;
  const minDate = selectedDistribution ? `${selectedDistribution.year}-${String(selectedDistribution.month + 1).padStart(2, "0")}-01` : "";
  const maxDate = selectedDistribution ? `${selectedDistribution.year}-${String(selectedDistribution.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` : "";
  const availableOrigins = balances.filter((item) => item.balance > 0);
  const destinationOptions = categories.filter((category) => category !== origin);

  const changeCurrency = (next: Currency) => {
    if (next === currency) return;
    setCurrencyDirection(next === "usd" ? "forward" : "back");
    setCurrency(next); setOrigin(""); setDestination(""); setAmount(""); setErrorMsg("");
  };

  const executeTransfer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!distributionId || !origin || !destination || origin === destination || !Number.isFinite(value) || value <= 0 || value > originBalance) {
      setErrorMsg(`El monto debe ser positivo y no superar el saldo disponible (${symbol} ${originBalance.toFixed(2)}).`);
      return;
    }
    if (!date || date < minDate || date > maxDate) {
      setErrorMsg("La fecha debe pertenecer al periodo seleccionado.");
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const originRef = doc(collection(db, "distributions", distributionId, transactionCollection));
      const destinationRef = doc(collection(db, "distributions", distributionId, transactionCollection));
      const transferData = { transferId: originRef.id, isTransfer: true, date, updatedAt: serverTimestamp() };
      batch.set(originRef, { category: origin, description: `Transf. a ${destination}`, [incomeField]: 0, [expenseField]: value, ...transferData, createdAt: serverTimestamp() });
      batch.set(destinationRef, { category: destination, description: `Prov. de ${origin}`, [incomeField]: value, [expenseField]: 0, ...transferData, createdAt: serverTimestamp() });
      await batch.commit();
      setAmount(""); setErrorMsg("");
    } catch { setErrorMsg("No se pudo registrar la transferencia."); }
    finally { setSaving(false); }
  };

  const executeCurrencyExchange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const spentBs = Number(exchangeBs);
    const purchasedUsd = Number(exchangeUsd);
    if (!distributionId || !exchangeOrigin || !exchangeDestination || !exchangeDescription.trim() || !Number.isFinite(spentBs) || !Number.isFinite(purchasedUsd) || spentBs <= 0 || purchasedUsd <= 0 || spentBs > exchangeOriginBalance) {
      setErrorMsg(`Completa la compra con montos positivos. El saldo disponible en ${exchangeOrigin || "la categoría"} es Bs ${exchangeOriginBalance.toFixed(2)}.`);
      return;
    }
    if (!exchangeDate || exchangeDate < minDate || exchangeDate > maxDate) {
      setErrorMsg("La fecha debe pertenecer al periodo seleccionado.");
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const originRef = doc(collection(db, "distributions", distributionId, "transactions"));
      const destinationRef = doc(collection(db, "distributions", distributionId, "dollarTransactions"));
      const exchangeRate = spentBs / purchasedUsd;
      const linkedData = { transferId: originRef.id, isTransfer: true, isCurrencyExchange: true, date: exchangeDate, description: exchangeDescription.trim(), exchangeRate, spentBs, purchasedUsd, updatedAt: serverTimestamp() };
      batch.set(originRef, { ...linkedData, category: exchangeOrigin, incomeBs: 0, expenseBs: spentBs, createdAt: serverTimestamp() });
      batch.set(destinationRef, { ...linkedData, category: exchangeDestination, incomeUsd: purchasedUsd, expenseUsd: 0, createdAt: serverTimestamp() });
      await batch.commit();
      setExchangeDescription(""); setExchangeUsd(""); setExchangeBs(""); setErrorMsg("");
    } catch { setErrorMsg("No se pudo registrar la compra de divisas."); }
    finally { setSaving(false); }
  };

  if (!currentUserId) return <Message text="Inicia sesión para acceder a Transferencias." />;
  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <section className="w-full max-w-6xl rounded-3xl border border-white/25 bg-white/10 p-5 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <BackButton href="/isorropia">Volver al menú</BackButton>
        <h1 className="font-display mt-8 text-center text-2xl uppercase tracking-[0.08em] text-[#adc0fa] sm:text-4xl">Transferencias</h1>
        <div className="mx-auto mt-8 flex max-w-5xl rounded-xl border border-white/20 bg-black/15 p-1" role="group" aria-label="Moneda">
          <button type="button" onClick={() => changeCurrency("bs")} className={`min-h-11 transform-gpu flex-1 rounded-lg text-xs uppercase transition-[transform,background-color] duration-200 active:scale-95 ${currency === "bs" ? "bg-[#adc0fa] text-[#121212]" : "text-white/70 hover:bg-white/10"}`}>Bolívares (Bs)</button>
          <button type="button" onClick={() => changeCurrency("usd")} className={`min-h-11 transform-gpu flex-1 rounded-lg text-xs uppercase transition-[transform,background-color] duration-200 active:scale-95 ${currency === "usd" ? "bg-[#adc0fa] text-[#121212]" : "text-white/70 hover:bg-white/10"}`}>Dólares ($)</button>
        </div>
        {errorMsg && <p className="mx-auto mt-5 max-w-5xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-xs text-red-200">{errorMsg}</p>}
        <div className="mx-auto mt-6 max-w-5xl"><label className="text-xs uppercase text-white/70">Periodo<select value={distributionId} onChange={(event) => setDistributionId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white">{distributions.length === 0 ? <option value="">No hay periodos</option> : distributions.map((item) => <option key={item.id} value={item.id}>{monthNames[item.month]} {item.year}</option>)}</select></label></div>
        {!selectedDistribution ? <p className="mx-auto mt-8 max-w-5xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">Crea primero una distribución mensual.</p> : <div key={`${currency}-${distributionId}`} className={currencyDirection === "forward" ? "slide-panel-forward" : "slide-panel-back"}>
          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-2xl border border-white/15 bg-black/15 p-4"><h2 className="text-sm uppercase text-white/80">Saldos disponibles</h2><div className="mt-4 space-y-2">{balances.map((item) => <div key={item.category} className="flex justify-between gap-3 text-sm"><span>{item.category}</span><span className={item.balance > 0 ? "text-emerald-300" : "text-white/50"}>{symbol} {item.balance.toFixed(2)}</span></div>)}</div></div>
            <form onSubmit={executeTransfer} className="rounded-2xl border border-white/15 bg-black/15 p-4"><h2 className="text-sm uppercase text-white/80">Nueva transferencia</h2><div className="mt-4 grid gap-4"><label className="text-xs uppercase text-white/70">Origen<select required value={origin} onChange={(event) => { setOrigin(event.target.value); setDestination(""); }} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white"><option value="">Selecciona una categoría</option>{availableOrigins.map((item) => <option key={item.category} value={item.category}>{item.category} ({symbol} {item.balance.toFixed(2)})</option>)}</select></label><label className="text-xs uppercase text-white/70">Destino<select required value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white"><option value="">Selecciona una categoría</option>{destinationOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs uppercase text-white/70">Monto ({symbol})<input required type="number" min="0.01" max={originBalance} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-base text-white" /></label><label className="text-xs uppercase text-white/70">Fecha<input required type="date" min={minDate} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-base text-white" /></label></div><button disabled={saving || availableOrigins.length === 0} type="submit" className="min-h-12 rounded-xl bg-[#adc0fa] px-4 py-3 text-xs uppercase text-[#121212] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Registrando..." : "Transferir"}</button></div></form>
          </div>
          <form onSubmit={executeCurrencyExchange} className="mt-6 rounded-2xl border border-white/15 bg-black/15 p-4 sm:p-5">
            <h2 className="text-sm uppercase text-white/85">Compra de divisas</h2>
            <p className="mt-2 text-xs text-white/50">Registra el egreso en Bs y el ingreso en dólares como movimientos vinculados y protegidos.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs uppercase text-white/70">Fecha<input required type="date" min={minDate} max={maxDate} value={exchangeDate} onChange={(event) => setExchangeDate(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white" /></label>
              <label className="text-xs uppercase text-white/70">Descripción<input required value={exchangeDescription} onChange={(event) => setExchangeDescription(event.target.value)} placeholder="Ej. Compra de dólares en paralelo" className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white placeholder:text-white/35" /></label>
              <label className="text-xs uppercase text-white/70">Origen en Bs<select required value={exchangeOrigin} onChange={(event) => setExchangeOrigin(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white"><option value="">Selecciona Ahorro o Inversión</option>{exchangeBalances.map((item) => <option key={item.category} value={item.category} disabled={item.balance <= 0}>{item.category} (Bs {item.balance.toFixed(2)})</option>)}</select></label>
              <label className="text-xs uppercase text-white/70">Destino en dólares<select required value={exchangeDestination} onChange={(event) => setExchangeDestination(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white"><option value="">Selecciona Ahorro o Inversiones</option>{exchangeDestinationCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label className="text-xs uppercase text-white/70">Divisas compradas ($)<input required type="number" min="0.01" step="0.01" value={exchangeUsd} onChange={(event) => setExchangeUsd(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white" /></label>
              <label className="text-xs uppercase text-white/70">Gastado (Bs)<input required type="number" min="0.01" max={exchangeOriginBalance} step="0.01" value={exchangeBs} onChange={(event) => setExchangeBs(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-sm text-white" /></label>
            </div>
            <button disabled={saving || exchangeBalances.every((item) => item.balance <= 0)} type="submit" className="mt-4 min-h-12 rounded-xl bg-[#adc0fa] px-5 py-3 text-xs uppercase text-[#121212] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando..." : "Registrar compra vinculada"}</button>
          </form>
          <section className="mt-6 rounded-2xl border border-white/15 bg-black/15 p-4 sm:p-5" aria-labelledby="exchange-audit-title">
            <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="exchange-audit-title" className="text-sm uppercase text-white/85">Bitácora de divisas</h2><span className="text-xs text-white/45">{visibleExchangeAudit.length} operaciones · {monthNames[selectedDistribution.month]} {selectedDistribution.year}</span></div>
            {visibleExchangeAudit.length === 0 ? <p className="mt-4 border border-dashed border-white/15 p-4 text-xs text-white/50">No hay conversiones registradas en este periodo.</p> : <div className="mt-4 divide-y divide-white/10">{visibleExchangeAudit.map((item) => <article key={item.id} className="grid gap-2 py-4 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-5"><div className="min-w-0"><p className="wrap-break-word text-white/80">{item.description}</p><p className="mt-1 text-white/40">{item.date}</p></div><p className="text-[#adc0fa]">Bs {item.spentBs.toFixed(2)}</p><p className="text-emerald-300">$ {item.purchasedUsd.toFixed(2)}</p><p className="text-white/55">Bs {item.exchangeRate.toFixed(4)} / $</p></article>)}</div>}
          </section>
          <p className="mx-auto mt-5 max-w-5xl text-xs text-white/50">Las transferencias se registran como egreso en el origen e ingreso en el destino dentro de la moneda seleccionada.</p>
        </div>}
      </section>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center px-4 py-8"><section className="w-full max-w-4xl rounded-3xl border border-white/25 bg-white/10 p-8 text-center text-white shadow-2xl shadow-black/30 backdrop-blur-xl"><p className="text-sm text-white/70">{text}</p><BackButton href="/isorropia">Volver al menú</BackButton></section></main>;
}

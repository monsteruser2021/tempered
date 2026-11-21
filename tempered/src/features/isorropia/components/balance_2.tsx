"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "@/shared/ui/back-button";
import { useSession } from "@/shared/auth/session-context";
import BalanceTransactionFilters, {
  sortAndFilterMovements,
  type MovementSort,
  type MovementType,
} from "./balance-transaction-filters";
import RecentBalanceMovements from "./recent-balance-movements";

const categories = [
  "Inversiones",
  "Ahorro",
  "Fondo de emergencia",
];
const recentTab = "Recientes (5)";
const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Reparto = { id: string; month: number; year: number };
type DollarTransaction = {
  id: string;
  category: string;
  date: string;
  createdAt: number;
  description: string;
  incomeUsd: number;
  expenseUsd: number;
  isTransfer: boolean;
  isDebtMovement: boolean;
  isPlannedIncome: boolean;
};

const isTransferRecord = (data: Record<string, unknown>) => data.isTransfer === true || Boolean(data.transferId) || /^(Transf\. a|Prov\. de)/i.test(String(data.description ?? ""));
const timestampMillis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : 0;

export default function BalanceDolares() {
  const { userId: currentUserId } = useSession();
  const [repartos, setRepartos] = useState<Reparto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [transactions, setTransactions] = useState<DollarTransaction[]>([]);
  const [activeCategory, setActiveCategory] = useState(recentTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [movementSort, setMovementSort] = useState<MovementSort>("date-desc");
  const [movementType, setMovementType] = useState<MovementType>("all");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [incomeUsd, setIncomeUsd] = useState("");
  const [expenseUsd, setExpenseUsd] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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
        setSelectedId((current) => current && next.some((item) => item.id === current)
          ? current
          : next.find((item) => item.year === new Date().getFullYear() && item.month === new Date().getMonth())?.id ?? next[0]?.id ?? "");
      },
      () => setErrorMsg("No se pudieron cargar los periodos disponibles."),
    );
  }, [currentUserId]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "" || !selectedId) return;
    return onSnapshot(
      collection(db, "distributions", selectedId, "dollarTransactions"),
      (snapshot) => setTransactions(snapshot.docs.map((item) => ({
        id: item.id,
        category: String(item.data().category ?? ""),
        date: String(item.data().date ?? ""),
        createdAt: timestampMillis(item.data().createdAt),
        description: String(item.data().description ?? ""),
        incomeUsd: Number(item.data().incomeUsd ?? 0),
        expenseUsd: Number(item.data().expenseUsd ?? 0),
        isTransfer: isTransferRecord(item.data()),
        isDebtMovement: item.data().isDebtPayment === true || item.data().isDebtCollection === true || item.data().debtMovementType === "payment" || item.data().debtMovementType === "collection",
        isPlannedIncome: item.data().isPlannedIncome === true,
      }))),
      () => setErrorMsg("No se pudieron cargar las transacciones en dólares."),
    );
  }, [currentUserId, selectedId]);

  const selectedReparto = repartos.find((item) => item.id === selectedId);
  const monthStart = selectedReparto ? `${selectedReparto.year}-${String(selectedReparto.month + 1).padStart(2, "0")}-01` : "";
  const lastDay = selectedReparto ? new Date(selectedReparto.year, selectedReparto.month + 1, 0).getDate() : 0;
  const maxDate = selectedReparto ? `${selectedReparto.year}-${String(selectedReparto.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` : "";
  const categoryTransactions = useMemo(() => activeCategory === recentTab ? [] : transactions.filter((item) => item.category === activeCategory), [activeCategory, transactions]);
  const visibleTransactions = sortAndFilterMovements(categoryTransactions.map((item) => ({
    ...item,
    income: item.incomeUsd,
    expense: item.expenseUsd,
  })), movementSort, movementType);
  const remaining = categoryTransactions.reduce((sum, item) => sum + item.incomeUsd - item.expenseUsd, 0);
  const recentTransactions = transactions.map((item) => ({
    id: item.id,
    category: item.category,
    date: item.date,
    createdAt: item.createdAt,
    description: item.description,
    income: item.incomeUsd,
    expense: item.expenseUsd,
  }));

  const resetForm = () => {
    setEditingId(null);
    setDate("");
    setDescription("");
    setIncomeUsd("");
    setExpenseUsd("");
  };

  const saveTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const income = Number(incomeUsd) || 0;
    const expense = Number(expenseUsd) || 0;
    if (!selectedId || !date || !description.trim() || (income === 0 && expense === 0) || date < monthStart || date > maxDate) {
      setErrorMsg("Completa la transacción y usa una fecha dentro del periodo seleccionado.");
      return;
    }

    try {
      const data = {
        category: activeCategory,
        date,
        description: description.trim(),
        incomeUsd: income,
        expenseUsd: expense,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, "distributions", selectedId, "dollarTransactions", editingId), data);
      } else {
        await addDoc(collection(db, "distributions", selectedId, "dollarTransactions"), { ...data, createdAt: serverTimestamp() });
      }
      resetForm();
      setErrorMsg("");
    } catch {
      setErrorMsg("No se pudo guardar la transacción en dólares.");
    }
  };

  const editTransaction = (transaction: DollarTransaction) => {
    if (transaction.isDebtMovement) {
      setErrorMsg("Los movimientos de deuda se administran desde el módulo de deudas.");
      return;
    }
    if (transaction.isPlannedIncome) {
      setErrorMsg("Las distribuciones aprobadas se administran desde el módulo de Reparto de Fondos.");
      return;
    }
    setEditingId(transaction.id);
    setDate(transaction.date);
    setDescription(transaction.description);
    setIncomeUsd(String(transaction.incomeUsd || ""));
    setExpenseUsd(String(transaction.expenseUsd || ""));
    setPendingDeleteId(null);
  };

  const deleteTransaction = async (id: string) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    const transaction = transactions.find((item) => item.id === id);
    if (transaction?.isDebtMovement) {
      setPendingDeleteId(null);
      setErrorMsg("Los movimientos de deuda se administran desde el módulo de deudas.");
      return;
    }
    if (transaction?.isPlannedIncome) {
      setPendingDeleteId(null);
      setErrorMsg("Las distribuciones aprobadas se administran desde el módulo de Reparto de Fondos.");
      return;
    }
    if (transaction?.isTransfer) {
      setPendingDeleteId(null);
      setErrorMsg("Los movimientos vinculados no se pueden eliminar por separado.");
      return;
    }
    try {
      await deleteDoc(doc(db, "distributions", selectedId, "dollarTransactions", id));
      setPendingDeleteId(null);
    } catch {
      setErrorMsg("No se pudo eliminar la transacción.");
    }
  };

  if (!currentUserId) return <Message text="Inicia sesión para acceder al balance en dólares." />;

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <section className="w-full max-w-7xl rounded-3xl border border-white/25 bg-white/10 p-5 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <BackButton href="/isorropia">Volver al menú</BackButton>
        <h1 className="font-display mt-8 text-center text-2xl uppercase tracking-[0.08em] text-red-300 sm:text-4xl">Balance $</h1>
        {errorMsg && <p className="mx-auto mt-5 max-w-5xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-xs leading-5 text-red-200 sm:text-sm">{errorMsg}</p>}

        <div className="mx-auto mt-8 w-full max-w-5xl">
          <label className="text-xs uppercase text-white/70">Periodo seleccionado
            <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); resetForm(); }} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white outline-none focus:border-white/70">
              {repartos.length === 0 ? <option value="">No hay periodos creados</option> : repartos.map((item) => <option key={item.id} value={item.id}>{monthNames[item.month]} {item.year}</option>)}
            </select>
          </label>
        </div>

        {!selectedReparto ? <p className="mx-auto mt-8 max-w-5xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">Crea primero un reparto de fondos mensual para seleccionar el periodo.</p> : <>
          <div className="mt-8 flex gap-2 overflow-x-auto pb-3" role="tablist" aria-label="Categorías del balance en dólares">
            {[recentTab, ...categories].map((category) => (
              <button key={category} type="button" role="tab" aria-selected={activeCategory === category} onClick={() => { setActiveCategory(category); resetForm(); }} className={`min-h-11 shrink-0 rounded-xl border px-4 py-3 text-xs uppercase transition ${activeCategory === category ? "border-red-500 bg-red-600 text-white" : "border-white/20 bg-black/15 text-white/70 hover:bg-white/15"}`}>
                {category}
              </button>
            ))}
          </div>

          {activeCategory === recentTab ? (
            <>
              <h2 className="mt-4 text-lg uppercase text-white">Últimos movimientos</h2>
              <RecentBalanceMovements movements={recentTransactions} currency="$" onSelectCategory={(category) => { setActiveCategory(category); resetForm(); }} />
            </>
          ) : <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg uppercase text-white">{activeCategory}</h2>
            <span className={remaining >= 0 ? "text-sm text-emerald-300" : "text-sm text-red-300"}>Total restante: ${remaining.toFixed(2)}</span>
          </div>
          <BalanceTransactionFilters sort={movementSort} type={movementType} onSortChange={setMovementSort} onTypeChange={setMovementType} />

          <form onSubmit={saveTransaction} className="mt-5 grid gap-4 rounded-2xl border border-white/15 bg-black/15 p-4 sm:p-5 md:grid-cols-[150px_1fr_150px_150px_auto] md:items-end">
            <label className="text-xs uppercase text-white/70">Fecha<input required type="date" min={monthStart} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-base text-white outline-none sm:text-sm" /></label>
            <label className="text-xs uppercase text-white/70">Descripción<input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ej. Supermercado" className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-base text-white outline-none placeholder:text-sm sm:text-sm" /></label>
            <label className="text-xs uppercase text-white/70">Ingreso $<input type="number" min="0" step="0.01" value={incomeUsd} onChange={(event) => setIncomeUsd(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-base text-white outline-none sm:text-sm" /></label>
            <label className="text-xs uppercase text-white/70">Egreso $<input type="number" min="0" step="0.01" value={expenseUsd} onChange={(event) => setExpenseUsd(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-base text-white outline-none sm:text-sm" /></label>
            <button type="submit" className="min-h-12 rounded-xl bg-red-600 px-4 py-3 text-xs uppercase text-white hover:bg-red-500">{editingId ? "Guardar" : "Agregar"}</button>
          </form>

          <div className="mt-6 space-y-3 md:hidden">
            {visibleTransactions.length === 0 ? <p className="rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/55">{categoryTransactions.length === 0 ? "No hay transacciones en esta categoría." : "No hay movimientos que coincidan con los filtros."}</p> : visibleTransactions.map((item) => <article key={item.id} className="rounded-2xl border border-white/15 bg-black/15 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-white">{item.description}</p><p className="mt-1 text-xs text-white/55">{item.date}</p></div><p className={item.incomeUsd - item.expenseUsd >= 0 ? "text-sm text-emerald-300" : "text-sm text-red-300"}>${(item.incomeUsd - item.expenseUsd).toFixed(2)}</p></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs"><p className="text-emerald-300">Ingreso: ${item.incomeUsd.toFixed(2)}</p><p className="text-right text-red-300">Egreso: ${item.expenseUsd.toFixed(2)}</p></div>{item.isDebtMovement ? <p className="mt-3 text-xs text-white/40">Movimiento de deuda vinculado</p> : item.isPlannedIncome ? <p className="mt-3 text-xs text-white/40">Distribución aprobada protegida</p> : item.isTransfer ? <p className="mt-3 text-xs text-white/40">Transferencia protegida</p> : <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => editTransaction(item)} className="min-h-10 rounded-lg border border-white/25 px-3 py-2 text-xs uppercase">Editar</button>{pendingDeleteId === item.id ? <button type="button" onClick={() => deleteTransaction(item.id)} className="min-h-10 rounded-lg bg-red-500/80 px-3 py-2 text-xs uppercase">Confirmar</button> : <button type="button" onClick={() => deleteTransaction(item.id)} className="min-h-10 rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200">Eliminar</button>}</div>}</article>)}
          </div>

          <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-white/15 bg-black/15 md:block">
            <table className="w-full text-left text-sm"><thead className="border-b border-white/15 text-xs uppercase text-white/55"><tr><th className="p-4">Fecha</th><th className="p-4">Descripción</th><th className="p-4">Ingreso $</th><th className="p-4">Egreso $</th><th className="p-4">Saldo</th><th className="p-4">Acciones</th></tr></thead><tbody>{visibleTransactions.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-sm text-white/55">No hay movimientos que coincidan con los filtros.</td></tr> : visibleTransactions.map((item) => <tr key={item.id} className="border-b border-white/10"><td className="p-4">{item.date}</td><td className="p-4">{item.description}</td><td className="p-4 text-emerald-300">${item.incomeUsd.toFixed(2)}</td><td className="p-4 text-red-300">${item.expenseUsd.toFixed(2)}</td><td className={item.incomeUsd - item.expenseUsd >= 0 ? "p-4 text-emerald-300" : "p-4 text-red-300"}>${(item.incomeUsd - item.expenseUsd).toFixed(2)}</td><td className="p-4">{item.isDebtMovement ? <span className="text-xs text-white/40">Movimiento de deuda vinculado</span> : item.isPlannedIncome ? <span className="text-xs text-white/40">Distribución aprobada protegida</span> : item.isTransfer ? <span className="text-xs text-white/40">Transferencia protegida</span> : <span className="flex gap-2"><button type="button" onClick={() => editTransaction(item)} className="rounded-lg border border-white/25 px-3 py-2 text-xs uppercase">Editar</button>{pendingDeleteId === item.id ? <button type="button" onClick={() => deleteTransaction(item.id)} className="rounded-lg bg-red-500/80 px-3 py-2 text-xs uppercase">Confirmar</button> : <button type="button" onClick={() => deleteTransaction(item.id)} className="rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200">Eliminar</button>}</span>}</td></tr>)}</tbody></table>
          </div>
          </>}
        </>}
      </section>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return <main className="flex min-h-screen w-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10"><section className="w-full max-w-4xl rounded-3xl border border-white/25 bg-white/10 p-6 text-center text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8"><p className="text-sm text-white/70">{text}</p><BackButton href="/isorropia">Volver al menú</BackButton></section></main>;
}

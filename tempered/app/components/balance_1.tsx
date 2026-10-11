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
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { useSession } from "./session-context";

const categories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];
const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Distribution = { id: string; month: number; year: number };
type Transaction = { id: string; category: string; date: string; description: string; incomeBs: number; expenseBs: number; isTransfer: boolean; isDebtMovement: boolean };
type Income = { id: string; description: string; totalBs: number; percentages: Record<string, number> };

const isTransferRecord = (data: Record<string, unknown>) => data.isTransfer === true || Boolean(data.transferId) || /^(Transf\. a|Prov\. de)/i.test(String(data.description ?? ""));

export default function BalanceBs() {
  const { userId: currentUserId } = useSession();
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [activeCategory, setActiveCategory] = useState(categories[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [incomeBs, setIncomeBs] = useState("");
  const [expenseBs, setExpenseBs] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!currentUserId) return;
    return onSnapshot(query(collection(db, "distributions"), where("userId", "==", currentUserId)), (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, month: Number(item.data().month), year: Number(item.data().year) })).sort((a, b) => b.year - a.year || b.month - a.month);
      setDistributions(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    }, () => setErrorMsg("No se pudieron cargar las distribuciones."));
  }, [currentUserId]);

  useEffect(() => {
    if (!selectedId) return;
    const stopIncomes = onSnapshot(collection(db, "distributions", selectedId, "incomes"), (snapshot) => setIncomes(snapshot.docs.map((item) => ({ id: item.id, description: String(item.data().description ?? ""), totalBs: Number(item.data().totalBs ?? 0), percentages: (item.data().percentages ?? {}) as Record<string, number> }))), () => setErrorMsg("No se pudieron cargar los ingresos distribuidos."));
    const stopTransactions = onSnapshot(collection(db, "distributions", selectedId, "transactions"), (snapshot) => setTransactions(snapshot.docs.map((item) => ({ id: item.id, category: String(item.data().category ?? ""), date: String(item.data().date ?? ""), description: String(item.data().description ?? ""), incomeBs: Number(item.data().incomeBs ?? 0), expenseBs: Number(item.data().expenseBs ?? 0), isTransfer: isTransferRecord(item.data()), isDebtMovement: item.data().isDebtPayment === true || item.data().isDebtCollection === true || item.data().debtMovementType === "payment" || item.data().debtMovementType === "collection" }))), () => setErrorMsg("No se pudieron cargar las transacciones."));
    return () => { stopIncomes(); stopTransactions(); };
  }, [selectedId]);

  const selectedDistribution = distributions.find((item) => item.id === selectedId);
  const monthStart = selectedDistribution ? `${selectedDistribution.year}-${String(selectedDistribution.month + 1).padStart(2, "0")}-01` : "";
  const monthEnd = selectedDistribution ? new Date(selectedDistribution.year, selectedDistribution.month + 1, 0).getDate() : 0;
  const maxDate = selectedDistribution ? `${selectedDistribution.year}-${String(selectedDistribution.month + 1).padStart(2, "0")}-${String(monthEnd).padStart(2, "0")}` : "";
  const initialTransactions = useMemo<Transaction[]>(() => incomes.flatMap((income) => {
    const percentage = Number(income.percentages[activeCategory] ?? 0);
    const amount = income.totalBs * percentage / 100;
    return amount > 0 ? [{ id: `initial-${income.id}`, category: activeCategory, date: monthStart, description: `${income.description} (${percentage}%)`, incomeBs: amount, expenseBs: 0, isTransfer: false, isDebtMovement: false }] : [];
  }), [activeCategory, incomes, monthStart]);
  const visibleTransactions = [...initialTransactions, ...transactions.filter((item) => item.category === activeCategory)];
  const remaining = visibleTransactions.reduce((sum, item) => sum + item.incomeBs - item.expenseBs, 0);

  const resetForm = () => { setEditingId(null); setDate(""); setDescription(""); setIncomeBs(""); setExpenseBs(""); };
  const saveTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const income = Number(incomeBs) || 0;
    const expense = Number(expenseBs) || 0;
    if (!selectedId || !date || !description.trim() || (income === 0 && expense === 0) || date < monthStart || date > maxDate) {
      setErrorMsg("Completa la transacción y usa una fecha dentro del periodo.");
      return;
    }
    try {
      const data = { category: activeCategory, date, description: description.trim(), incomeBs: income, expenseBs: expense, updatedAt: serverTimestamp() };
      if (editingId) await updateDoc(doc(db, "distributions", selectedId, "transactions", editingId), data);
      else await addDoc(collection(db, "distributions", selectedId, "transactions"), { ...data, createdAt: serverTimestamp() });
      resetForm(); setErrorMsg("");
    } catch { setErrorMsg("No se pudo guardar la transacción."); }
  };
  const editTransaction = (item: Transaction) => {
    if (item.isDebtMovement) { setErrorMsg("Los movimientos de deuda se administran desde el módulo de deudas."); return; }
    setEditingId(item.id); setDate(item.date); setDescription(item.description); setIncomeBs(String(item.incomeBs || "")); setExpenseBs(String(item.expenseBs || "")); setPendingDeleteId(null);
  };
  const deleteTransaction = async (id: string) => {
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    const transaction = transactions.find((item) => item.id === id);
    if (transaction?.isDebtMovement) {
      setPendingDeleteId(null);
      setErrorMsg("Los movimientos de deuda se administran desde el módulo de deudas.");
      return;
    }
    if (transaction?.isTransfer) {
      setPendingDeleteId(null);
      setErrorMsg("Las transferencias no se pueden eliminar desde el balance.");
      return;
    }
    try { await deleteDoc(doc(db, "distributions", selectedId, "transactions", id)); setPendingDeleteId(null); } catch { setErrorMsg("No se pudo eliminar la transacción."); }
  };

  if (!currentUserId) return <Message text="Inicia sesión para acceder al balance." />;
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-[90vw] max-w-7xl rounded-3xl border border-white/25 bg-white/10 p-6 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <BackButton href="/isorropia">Volver al menú</BackButton>
        <h1 className="font-display mt-8 text-center text-2xl uppercase tracking-[0.1em] text-[#adc0fa] sm:text-4xl">Balance Bs</h1>
        {errorMsg && <p className="mx-auto mt-5 max-w-5xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-sm text-red-200">{errorMsg}</p>}
        <div className="mx-auto mt-8 max-w-5xl"><label className="text-xs uppercase text-white/70">Distribución seleccionada<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); resetForm(); }} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-white">{distributions.length === 0 ? <option value="">No hay distribuciones creadas</option> : distributions.map((item) => <option key={item.id} value={item.id}>{monthNames[item.month]} {item.year}</option>)}</select></label></div>
        {!selectedDistribution ? <p className="mx-auto mt-8 max-w-5xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">Crea primero una distribución mensual.</p> : <>
          <div className="mt-8 flex gap-2 overflow-x-auto pb-3" role="tablist">{categories.map((category) => <button key={category} type="button" onClick={() => { setActiveCategory(category); resetForm(); }} className={`shrink-0 rounded-xl border px-4 py-3 text-xs uppercase transition ${activeCategory === category ? "border-[#adc0fa] bg-[#adc0fa] text-[#121212]" : "border-white/20 bg-black/15 text-white/70 hover:bg-white/15"}`}>{category}{activeCategory === category && <span className="ml-2">{remaining.toFixed(2)} Bs</span>}</button>)}</div>
          <div className="mt-4 flex items-center justify-between"><h2 className="text-lg uppercase text-white">{activeCategory}</h2><span className={remaining >= 0 ? "text-emerald-300" : "text-red-300"}>Total restante: {remaining.toFixed(2)} Bs</span></div>
          <form onSubmit={saveTransaction} className="mt-5 grid gap-3 rounded-2xl border border-white/15 bg-black/15 p-5 sm:grid-cols-[150px_1fr_150px_150px_auto] sm:items-end"><label className="text-xs uppercase text-white/70">Fecha<input required type="date" min={monthStart} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-white" /></label><label className="text-xs uppercase text-white/70">Descripción<input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ej. Supermercado" className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-white" /></label><label className="text-xs uppercase text-white/70">Ingreso Bs<input type="number" min="0" step="0.01" value={incomeBs} onChange={(event) => setIncomeBs(event.target.value)} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-white" /></label><label className="text-xs uppercase text-white/70">Egreso Bs<input type="number" min="0" step="0.01" value={expenseBs} onChange={(event) => setExpenseBs(event.target.value)} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-3 text-white" /></label><button type="submit" className="rounded-xl bg-[#adc0fa] px-4 py-3 text-xs uppercase text-[#121212] hover:bg-white">{editingId ? "Guardar" : "Agregar"}</button></form>
          <div className="mt-6 space-y-3 md:hidden">
            {visibleTransactions.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/15 bg-black/15 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{item.description}</p>
                    <p className="mt-1 text-xs text-white/55">{item.date || "Ingreso inicial"}</p>
                  </div>
                  <p className={item.incomeBs - item.expenseBs >= 0 ? "text-sm text-emerald-300" : "text-sm text-red-300"}>
                    {(item.incomeBs - item.expenseBs).toFixed(2)} Bs
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
                  <p className="text-emerald-300">Ingreso: {item.incomeBs.toFixed(2)} Bs</p>
                  <p className="text-right text-red-300">Egreso: {item.expenseBs.toFixed(2)} Bs</p>
                </div>
                {item.id.startsWith("initial-") ? (
                  <p className="mt-3 text-xs text-white/40">Ingreso inicial</p>
                ) : item.isDebtMovement ? (
                  <p className="mt-3 text-xs text-white/40">Movimiento de deuda vinculado</p>
                ) : item.isTransfer ? (
                  <p className="mt-3 text-xs text-white/40">Transferencia protegida</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => editTransaction(item)} className="min-h-10 rounded-lg border border-white/25 px-3 py-2 text-xs uppercase">Editar</button>
                    {pendingDeleteId === item.id ? (
                      <button type="button" onClick={() => deleteTransaction(item.id)} className="min-h-10 rounded-lg bg-red-500/80 px-3 py-2 text-xs uppercase">Confirmar</button>
                    ) : (
                      <button type="button" onClick={() => deleteTransaction(item.id)} className="min-h-10 rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200">Eliminar</button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-white/15 bg-black/15 md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/15 text-xs uppercase text-white/55"><tr><th className="p-4">Fecha</th><th className="p-4">Descripción</th><th className="p-4">Ingreso</th><th className="p-4">Egreso</th><th className="p-4">Saldo</th><th className="p-4">Acciones</th></tr></thead>
              <tbody>{visibleTransactions.map((item) => <tr key={item.id} className="border-b border-white/10"><td className="p-4">{item.date || "Inicial"}</td><td className="p-4">{item.description}</td><td className="p-4 text-emerald-300">{item.incomeBs.toFixed(2)} Bs</td><td className="p-4 text-red-300">{item.expenseBs.toFixed(2)} Bs</td><td className={item.incomeBs - item.expenseBs >= 0 ? "p-4 text-emerald-300" : "p-4 text-red-300"}>{(item.incomeBs - item.expenseBs).toFixed(2)} Bs</td><td className="p-4">{item.id.startsWith("initial-") ? <span className="text-xs text-white/40">Ingreso inicial</span> : item.isDebtMovement ? <span className="text-xs text-white/40">Movimiento de deuda vinculado</span> : item.isTransfer ? <span className="text-xs text-white/40">Transferencia protegida</span> : <span className="flex gap-2"><button type="button" onClick={() => editTransaction(item)} className="rounded-lg border border-white/25 px-3 py-2 text-xs uppercase">Editar</button>{pendingDeleteId === item.id ? <button type="button" onClick={() => deleteTransaction(item.id)} className="rounded-lg bg-red-500/80 px-3 py-2 text-xs uppercase">Confirmar</button> : <button type="button" onClick={() => deleteTransaction(item.id)} className="rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200">Eliminar</button>}</span>}</td></tr>)}</tbody>
            </table>
          </div>
        </>}
      </section>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center px-5 py-10"><section className="w-[90vw] max-w-4xl rounded-3xl border border-white/25 bg-white/10 p-8 text-center text-white shadow-2xl shadow-black/30 backdrop-blur-xl"><p className="text-sm text-white/70">{text}</p><BackButton href="/isorropia">Volver al menú</BackButton></section></main>;
}

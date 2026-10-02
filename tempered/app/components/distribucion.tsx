"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BackButton from "./back-button";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useSession } from "./session-context";

const categories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];
const dollarCategories = ["Inversiones", "Ahorro", "Fondo de emergencia"];
const months = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Distribution = {
  id: string;
  name: string;
  month: number;
  year: number;
  isAutomatic: boolean;
};
type PreviousIncome = { totalBs: number; percentages: Record<string, number> };
type PreviousTransaction = { category: string; incomeBs: number; expenseBs: number };
type PreviousDollarTransaction = { category: string; incomeUsd: number; expenseUsd: number };

const periodValue = (year: number, month: number) => year * 12 + month;
const periodDocumentId = (userId: string, year: number, month: number) => `period-${encodeURIComponent(userId)}-${year}-${String(month + 1).padStart(2, "0")}`;

export default function Distribucion() {
  const { userId: currentUserId } = useSession();
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const rolloverInProgress = useRef(false);
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentPeriod = periodValue(currentYear, currentMonth);
  const years = Array.from({ length: Math.max(1, currentYear - 2021 + 1) }, (_, index) => 2021 + index);

  const createRollover = useCallback(async (available: Distribution[], userId: string) => {
    if (rolloverInProgress.current) return;
    rolloverInProgress.current = true;
    try {
      const currentDistributions = available.filter((item) => item.year === currentYear && item.month === currentMonth);
      let currentDistribution = currentDistributions.find((item) => !item.isAutomatic);
      if (!currentDistribution) {
        const legacyRollover = currentDistributions.find((item) => item.isAutomatic);
        if (legacyRollover) {
          await updateDoc(doc(db, "distributions", legacyRollover.id), { name: "Distribución", isAutomatic: false, convertedFromRollover: true, updatedAt: serverTimestamp() });
          currentDistribution = { ...legacyRollover, name: "Distribución", isAutomatic: false };
        } else {
          const distributionRef = doc(db, "distributions", periodDocumentId(userId, currentYear, currentMonth));
          await setDoc(distributionRef, { name: "Distribución", userId, month: currentMonth, year: currentYear, isAutomatic: false, createdAt: serverTimestamp() }, { merge: true });
          currentDistribution = { id: distributionRef.id, name: "Distribución", month: currentMonth, year: currentYear, isAutomatic: false };
        }
      }

      const currentRef = doc(db, "distributions", currentDistribution.id);
      const legacyDistributions = currentDistributions.filter((item) => item.isAutomatic && item.id !== currentDistribution.id);
      if (legacyDistributions.length > 0) {
        const migrationBatch = writeBatch(db);
        for (const legacyDistribution of legacyDistributions) {
          const [legacyIncomes, legacyDollarTransactions] = await Promise.all([
            getDocs(collection(db, "distributions", legacyDistribution.id, "incomes")),
            getDocs(collection(db, "distributions", legacyDistribution.id, "dollarTransactions")),
          ]);
          legacyIncomes.docs.forEach((income) => {
            migrationBatch.set(doc(db, "distributions", currentDistribution.id, "incomes", income.id), income.data(), { merge: true });
            migrationBatch.delete(income.ref);
          });
          legacyDollarTransactions.docs.forEach((transaction) => {
            migrationBatch.set(doc(db, "distributions", currentDistribution.id, "dollarTransactions", transaction.id), transaction.data(), { merge: true });
            migrationBatch.delete(transaction.ref);
          });
          migrationBatch.delete(doc(db, "distributions", legacyDistribution.id));
        }
        await migrationBatch.commit();
      }

      const [incomeSnapshot, dollarTransactionSnapshot, currentSnapshot] = await Promise.all([
        getDocs(collection(db, "distributions", currentDistribution.id, "incomes")),
        getDocs(collection(db, "distributions", currentDistribution.id, "dollarTransactions")),
        getDoc(currentRef),
      ]);
      const currentData = currentSnapshot.data() ?? {};
      const hasBsRollover = incomeSnapshot.docs.some((item) => item.data().isRollover === true);
      const hasDollarRollover = dollarTransactionSnapshot.docs.some((item) => item.data().isRollover === true);

      const previous = available
        .filter((item) => periodValue(item.year, item.month) < currentPeriod)
        .sort((first, second) => periodValue(second.year, second.month) - periodValue(first.year, first.month) || Number(first.isAutomatic) - Number(second.isAutomatic))[0];
      const balances = Object.fromEntries(categories.map((category) => [category, 0])) as Record<string, number>;
      const dollarBalances = Object.fromEntries(dollarCategories.map((category) => [category, 0])) as Record<string, number>;
      if (previous) {
        const [previousIncomeSnapshot, transactionSnapshot, previousDollarSnapshot] = await Promise.all([
          getDocs(collection(db, "distributions", previous.id, "incomes")),
          getDocs(collection(db, "distributions", previous.id, "transactions")),
          getDocs(collection(db, "distributions", previous.id, "dollarTransactions")),
        ]);
        previousIncomeSnapshot.docs.forEach((item) => {
          const data = item.data() as PreviousIncome;
          categories.forEach((category) => { balances[category] += Number(data.totalBs ?? 0) * Number(data.percentages?.[category] ?? 0) / 100; });
        });
        transactionSnapshot.docs.forEach((item) => {
          const data = item.data() as PreviousTransaction;
          if (data.category in balances) balances[data.category] += Number(data.incomeBs ?? 0) - Number(data.expenseBs ?? 0);
        });
        previousDollarSnapshot.docs.forEach((item) => {
          const data = item.data() as PreviousDollarTransaction;
          if (data.category in dollarBalances) dollarBalances[data.category] += Number(data.incomeUsd ?? 0) - Number(data.expenseUsd ?? 0);
        });
      }

      if (currentData.rolloverChecked !== true) {
        const batch = writeBatch(db);
        batch.set(currentRef, { sourceDistributionId: previous?.id ?? null, rolloverChecked: true, rolloverCheckedAt: serverTimestamp() }, { merge: true });
        if (!hasBsRollover) {
          categories.forEach((category) => {
            const amount = Math.round(Math.max(0, balances[category]) * 100) / 100;
            if (amount <= 0) return;
            const incomeRef = doc(db, "distributions", currentDistribution.id, "incomes", `rollover-${encodeURIComponent(category)}`);
            batch.set(incomeRef, { description: `Restante del mes anterior: ${category}`, totalBs: amount, percentages: Object.fromEntries(categories.map((item) => [item, item === category ? 100 : 0])), isRollover: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          });
        }
        await batch.commit();
      }

      if (currentData.dollarRolloverChecked !== true && (previous || hasDollarRollover)) {
        const dollarBatch = writeBatch(db);
        dollarBatch.set(currentRef, { sourceDollarDistributionId: previous?.id ?? null, dollarRolloverChecked: true, dollarRolloverCheckedAt: serverTimestamp() }, { merge: true });
        if (!hasDollarRollover) {
          dollarCategories.forEach((category) => {
            const amount = Math.round(Math.max(0, dollarBalances[category]) * 100) / 100;
            if (amount <= 0) return;
            const transactionRef = doc(db, "distributions", currentDistribution.id, "dollarTransactions", `rollover-${encodeURIComponent(category)}`);
            dollarBatch.set(transactionRef, { category, date: `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`, description: `Restante del mes anterior: ${category}`, incomeUsd: amount, expenseUsd: 0, isRollover: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          });
        }
        await dollarBatch.commit();
      }
    } catch {
      setErrorMsg("No se pudo preparar automáticamente la distribución del mes.");
    } finally {
      rolloverInProgress.current = false;
    }
  }, [currentMonth, currentPeriod, currentYear]);

  useEffect(() => {
    if (!currentUserId) return;
    const distributionsQuery = query(collection(db, "distributions"), where("userId", "==", currentUserId));
    return onSnapshot(distributionsQuery, (snapshot) => {
      const available = snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name ?? "Distribución"), month: Number(item.data().month), year: Number(item.data().year), isAutomatic: item.data().isAutomatic === true })).sort((a, b) => periodValue(b.year, b.month) - periodValue(a.year, a.month));
      setDistributions(available);
      void createRollover(available, currentUserId);
    }, () => setErrorMsg("No se pudieron cargar las distribuciones."));
  }, [createRollover, currentUserId]);

  const orderedDistributions = useMemo(() => [...distributions].sort((a, b) => periodValue(b.year, b.month) - periodValue(a.year, a.month)), [distributions]);
  const selectedPeriodIsValid = periodValue(year, month) <= currentPeriod;

  const saveDistribution = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUserId) return setErrorMsg("Debes iniciar sesión para continuar.");
    if (!selectedPeriodIsValid) return setErrorMsg("Solo puedes crear distribuciones del mes actual o de meses anteriores.");
    const duplicate = distributions.some((item) => item.id !== editingId && item.year === year && item.month === month && !item.isAutomatic);
    if (duplicate) return setErrorMsg("Ya existe una distribución oficial para ese mes.");
    try {
      if (editingId) {
        const distribution = distributions.find((item) => item.id === editingId);
        if (distribution?.isAutomatic) return setErrorMsg("La distribución automática no se puede editar.");
        await updateDoc(doc(db, "distributions", editingId), { month, year });
      } else {
        await setDoc(doc(db, "distributions", periodDocumentId(currentUserId, year, month)), { name: "Distribución", userId: currentUserId, month, year, isAutomatic: false, createdAt: serverTimestamp() }, { merge: true });
      }
      setErrorMsg(""); setEditingId(null); setPendingDeleteId(null);
    } catch { setErrorMsg("No se pudo guardar la distribución."); }
  };

  const startEditing = (distribution: Distribution) => {
    if (distribution.isAutomatic) return setErrorMsg("La distribución automática no se puede editar.");
    setEditingId(distribution.id); setMonth(distribution.month); setYear(distribution.year); setPendingDeleteId(null);
  };
  const confirmDelete = async (id: string) => {
    const distribution = distributions.find((item) => item.id === id);
    if (distribution?.isAutomatic) return setErrorMsg("La distribución automática no se puede eliminar.");
    if (pendingDeleteId !== id) return setPendingDeleteId(id);
    try { await deleteDoc(doc(db, "distributions", id)); setPendingDeleteId(null); } catch { setErrorMsg("No se pudo eliminar la distribución."); }
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-5 py-10">
      <section className="w-[90vw] max-w-7xl rounded-3xl border border-white/25 bg-white/10 p-6 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <div className="flex items-center justify-between gap-4"><BackButton href="/isorropia">Volver al menú</BackButton><span className="text-xs uppercase tracking-[0.15em] text-white/50">Gestión mensual</span></div>
        <h1 className="font-display mt-10 text-center text-2xl uppercase tracking-widest text-[#adc0fa] sm:text-4xl">Distribución</h1>
        {errorMsg && <p className="mx-auto mt-6 max-w-4xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-sm text-red-200">{errorMsg}</p>}
        {!currentUserId ? <p className="mx-auto mt-10 max-w-4xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">Inicia sesión para cargar tus distribuciones.</p> : <>
          <form onSubmit={saveDistribution} className="mx-auto mt-10 max-w-4xl rounded-2xl border border-white/15 bg-black/15 p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-sm uppercase text-white/85">{editingId ? "Editar distribución" : "Nueva distribución"}</h2>{editingId && <button type="button" onClick={() => setEditingId(null)} className="text-xs uppercase text-white/60 hover:text-white">Cancelar</button>}</div><div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs uppercase text-white/70">Mes<select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white">{months.map((name, index) => <option key={name} value={index} disabled={year === currentYear && index > currentMonth}>{name}</option>)}</select></label><label className="text-xs uppercase text-white/70">Año<select value={year} onChange={(event) => { const nextYear = Number(event.target.value); setYear(nextYear); if (nextYear === currentYear && month > currentMonth) setMonth(currentMonth); }} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white">{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button type="submit" disabled={!selectedPeriodIsValid} className="rounded-xl bg-[#adc0fa] px-5 py-3 text-xs uppercase text-[#121212] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{editingId ? "Guardar" : "Crear"}</button></div>{!selectedPeriodIsValid && <p className="mt-3 text-xs text-amber-300">No se permiten meses futuros.</p>}</form>
          <div className="mx-auto mt-8 max-w-4xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm uppercase text-white/85">Distribuciones registradas</h2><span className="text-xs text-white/50">{distributions.length} registros</span></div>{orderedDistributions.length === 0 ? <div className="rounded-2xl border border-dashed border-white/25 px-6 py-12 text-center text-sm text-white/55">No hay distribuciones creadas todavía.</div> : <div className="space-y-3">{orderedDistributions.map((distribution) => <div key={distribution.id} className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-base text-white">{distribution.name}: {months[distribution.month]} {distribution.year}</p><p className="mt-1 text-xs uppercase text-white/45">{distribution.isAutomatic ? "Rollover automático" : "Distribución mensual"}</p></div><div className="flex flex-wrap gap-2"><Link href={`/distribucion/${distribution.id}`} className="rounded-lg bg-[#adc0fa] px-4 py-2 text-xs uppercase text-[#121212] hover:bg-white">Gestionar</Link><button type="button" disabled={distribution.isAutomatic} onClick={() => startEditing(distribution)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase text-white/80 disabled:cursor-not-allowed disabled:opacity-40">Editar</button>{pendingDeleteId === distribution.id ? <><button type="button" onClick={() => confirmDelete(distribution.id)} className="rounded-lg bg-red-500/80 px-4 py-2 text-xs uppercase">Confirmar eliminación</button><button type="button" onClick={() => setPendingDeleteId(null)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase">Cancelar</button></> : <button type="button" disabled={distribution.isAutomatic} onClick={() => confirmDelete(distribution.id)} className="rounded-lg border border-red-300/30 px-4 py-2 text-xs uppercase text-red-200 disabled:cursor-not-allowed disabled:opacity-40">Eliminar</button>}</div></div>)}</div>}</div>
        </>}
      </section>
    </main>
  );
}

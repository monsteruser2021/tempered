"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BackButton from "@/shared/ui/back-button";
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
import { useSession } from "@/shared/auth/session-context";

const categories = [
  "Gastos básicos", "Fondo de emergencia", "Inversión", "Ahorro",
  "Transporte", "Caridad", "Lujo/gustos", "Otros gastos",
];
const dollarCategories = ["Inversiones", "Ahorro", "Fondo de emergencia"];
const months = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type Reparto = {
  id: string;
  name: string;
  month: number;
  year: number;
  isAutomatic: boolean;
};
type PreviousIncome = { totalBs: number; percentages: Record<string, number> };
type PreviousTransaction = { category: string; incomeBs: number; expenseBs: number };
type PreviousDollarTransaction = { category: string; incomeUsd: number; expenseUsd: number };
type IncomeDraft = {
  id: string;
  repartoId: string;
  description: string;
  amount: number;
  currency: "Bs" | "$";
  date: string;
};

const periodValue = (year: number, month: number) => year * 12 + month;
const periodDocumentId = (userId: string, year: number, month: number) => `period-${encodeURIComponent(userId)}-${year}-${String(month + 1).padStart(2, "0")}`;

export default function RepartoFondos() {
  const { userId: currentUserId } = useSession();
  const [repartos, setRepartos] = useState<Reparto[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [incomeDrafts, setIncomeDrafts] = useState<IncomeDraft[]>([]);
  const [incomeDraftOwnerId, setIncomeDraftOwnerId] = useState("");
  const rolloverInProgress = useRef(false);
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentPeriod = periodValue(currentYear, currentMonth);
  const years = Array.from({ length: Math.max(1, currentYear - 2021 + 1) }, (_, index) => 2021 + index);

  const createRollover = useCallback(async (available: Reparto[], userId: string) => {
    if (rolloverInProgress.current) return;
    rolloverInProgress.current = true;
    try {
      const currentRepartos = available.filter((item) => item.year === currentYear && item.month === currentMonth);
      let currentReparto = currentRepartos.find((item) => !item.isAutomatic);
      if (!currentReparto) {
        const legacyRollover = currentRepartos.find((item) => item.isAutomatic);
        if (legacyRollover) {
          await updateDoc(doc(db, "distributions", legacyRollover.id), { name: "Reparto de Fondos", isAutomatic: false, convertedFromRollover: true, updatedAt: serverTimestamp() });
          currentReparto = { ...legacyRollover, name: "Reparto de Fondos", isAutomatic: false };
        } else {
          const repartoRef = doc(db, "distributions", periodDocumentId(userId, currentYear, currentMonth));
          await setDoc(repartoRef, { name: "Reparto de Fondos", userId, month: currentMonth, year: currentYear, isAutomatic: false, createdAt: serverTimestamp() }, { merge: true });
          currentReparto = { id: repartoRef.id, name: "Reparto de Fondos", month: currentMonth, year: currentYear, isAutomatic: false };
        }
      }

      const currentRef = doc(db, "distributions", currentReparto.id);
      const legacyRepartos = currentRepartos.filter((item) => item.isAutomatic && item.id !== currentReparto.id);
      if (legacyRepartos.length > 0) {
        const migrationBatch = writeBatch(db);
        for (const legacyReparto of legacyRepartos) {
          const [legacyIncomes, legacyDollarTransactions] = await Promise.all([
            getDocs(collection(db, "distributions", legacyReparto.id, "incomes")),
            getDocs(collection(db, "distributions", legacyReparto.id, "dollarTransactions")),
          ]);
          legacyIncomes.docs.forEach((income) => {
            migrationBatch.set(doc(db, "distributions", currentReparto.id, "incomes", income.id), income.data(), { merge: true });
            migrationBatch.delete(income.ref);
          });
          legacyDollarTransactions.docs.forEach((transaction) => {
            migrationBatch.set(doc(db, "distributions", currentReparto.id, "dollarTransactions", transaction.id), transaction.data(), { merge: true });
            migrationBatch.delete(transaction.ref);
          });
          migrationBatch.delete(doc(db, "distributions", legacyReparto.id));
        }
        await migrationBatch.commit();
      }

      const [incomeSnapshot, dollarTransactionSnapshot, currentSnapshot] = await Promise.all([
        getDocs(collection(db, "distributions", currentReparto.id, "incomes")),
        getDocs(collection(db, "distributions", currentReparto.id, "dollarTransactions")),
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
            const incomeRef = doc(db, "distributions", currentReparto.id, "incomes", `rollover-${encodeURIComponent(category)}`);
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
            const transactionRef = doc(db, "distributions", currentReparto.id, "dollarTransactions", `rollover-${encodeURIComponent(category)}`);
            dollarBatch.set(transactionRef, { category, date: `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`, description: `Restante del mes anterior: ${category}`, incomeUsd: amount, expenseUsd: 0, isRollover: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          });
        }
        await dollarBatch.commit();
      }
    } catch {
      setErrorMsg("No se pudo preparar automáticamente el reparto de fondos del mes.");
    } finally {
      rolloverInProgress.current = false;
    }
  }, [currentMonth, currentPeriod, currentYear]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "") return;
    const userId = currentUserId.trim();
    const repartosQuery = query(collection(db, "distributions"), where("userId", "==", userId));
    const unsubscribe = onSnapshot(repartosQuery, (snapshot) => {
      const available = snapshot.docs.map((item) => ({ id: item.id, name: "Reparto de Fondos", month: Number(item.data().month), year: Number(item.data().year), isAutomatic: item.data().isAutomatic === true })).sort((a, b) => periodValue(b.year, b.month) - periodValue(a.year, a.month));
      setRepartos(available);
      setErrorMsg("");
      void createRollover(available, userId);
    }, (error) => {
      if (process.env.NODE_ENV !== "production") {
        console.error("Error al cargar los repartos de fondos de Isorropia:", error.code, error.message);
      }
      setRepartos([]);
      setErrorMsg("No se pudieron cargar los repartos de fondos.");
    });
    return () => unsubscribe();
  }, [createRollover, currentUserId]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "") return;
    const userId = currentUserId.trim();
    return onSnapshot(
      query(collection(db, "plannedIncomeDrafts"), where("userId", "==", userId)),
      (snapshot) => {
        setIncomeDrafts(snapshot.docs.flatMap((item) => {
          const data = item.data();
          if (
            data.status !== "draft"
            || typeof data.repartoId !== "string"
            || typeof data.description !== "string"
            || typeof data.amount !== "number"
            || !Number.isFinite(data.amount)
            || (data.currency !== "Bs" && data.currency !== "$")
            || typeof data.date !== "string"
          ) return [];
          return [{
            id: item.id,
            repartoId: data.repartoId,
            description: data.description,
            amount: data.amount,
            currency: data.currency,
            date: data.date,
          }];
        }).sort((first, second) => second.date.localeCompare(first.date)));
        setIncomeDraftOwnerId(userId);
      },
      () => setErrorMsg("No se pudieron cargar los borradores de ingresos."),
    );
  }, [currentUserId]);

  const orderedRepartos = useMemo(() => [...repartos].sort((a, b) => periodValue(b.year, b.month) - periodValue(a.year, a.month)), [repartos]);
  const selectedPeriodIsValid = periodValue(year, month) <= currentPeriod;

  const saveReparto = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUserId) return setErrorMsg("Debes iniciar sesión para continuar.");
    if (!selectedPeriodIsValid) return setErrorMsg("Solo puedes crear repartos de fondos del mes actual o de meses anteriores.");
    const duplicate = repartos.some((item) => item.id !== editingId && item.year === year && item.month === month && !item.isAutomatic);
    if (duplicate) return setErrorMsg("Ya existe un reparto de fondos oficial para ese mes.");
    try {
      if (editingId) {
        const reparto = repartos.find((item) => item.id === editingId);
        if (reparto?.isAutomatic) return setErrorMsg("El reparto de fondos automático no se puede editar.");
        await updateDoc(doc(db, "distributions", editingId), { month, year });
      } else {
        await setDoc(doc(db, "distributions", periodDocumentId(currentUserId, year, month)), { name: "Reparto de Fondos", userId: currentUserId, month, year, isAutomatic: false, createdAt: serverTimestamp() }, { merge: true });
      }
      setErrorMsg(""); setEditingId(null); setPendingDeleteId(null);
    } catch { setErrorMsg("No se pudo guardar el reparto de fondos."); }
  };

  const startEditing = (reparto: Reparto) => {
    if (reparto.isAutomatic) return setErrorMsg("El reparto de fondos automático no se puede editar.");
    setEditingId(reparto.id); setMonth(reparto.month); setYear(reparto.year); setPendingDeleteId(null);
  };
  const confirmDelete = async (id: string) => {
    const reparto = repartos.find((item) => item.id === id);
    if (reparto?.isAutomatic) return setErrorMsg("El reparto de fondos automático no se puede eliminar.");
    if (pendingDeleteId !== id) return setPendingDeleteId(id);
    try { await deleteDoc(doc(db, "distributions", id)); setPendingDeleteId(null); } catch { setErrorMsg("No se pudo eliminar el reparto de fondos."); }
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-5 py-10">
      <section className="w-[90vw] max-w-7xl rounded-3xl border border-white/25 bg-white/10 p-6 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <div className="flex items-center justify-between gap-4"><BackButton href="/isorropia">Volver al menú</BackButton><span className="text-xs uppercase tracking-[0.15em] text-white/50">Gestión mensual</span></div>
        <h1 className="font-display mt-10 text-center text-2xl uppercase tracking-widest text-[#adc0fa] sm:text-4xl">Reparto de Fondos</h1>
        {errorMsg && <p className="mx-auto mt-6 max-w-4xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-sm text-red-200">{errorMsg}</p>}
        {currentUserId && incomeDraftOwnerId === currentUserId.trim() && incomeDrafts.length > 0 && <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-amber-300/45 bg-amber-950/25 p-5 sm:p-6" aria-labelledby="income-drafts-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] uppercase tracking-[0.18em] text-amber-200/65">Pendiente de aprobación</p><h2 id="income-drafts-title" className="mt-1 text-sm uppercase text-amber-100">Borradores de ingresos</h2></div>
            <span className="text-xs text-white/50">{incomeDrafts.length} por distribuir</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {incomeDrafts.map((draft) => <article key={draft.id} className="rounded-xl border border-white/10 bg-black/25 p-4">
              <p className="wrap-break-word text-sm text-white">{draft.description}</p>
              <p className="mt-2 text-xs text-white/55">{draft.date} · {draft.currency} {draft.amount.toFixed(2)}</p>
              <Link href={`/reparto-fondos/${draft.repartoId}?draftId=${draft.id}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-amber-300 px-4 py-2 text-xs font-semibold uppercase text-[#211702] hover:bg-amber-200">Continuar reparto</Link>
            </article>)}
          </div>
        </section>}
        {!currentUserId ? <p className="mx-auto mt-10 max-w-4xl rounded-2xl border border-dashed border-white/25 p-8 text-center text-sm text-white/60">Inicia sesión para cargar tus repartos de fondos.</p> : <>
          <form onSubmit={saveReparto} className="mx-auto mt-10 max-w-4xl rounded-2xl border border-white/15 bg-black/15 p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-sm uppercase text-white/85">{editingId ? "Editar reparto de fondos" : "Nuevo reparto de fondos"}</h2>{editingId && <button type="button" onClick={() => setEditingId(null)} className="text-xs uppercase text-white/60 hover:text-white">Cancelar</button>}</div><div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs uppercase text-white/70">Mes<select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white">{months.map((name, index) => <option key={name} value={index} disabled={year === currentYear && index > currentMonth}>{name}</option>)}</select></label><label className="text-xs uppercase text-white/70">Año<select value={year} onChange={(event) => { const nextYear = Number(event.target.value); setYear(nextYear); if (nextYear === currentYear && month > currentMonth) setMonth(currentMonth); }} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white">{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button type="submit" disabled={!selectedPeriodIsValid} className="rounded-xl bg-[#adc0fa] px-5 py-3 text-xs uppercase text-[#121212] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{editingId ? "Guardar" : "Crear"}</button></div>{!selectedPeriodIsValid && <p className="mt-3 text-xs text-amber-300">No se permiten meses futuros.</p>}</form>
          <div className="mx-auto mt-8 max-w-4xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm uppercase text-white/85">Repartos de Fondos registrados</h2><span className="text-xs text-white/50">{repartos.length} registros</span></div>{orderedRepartos.length === 0 ? <div className="rounded-2xl border border-dashed border-white/25 px-6 py-12 text-center text-sm text-white/55">No hay repartos de fondos creados todavía.</div> : <div className="space-y-3">{orderedRepartos.map((reparto) => <div key={reparto.id} className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-base text-white">{reparto.name}: {months[reparto.month]} {reparto.year}</p><p className="mt-1 text-xs uppercase text-white/45">{reparto.isAutomatic ? "Rollover automático" : "Reparto de Fondos mensual"}</p></div><div className="flex flex-wrap gap-2"><Link href={`/reparto-fondos/${reparto.id}`} className="rounded-lg bg-[#adc0fa] px-4 py-2 text-xs uppercase text-[#121212] hover:bg-white">Gestionar</Link><button type="button" disabled={reparto.isAutomatic} onClick={() => startEditing(reparto)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase text-white/80 disabled:cursor-not-allowed disabled:opacity-40">Editar</button>{pendingDeleteId === reparto.id ? <><button type="button" onClick={() => confirmDelete(reparto.id)} className="rounded-lg bg-red-500/80 px-4 py-2 text-xs uppercase">Confirmar eliminación</button><button type="button" onClick={() => setPendingDeleteId(null)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase">Cancelar</button></> : <button type="button" disabled={reparto.isAutomatic} onClick={() => confirmDelete(reparto.id)} className="rounded-lg border border-red-300/30 px-4 py-2 text-xs uppercase text-red-200 disabled:cursor-not-allowed disabled:opacity-40">Eliminar</button>}</div></div>)}</div>}</div>
        </>}
      </section>
    </main>
  );
}

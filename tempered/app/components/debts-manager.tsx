"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, deleteField, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { localDateString } from "./task-data";
import { useSession } from "./session-context";
import BackButton from "./back-button";

type DebtType = "receivable" | "payable";
type Currency = "Bs" | "$";
type BalanceTransactionLink = { distributionId: string; transactionId: string };
type Debt = {
  id: string;
  userId: string;
  title: string;
  type: DebtType;
  amount: number;
  currency: Currency;
  dueDate: string;
  paid: boolean;
  paidAmount: number;
  balanceTransactions: BalanceTransactionLink[];
};

type Totals = Record<DebtType, Record<Currency, number>>;
const emptyTotals: Totals = { receivable: { Bs: 0, "$": 0 }, payable: { Bs: 0, "$": 0 } };
type DebtInput = Omit<Debt, "id" | "userId" | "paidAmount" | "balanceTransactions">;

const debtCategory = (currency: Currency) => currency === "Bs" ? "Otros gastos" : "Ahorro";
const paymentCategoryLabel = (currency: Currency) => currency === "Bs" ? "Otros Gastos" : "Ahorro";
const paymentNotice = (type: DebtType, currency: Currency, amount: number) => type === "receivable"
  ? `Cobro de deuda registrado: ${money(amount, currency)} acreditados a ${paymentCategoryLabel(currency)}.`
  : `Pago de deuda registrado: ${money(amount, currency)} debitados de ${paymentCategoryLabel(currency)}. Si el saldo era insuficiente, el balance reflejará el saldo negativo.`;

function money(value: number, symbol: Currency) {
  return `${symbol} ${value.toFixed(2)}`;
}

function getBalanceTransactions(data: Record<string, unknown>): BalanceTransactionLink[] {
  const links = Array.isArray(data.balanceTransactions)
    ? data.balanceTransactions.filter((item): item is BalanceTransactionLink => (
      Boolean(item)
      && typeof item === "object"
      && typeof (item as BalanceTransactionLink).distributionId === "string"
      && typeof (item as BalanceTransactionLink).transactionId === "string"
    ))
    : [];
  const legacy = data.balanceTransaction;
  if (
    legacy
    && typeof legacy === "object"
    && typeof (legacy as BalanceTransactionLink).distributionId === "string"
    && typeof (legacy as BalanceTransactionLink).transactionId === "string"
  ) {
    const link = legacy as BalanceTransactionLink;
    if (!links.some((item) => item.distributionId === link.distributionId && item.transactionId === link.transactionId)) {
      links.push(link);
    }
  }
  return links;
}

function getPaidAmount(data: Record<string, unknown> | undefined, amount: number) {
  if (!data) return 0;
  if (typeof data.paidAmount === "number" && Number.isFinite(data.paidAmount)) return Math.min(amount, Math.max(0, data.paidAmount));
  return data.paid === true ? amount : 0;
}

async function saveDebtAndPayment(userId: string, debtId: string | null, input: DebtInput, paymentOverride?: number, reversePayments = false) {
  const debtRef = debtId ? doc(db, "debts", debtId) : doc(collection(db, "debts"));
  const today = localDateString();
  const [year, month] = today.split("-").map(Number);
  let currentDistributionId: string | undefined;

  if (paymentOverride !== undefined || input.paid) {
    const distributions = await getDocs(query(collection(db, "distributions"), where("userId", "==", userId)));
    const currentDistributions = distributions.docs.filter((item) => {
      const data = item.data();
      return Number(data.month) === month - 1 && Number(data.year) === year;
    });
    currentDistributionId = (currentDistributions.find((item) => item.data().isAutomatic !== true) ?? currentDistributions[0])?.id;
  }

  return runTransaction(db, async (transaction) => {
    const existingSnapshot = debtId ? await transaction.get(debtRef) : null;
    if (debtId && !existingSnapshot?.exists()) throw new Error("La deuda ya no existe o no está disponible.");

    const existingData = existingSnapshot?.data();
    if (existingData && existingData.userId !== userId) throw new Error("No tienes permiso para actualizar esta deuda.");
    const existingAmount = Number(existingData?.amount ?? 0);
    const existingPaidAmount = getPaidAmount(existingData, existingAmount);
    const existingIsPaid = Boolean(existingData) && (
      existingData?.paid === true
      || existingPaidAmount >= existingAmount - 0.005
    );
    const balanceTransactions = getBalanceTransactions(existingData ?? {});
    const hasPayments = existingPaidAmount > 0 || balanceTransactions.length > 0;
    const monetaryDetailsChanged = existingData && (
      existingData.type !== input.type
      || existingData.currency !== input.currency
      || existingAmount !== input.amount
    );
    if (hasPayments && monetaryDetailsChanged) {
      throw new Error("Para cambiar el tipo, moneda o monto, revierte primero los abonos registrados.");
    }

    const needsReversal = reversePayments || (
      paymentOverride === undefined
      && existingIsPaid
      && !input.paid
    );
    const amountToApply = paymentOverride !== undefined
      ? Math.round(paymentOverride * 100) / 100
      : input.paid && !existingIsPaid
        ? Math.round((input.amount - existingPaidAmount) * 100) / 100
        : 0;
    if (paymentOverride !== undefined && (!Number.isFinite(amountToApply) || amountToApply <= 0)) {
      throw new Error("Indica un monto de abono mayor que cero.");
    }
    if (amountToApply > input.amount - existingPaidAmount + 0.005) {
      throw new Error("El abono supera el saldo pendiente de la deuda.");
    }
    if (paymentOverride !== undefined && existingIsPaid) {
      throw new Error("Esta deuda ya está saldada.");
    }

    const nextPaidAmount = needsReversal ? 0 : Math.min(input.amount, existingPaidAmount + amountToApply);
    const nextPaid = nextPaidAmount >= input.amount - 0.005;
    const needsPayment = amountToApply > 0;
    const distributionId = currentDistributionId;
    if (needsPayment) {
      if (!distributionId) throw new Error("No existe una distribución para el mes actual; créala antes de registrar el pago.");
      const distributionRef = doc(db, "distributions", distributionId);
      const distributionSnapshot = await transaction.get(distributionRef);
      const distribution = distributionSnapshot.data();
      if (
        !distributionSnapshot.exists()
        || distribution?.userId !== userId
        || Number(distribution.month) !== month - 1
        || Number(distribution.year) !== year
      ) {
        throw new Error("La distribución del mes actual ya no está disponible. Actualiza la página e inténtalo de nuevo.");
      }
    }

    const reversalRefs = needsReversal
      ? balanceTransactions.map((link) => doc(
        db,
        "distributions",
        link.distributionId,
        existingData?.currency === "$" ? "dollarTransactions" : "transactions",
        link.transactionId,
      ))
      : [];
    const reversalSnapshots = await Promise.all(reversalRefs.map((reference) => transaction.get(reference)));
    if (reversalSnapshots.some((snapshot) => !snapshot.exists())) {
      throw new Error("No se pudo revertir el pago porque falta uno de sus movimientos en el balance.");
    }

    let newBalanceTransaction: BalanceTransactionLink | undefined;
    if (needsPayment) {
      if (!distributionId) throw new Error("No existe una distribución para el mes actual; créala antes de registrar el pago.");
      const category = debtCategory(input.currency);
      const balanceCollection = input.currency === "Bs" ? "transactions" : "dollarTransactions";
      const movementType = input.type === "payable" ? "payment" : "collection";
      const balanceTransactionRef = doc(collection(db, "distributions", distributionId, balanceCollection));
      const description = input.type === "payable"
        ? `Pago de deuda: ${input.title}`
        : `Cobro recuperado de deuda: ${input.title}`;
      const isIncome = input.type === "receivable";
      const balanceTransaction = input.currency === "Bs"
        ? { category, date: today, description, incomeBs: isIncome ? amountToApply : 0, expenseBs: isIncome ? 0 : amountToApply }
        : { category, date: today, description, incomeUsd: isIncome ? amountToApply : 0, expenseUsd: isIncome ? 0 : amountToApply };
      transaction.set(balanceTransactionRef, {
        ...balanceTransaction,
        isDebtPayment: movementType === "payment",
        isDebtCollection: movementType === "collection",
        debtMovementType: movementType,
        debtId: debtRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      newBalanceTransaction = { distributionId, transactionId: balanceTransactionRef.id };
    }
    reversalRefs.forEach((reference) => transaction.delete(reference));

    const debtData = {
      title: input.title,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
      paid: nextPaid,
      paidAmount: nextPaidAmount,
      updatedAt: serverTimestamp(),
    };
    if (debtId) {
      transaction.update(debtRef, {
        ...debtData,
        ...(newBalanceTransaction ? { balanceTransactions: [...balanceTransactions, newBalanceTransaction] } : {}),
        ...(needsReversal ? { balanceTransactions: deleteField(), balanceTransaction: deleteField() } : {}),
      });
    } else {
      transaction.set(debtRef, {
        ...debtData,
        userId,
        ...(newBalanceTransaction ? { balanceTransactions: [newBalanceTransaction] } : {}),
        createdAt: serverTimestamp(),
      });
    }

    return { applied: amountToApply, paid: nextPaid, reversed: needsReversal, movementType: input.type === "payable" ? "payment" as const : "collection" as const };
  });
}

export default function DebtsManager() {
  const { userId } = useSession();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DebtType>("receivable");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("Bs");
  const [dueDate, setDueDate] = useState(localDateString());
  const [paid, setPaid] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const today = localDateString();

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, "debts"), where("userId", "==", userId)),
      (snapshot) => setDebts(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          userId,
          title: String(data.title ?? ""),
          type: data.type === "payable" ? "payable" : "receivable",
          amount: Number(data.amount ?? 0),
          currency: data.currency === "$" ? "$" : "Bs",
          dueDate: String(data.dueDate ?? ""),
          paidAmount: getPaidAmount(data, Number(data.amount ?? 0)),
          paid: data.paid === true || getPaidAmount(data, Number(data.amount ?? 0)) >= Number(data.amount ?? 0) - 0.005,
          balanceTransactions: getBalanceTransactions(data),
        };
      })),
      () => setError("No se pudieron cargar las deudas."),
    );
  }, [userId]);

  const totals = useMemo(() => debts.reduce<Totals>((result, debt) => {
    if (!debt.paid) result[debt.type][debt.currency] += Math.max(0, debt.amount - debt.paidAmount);
    return result;
  }, structuredClone(emptyTotals)), [debts]);
  const pending = useMemo(() => debts.filter((debt) => !debt.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [debts]);
  const settled = useMemo(() => debts.filter((debt) => debt.paid), [debts]);

  const resetForm = () => {
    setTitle(""); setType("receivable"); setAmount(""); setCurrency("Bs");
    setDueDate(localDateString()); setPaid(false); setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!userId || !title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !dueDate || saving || busyId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await saveDebtAndPayment(userId, editingId || null, {
        title: title.trim(), type, amount: numericAmount, currency, dueDate, paid,
      });
      if (result.applied > 0) {
        setNotice(paymentNotice(type, currency, result.applied));
      } else if (result.reversed) {
        setNotice("La deuda volvió a pendiente y todos sus movimientos de balance se revirtieron.");
      } else {
        setNotice(editingId ? "Deuda actualizada correctamente." : "Deuda registrada correctamente.");
      }
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la deuda ni actualizar el balance.");
    } finally {
      setSaving(false);
    }
  };

  const togglePaid = async (debt: Debt) => {
    if (busyId || saving || !userId) return;
    setBusyId(debt.id); setError(""); setNotice("");
    try {
      const result = await saveDebtAndPayment(userId, debt.id, {
        title: debt.title,
        type: debt.type,
        amount: debt.amount,
        currency: debt.currency,
        dueDate: debt.dueDate,
        paid: !debt.paid,
      });
      if (result.applied > 0) {
        setNotice(paymentNotice(debt.type, debt.currency, result.applied));
      } else if (result.reversed) {
        setNotice("La deuda volvió a pendiente y todos sus movimientos de balance se revirtieron.");
      } else {
        setNotice(debt.type === "payable" ? "Deuda marcada como pendiente." : "Deuda marcada como saldada.");
      }
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "No se pudo actualizar el estado de la deuda ni su balance.");
    } finally {
      setBusyId("");
    }
  };

  const registerPayment = async (debt: Debt) => {
    const paymentAmount = Number(paymentAmounts[debt.id]);
    if (!userId || busyId || saving || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setError("Indica un monto de abono mayor que cero.");
      return;
    }
    setBusyId(debt.id); setError(""); setNotice("");
    try {
      const result = await saveDebtAndPayment(userId, debt.id, {
        title: debt.title,
        type: debt.type,
        amount: debt.amount,
        currency: debt.currency,
        dueDate: debt.dueDate,
        paid: debt.paid,
      }, paymentAmount);
      setNotice(paymentNotice(debt.type, debt.currency, result.applied));
      setPaymentAmounts((current) => ({ ...current, [debt.id]: "" }));
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "No se pudo registrar el abono.");
    } finally {
      setBusyId("");
    }
  };

  const reversePayments = async (debt: Debt) => {
    if (!userId || busyId || saving || debt.paidAmount <= 0) return;
    setBusyId(debt.id); setError(""); setNotice("");
    try {
      await saveDebtAndPayment(userId, debt.id, {
        title: debt.title,
        type: debt.type,
        amount: debt.amount,
        currency: debt.currency,
        dueDate: debt.dueDate,
        paid: false,
      }, undefined, true);
      setNotice("Todos los abonos se revirtieron y la deuda volvió a su saldo pendiente original.");
      setPaymentAmounts((current) => ({ ...current, [debt.id]: "" }));
    } catch (reversalError) {
      setError(reversalError instanceof Error ? reversalError.message : "No se pudieron revertir los abonos de la deuda.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (debt: Debt) => {
    if (busyId || !window.confirm(`¿Eliminar ${debt.title}?`)) return;
    if (debt.paidAmount > 0) {
      setError("No se puede eliminar una deuda con abonos registrados. Reviértela primero para conservar la integridad del balance.");
      return;
    }
    setBusyId(debt.id);
    try {
      await deleteDoc(doc(db, "debts", debt.id));
      if (editingId === debt.id) resetForm();
    } catch {
      setError("No se pudo eliminar la deuda.");
    } finally {
      setBusyId("");
    }
  };

  const edit = (debt: Debt) => {
    setEditingId(debt.id); setTitle(debt.title); setType(debt.type); setAmount(String(debt.amount));
    setCurrency(debt.currency); setDueDate(debt.dueDate); setPaid(debt.paid);
  };

  const renderDebt = (debt: Debt) => {
    const overdue = !debt.paid && debt.dueDate < today;
    const outstanding = Math.max(0, debt.amount - debt.paidAmount);
    return <article key={debt.id} className={`border p-4 transition-colors sm:p-5 ${overdue ? "border-red-400/80 bg-red-950/50" : "border-[#ddab36]/35 bg-black/35"}`}>
      <div className="flex min-w-0 items-start gap-3">
        <input type="checkbox" checked={debt.paid} disabled={Boolean(busyId) || saving} onChange={() => void togglePaid(debt)} aria-label={debt.paid ? `Revertir abonos de ${debt.title}` : `Saldar ${debt.title} con el monto pendiente`} className="mt-1 size-5 shrink-0 accent-[#ddab36]" />
        <div className="min-w-0 flex-1"><h3 className={`wrap-break-word text-sm uppercase ${debt.paid ? "text-white/50 line-through" : "text-white"}`}>{debt.title}</h3><p className="mt-2 wrap-break-word text-xs uppercase text-white/60">{debt.type === "receivable" ? "Me deben" : "Debo"} · {money(debt.amount, debt.currency)}</p><p className="mt-2 wrap-break-word text-xs uppercase text-white/60">Abonado: {money(debt.paidAmount, debt.currency)} · Pendiente: {money(outstanding, debt.currency)}</p><p className={`mt-2 wrap-break-word text-xs uppercase ${overdue ? "font-bold text-red-200" : "text-white/50"}`}>{overdue ? "Vencida · " : "Compromiso · "}{debt.dueDate}{debt.paid ? " · Saldada" : ""}</p></div>
      </div>
      {!debt.paid && <form onSubmit={(event) => { event.preventDefault(); void registerPayment(debt); }} className="mt-4 flex items-end justify-between gap-3"><label className="min-w-0 w-full max-w-48 text-xs uppercase text-white/55">{debt.type === "receivable" ? "Monto cobrado" : "Monto pagado"}<input type="number" min="0.01" max={outstanding.toFixed(2)} step="0.01" value={paymentAmounts[debt.id] ?? ""} onChange={(event) => setPaymentAmounts((current) => ({ ...current, [debt.id]: event.target.value }))} placeholder={outstanding.toFixed(2)} disabled={Boolean(busyId) || saving} className="mt-1 min-h-10 w-full rounded-lg border border-[#ddab36]/25 bg-[#121212] px-3 py-2 text-sm text-white disabled:opacity-50" /></label><button type="submit" disabled={Boolean(busyId) || saving || outstanding <= 0} className="w-fit shrink-0 whitespace-nowrap rounded-lg bg-[#ddab36] px-3 py-2 text-xs font-bold uppercase leading-5 text-[#121212] disabled:opacity-50">{debt.type === "receivable" ? "Registrar cobro" : "Registrar pago"}</button></form>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{!debt.paid && debt.paidAmount > 0 && <button type="button" onClick={() => void reversePayments(debt)} disabled={Boolean(busyId) || saving} className="min-h-10 rounded-lg border border-amber-300/40 px-3 py-2 text-xs uppercase text-amber-100 hover:bg-amber-900/30 disabled:opacity-50">Revertir abonos</button>}<button type="button" onClick={() => edit(debt)} disabled={Boolean(busyId) || saving} className="min-h-10 rounded-lg border border-[#ddab36]/45 px-3 py-2 text-xs uppercase text-[#ddab36] hover:bg-[#ddab36]/15 disabled:opacity-50">Editar</button><button type="button" onClick={() => void remove(debt)} disabled={Boolean(busyId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">Eliminar</button></div>
    </article>;
  };

  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-wrap items-center justify-between gap-4"><BackButton href="/isorropia">Volver al menú</BackButton><Link href="/menu" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Panel Tempered</Link></div><header className="mt-10 max-w-3xl"><p className="text-xs uppercase tracking-[0.2em] text-white/60">Isorropia Kairos / Control financiero</p><h1 className="mt-4 max-w-full wrap-break-word text-3xl uppercase tracking-widest text-[#ddab36] sm:text-5xl">Deudas pendientes</h1><p className="mt-5 max-w-full wrap-break-word text-sm leading-7 text-white/65">Cuentas por cobrar y obligaciones, con sus fechas de compromiso.</p></header>
    {!userId && <p className="mt-6 border border-[#ddab36]/35 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
    {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}
    {notice && <p role="status" aria-live="polite" className="mt-6 border border-emerald-300/40 bg-emerald-950/40 p-4 text-sm text-emerald-100">{notice}</p>}
    <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Resumen de deudas"><Kpi title="Total que me deben" totals={totals.receivable} /><Kpi title="Total que debo" totals={totals.payable} /></section>
    <form onSubmit={submit} className="mt-8 border border-[#ddab36]/35 bg-black/55 p-5 sm:p-7"><h2 className="text-lg uppercase text-[#ddab36]">{editingId ? "Editar deuda" : "Nueva deuda"}</h2><div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]"><label className="block text-xs uppercase text-white/65">Título / concepto<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={!userId || saving} placeholder="Ej. Préstamo a Juan" className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" /></label><label className="block text-xs uppercase text-white/65">Tipo<select value={type} onChange={(event) => setType(event.target.value as DebtType)} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none"><option value="receivable">Me deben</option><option value="payable">Debo</option></select></label></div><div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_12rem]"><label className="block text-xs uppercase text-white/65">Monto<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" /></label><label className="block text-xs uppercase text-white/65">Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none"><option value="Bs">Bolívares - Bs</option><option value="$">Dólares - $</option></select></label><label className="block text-xs uppercase text-white/65">Fecha límite<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#ddab36]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#ddab36] disabled:opacity-50" /></label></div><label className="mt-4 flex max-w-full items-center gap-3 text-xs uppercase text-white/70"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} disabled={!userId || saving} className="size-5 shrink-0 accent-[#ddab36]" /> Pagado / saldado</label><div className="mt-5 flex flex-wrap gap-3"><button type="submit" disabled={!userId || saving} className="min-h-11 rounded-lg bg-[#ddab36] px-5 py-3 text-xs font-bold uppercase text-[#121212] hover:bg-[#f0c55a] disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Registrar deuda"}</button>{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-lg border border-[#ddab36]/45 px-5 py-3 text-xs uppercase text-[#ddab36]">Cancelar</button>}</div></form>
    <DebtList title="Pendientes" debts={pending} empty="No hay deudas pendientes." renderDebt={renderDebt} /><DebtList title="Pagadas / saldadas" debts={settled} empty="Aún no hay deudas saldadas." renderDebt={renderDebt} />
  </main>;
}

function Kpi({ title, totals }: { title: string; totals: Record<Currency, number> }) {
  return <article className="min-w-0 border border-[#ddab36]/35 bg-black/45 p-5"><h2 className="max-w-full wrap-break-word text-xs uppercase tracking-[0.12em] text-white/60">{title}</h2><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xl text-[#ddab36]"><span>{totals.Bs.toFixed(2)} Bs</span><span>{totals["$"].toFixed(2)} $</span></div><p className="mt-2 text-xs uppercase text-white/40">Solo pendientes</p></article>;
}

function DebtList({ title, debts, empty, renderDebt }: { title: string; debts: Debt[]; empty: string; renderDebt: (debt: Debt) => React.ReactNode }) {
  return <section className="mt-10" aria-labelledby={title}><div className="flex flex-wrap items-end justify-between gap-3"><h2 id={title} className="max-w-full wrap-break-word text-xl uppercase text-[#ddab36]">{title}</h2><span className="text-xs text-white/50">{debts.length} registros</span></div><div className="mt-5 space-y-3">{debts.length ? debts.map(renderDebt) : <p className="border border-dashed border-[#ddab36]/30 p-5 text-sm text-white/55">{empty}</p>}</div></section>;
}

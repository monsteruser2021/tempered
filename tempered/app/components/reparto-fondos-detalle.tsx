"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { approvePlannedIncomeDraft, PLANNER_CATEGORIES } from "@/lib/planner";
import type { Currency } from "@/lib/debt-payments";
import BackButton from "./back-button";
import { useSession } from "./session-context";

type Percentages = Record<string, number>;
type PercentageInputs = Record<string, string>;
type Income = {
  id: string;
  description: string;
  totalBs: number;
  percentages: Percentages;
  date: string;
};
type IncomeDraft = {
  id: string;
  repartoId: string;
  description: string;
  amount: number;
  currency: Currency;
  date: string;
  status: "draft" | "approved";
  suggestedPercentages: Percentages;
  negativeBalances: Record<string, number>;
};
type Props = { repartoId: string; draftId?: string };

const categoriesByCurrency = PLANNER_CATEGORIES;
const emptyPercentages = (currency: Currency): Percentages =>
  Object.fromEntries(categoriesByCurrency[currency].map((category) => [category, 0]));
const emptyPercentageInputs = (currency: Currency): PercentageInputs =>
  Object.fromEntries(categoriesByCurrency[currency].map((category) => [category, ""]));

export default function RepartoFondosDetalle({ repartoId, draftId }: Props) {
  const { userId: currentUserId } = useSession();
  const [isOwner, setIsOwner] = useState(false);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [approvedDollarDrafts, setApprovedDollarDrafts] = useState<IncomeDraft[]>([]);
  const [draft, setDraft] = useState<IncomeDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [draftCompleted, setDraftCompleted] = useState(false);
  const loadedDraftId = useRef("");
  const [description, setDescription] = useState("");
  const [totalBs, setTotalBs] = useState("");
  const [currency, setCurrency] = useState<Currency>("Bs");
  const [date, setDate] = useState("");
  const [percentageInputs, setPercentageInputs] = useState<PercentageInputs>(emptyPercentageInputs("Bs"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const categories = categoriesByCurrency[currency];

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "") return;
    const userId = currentUserId.trim();

    return onSnapshot(
      doc(db, "distributions", repartoId),
      (snapshot) => {
        setIsOwner(snapshot.exists() && snapshot.data().userId === userId);
      },
      () => setErrorMsg("No se pudo cargar el reparto de fondos."),
    );
  }, [currentUserId, repartoId]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "" || !isOwner) return;

    return onSnapshot(
      collection(db, "distributions", repartoId, "incomes"),
      (snapshot) => {
        setIncomes(snapshot.docs.map((item) => ({
          id: item.id,
          description: String(item.data().description ?? ""),
          totalBs: Number(item.data().totalBs ?? 0),
          date: String(item.data().date ?? ""),
          percentages: {
            ...emptyPercentages("Bs"),
            ...(item.data().percentages as Percentages | undefined),
          },
        })));
      },
      () => setErrorMsg("No se pudieron cargar los ingresos."),
    );
  }, [currentUserId, repartoId, isOwner]);

  useEffect(() => {
    if (typeof currentUserId !== "string" || currentUserId.trim() === "" || !isOwner) return;
    const userId = currentUserId.trim();
    return onSnapshot(
      query(collection(db, "plannedIncomeDrafts"), where("userId", "==", userId)),
      (snapshot) => {
        const matchingDrafts = snapshot.docs.flatMap((item) => {
          const data = item.data();
          if (data.repartoId !== repartoId || data.currency !== "$" || data.status !== "approved") return [];
          if (
            typeof data.description !== "string"
            || typeof data.amount !== "number"
            || !Number.isFinite(data.amount)
            || typeof data.date !== "string"
          ) return [];
          const percentages = data.allocationPercentages;
          if (!percentages || typeof percentages !== "object") return [];
          return [{
            id: item.id,
            repartoId,
            description: data.description,
            amount: data.amount,
            currency: "$" as const,
            date: data.date,
            status: "approved" as const,
            suggestedPercentages: { ...emptyPercentages("$"), ...(percentages as Percentages) },
            negativeBalances: {},
          }];
        });
        setApprovedDollarDrafts(matchingDrafts);
      },
      () => setErrorMsg("No se pudieron cargar las distribuciones en dólares."),
    );
  }, [currentUserId, isOwner, repartoId]);

  useEffect(() => {
    if (!draftId || typeof currentUserId !== "string" || currentUserId.trim() === "" || !isOwner) {
      return;
    }
    return onSnapshot(
      doc(db, "plannedIncomeDrafts", draftId),
      (snapshot) => {
        const data = snapshot.data();
        const currencyValue: unknown = data?.currency;
        if (!snapshot.exists() || !data || data.userId !== currentUserId.trim() || data.repartoId !== repartoId) {
          setDraft(null);
          setDraftLoading(false);
          setErrorMsg("El borrador no existe o no pertenece a este reparto.");
          return;
        }
        if (data.status === "approved") {
          setDraft(null);
          setDraftCompleted(true);
          setDraftLoading(false);
          return;
        }
        if (
          data.status !== "draft"
          || typeof data.description !== "string"
          || typeof data.amount !== "number"
          || !Number.isFinite(data.amount)
          || (currencyValue !== "Bs" && currencyValue !== "$")
          || typeof data.date !== "string"
        ) {
          setDraft(null);
          setDraftLoading(false);
          setErrorMsg("El borrador tiene datos incompletos y no se puede revisar.");
          return;
        }
        const draftCurrency: Currency = currencyValue;
        const dataPercentages = data.suggestedPercentages;
        const dataNegativeBalances = data.negativeBalances;
        if (loadedDraftId.current !== snapshot.id) {
          setCurrency(draftCurrency);
          setDescription(data.description);
          setTotalBs(String(data.amount));
          setDate(data.date);
          setPercentageInputs(Object.fromEntries(categoriesByCurrency[draftCurrency].map((category) => [
            category,
            String((dataPercentages && typeof dataPercentages === "object"
              ? (dataPercentages as Percentages)[category]
              : undefined) ?? 0),
          ])));
          setEditingId(null);
          setDraftCompleted(false);
          loadedDraftId.current = snapshot.id;
        }
        setDraft({
          id: snapshot.id,
          repartoId,
          description: data.description,
          amount: data.amount,
          currency: draftCurrency,
          date: data.date,
          status: "draft",
          suggestedPercentages: {
            ...emptyPercentages(draftCurrency),
            ...(dataPercentages && typeof dataPercentages === "object" ? dataPercentages as Percentages : {}),
          },
          negativeBalances: dataNegativeBalances && typeof dataNegativeBalances === "object"
            ? dataNegativeBalances as Record<string, number>
            : {},
        });
        setDraftLoading(false);
      },
      () => {
        setDraft(null);
        setDraftLoading(false);
        setErrorMsg("No se pudo cargar el borrador.");
      },
    );
  }, [currentUserId, draftId, isOwner, repartoId]);

  const totalIncome = useMemo(
    () => incomes.reduce((sum, income) => sum + income.totalBs, 0),
    [incomes],
  );

  const percentages = Object.fromEntries(categories.map((category) => [category, Number(percentageInputs[category]) || 0])) as Percentages;
  const percentageTotal = Object.values(percentages).reduce((sum, value) => sum + value, 0);

  const percentagesAreComplete = Math.abs(percentageTotal - 100) < 0.0001
    && categories.every((category) => {
      const value = percentageInputs[category] ?? "";
      return value === "" || (Number(value) >= 0 && Number(value) <= 100);
    });

  const resetForm = () => {
    setDescription("");
    setTotalBs("");
    setCurrency("Bs");
    setDate("");
    setPercentageInputs(emptyPercentageInputs("Bs"));
    setEditingId(null);
  };

  const updatePercentage = (category: string, value: string) => {
    setPercentageInputs((current) => ({
      ...current,
      [category]: value,
    }));
  };

  const saveIncome = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(totalBs);
    if (!isOwner || !currentUserId || (!draft && (!description.trim() || !Number.isFinite(amount) || amount <= 0))) {
      setErrorMsg("Completa una descripción y un monto válido.");
      return;
    }
    if (!percentagesAreComplete) {
      setErrorMsg(`Los porcentajes deben sumar exactamente 100%. Actualmente suman ${percentageTotal.toFixed(2)}%.`);
      return;
    }

    setSaving(true);
    try {
      if (draft) {
        await approvePlannedIncomeDraft(currentUserId, draft.id, { percentages });
        setDraftCompleted(true);
        setDraft(null);
        setErrorMsg("");
        resetForm();
        return;
      }

      const incomeData = {
        description: description.trim(),
        totalBs: amount,
        percentages,
        ...(date ? { date } : {}),
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, "distributions", repartoId, "incomes", editingId), incomeData);
      } else {
        await addDoc(collection(db, "distributions", repartoId, "incomes"), {
          ...incomeData,
          createdAt: serverTimestamp(),
        });
      }

      resetForm();
      setErrorMsg("");
    } catch (saveError) {
      setErrorMsg(saveError instanceof Error ? saveError.message : "No se pudo guardar el ingreso.");
    } finally {
      setSaving(false);
    }
  };

  const editIncome = (income: Income) => {
    setEditingId(income.id);
    setDescription(income.description);
    setTotalBs(String(income.totalBs));
    setCurrency("Bs");
    setDate(income.date);
    setPercentageInputs(Object.fromEntries(categoriesByCurrency.Bs.map((category) => [category, String(income.percentages[category] ?? 0)])));
    setPendingDeleteId(null);
  };

  const deleteIncome = async (id: string) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }

    try {
      await deleteDoc(doc(db, "distributions", repartoId, "incomes", id));
      setPendingDeleteId(null);
      if (editingId === id) resetForm();
    } catch {
      setErrorMsg("No se pudo eliminar el ingreso.");
    }
  };

  if (!currentUserId || !isOwner) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-10">
        <section className="w-[90vw] max-w-4xl rounded-3xl border border-white/25 bg-white/10 p-8 text-center text-white shadow-2xl shadow-black/30 backdrop-blur-xl">
          <p className="text-sm text-white/70">El reparto de fondos no existe o no tienes acceso.</p>
          <BackButton href="/reparto-fondos">Volver a Reparto de Fondos</BackButton>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-[90vw] max-w-7xl rounded-3xl border border-white/25 bg-white/10 p-6 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <BackButton href="/reparto-fondos">Volver a Reparto de Fondos</BackButton>
        <h1 className="font-display mt-10 text-center text-2xl uppercase tracking-[0.1em] text-[#adc0fa] sm:text-4xl">Ingresos del periodo</h1>
        {errorMsg && <p className="mx-auto mt-6 max-w-4xl rounded-xl border border-red-500/50 bg-red-500/20 p-3 text-center text-sm text-red-200">{errorMsg}</p>}
        {draftLoading && <p role="status" className="mx-auto mt-8 max-w-4xl text-center text-sm text-white/60">Cargando borrador...</p>}
        {draftCompleted && <p role="status" className="mx-auto mt-8 max-w-4xl rounded-xl border border-emerald-300/40 bg-emerald-950/35 p-4 text-sm text-emerald-100">Reparto aprobado y registrado. Los balances ya incluyen la distribución confirmada.</p>}

        {!draftLoading && !draftCompleted && (!draftId || draft) && <form onSubmit={saveIncome} className="mx-auto mt-10 max-w-4xl rounded-2xl border border-white/15 bg-black/15 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm uppercase text-white/85">{draft ? "Revisar borrador de ingreso" : editingId ? "Editar ingreso" : "Nuevo ingreso"}</h2>
            {editingId && <button type="button" onClick={resetForm} className="text-xs uppercase text-white/60 hover:text-white">Cancelar</button>}
          </div>
          {draft && <p className="mt-2 text-xs leading-5 text-amber-100/70">Revisa la propuesta de porcentajes y confirma. Este borrador no afecta los balances hasta que lo apruebes.</p>}
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-xs uppercase text-white/70">Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} readOnly={Boolean(draft)} placeholder="Ej. Quincena" className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm normal-case text-white outline-none read-only:opacity-75" /></label>
            <label className="text-xs uppercase text-white/70">Monto total · {currency}<input value={totalBs} onChange={(event) => setTotalBs(event.target.value)} type="number" min="0" step="0.01" placeholder="100" readOnly={Boolean(draft)} className="mt-2 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white outline-none read-only:opacity-75" /></label>
            {!draft && <button disabled={saving || !percentagesAreComplete} type="submit" className="rounded-xl bg-[#adc0fa] px-5 py-3 text-xs uppercase text-[#121212] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</button>}
          </div>
          {draft && <label className="mt-4 block max-w-sm text-xs uppercase text-white/70">Fecha del ingreso<input type="date" value={date} readOnly className="mt-2 min-h-11 w-full rounded-xl border border-white/25 bg-[#121212]/80 px-4 py-3 text-sm text-white read-only:opacity-75" /></label>}
          <div className="mt-6 border-t border-white/10 pt-5">
            <h3 className="text-xs uppercase text-white/60">Porcentajes de este ingreso · {currency}</h3>
            <p className={`mt-2 text-sm ${percentagesAreComplete ? "text-emerald-300" : "text-amber-300"}`}>
              Total asignado: {percentageTotal.toFixed(4)}% {percentagesAreComplete ? "(completo)" : "(debe ser exactamente 100%)"}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {categories.map((category) => {
                const negativeBalance = draft?.negativeBalances[category];
                const isNegative = typeof negativeBalance === "number" && negativeBalance < 0;
                return <label key={category} className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${isNegative ? "border-red-300/45 bg-red-950/35 text-red-100" : "border-white/10 text-white/80"}`}>
                  <span className="min-w-0">
                    <span className="block">{category}{isNegative && <span className="ml-2 text-[10px] uppercase text-red-200">Prioridad</span>}</span>
                    {isNegative && <span className="mt-1 block text-[10px] text-red-200/75">Saldo negativo detectado: {currency} {negativeBalance.toFixed(2)}</span>}
                  </span>
                  <span className="relative w-32 shrink-0"><input type="number" min="0" max="100" step="0.000001" placeholder="0" value={percentageInputs[category] ?? ""} onChange={(event) => updatePercentage(category, event.target.value)} className="w-full rounded-xl border border-white/25 bg-[#121212]/80 px-3 py-2 pr-8 text-right text-white outline-none placeholder:text-white/40" /><span className="absolute right-3 top-2 text-white/50">%</span></span>
                </label>;
              })}
            </div>
          </div>
          {!percentagesAreComplete && <p className="mt-4 text-xs text-amber-300">Distribuye el 100% del ingreso antes de guardar.</p>}
          {draft && <button disabled={saving || !percentagesAreComplete} type="submit" className="mt-6 min-h-11 rounded-xl bg-emerald-300 px-5 py-3 text-xs font-semibold uppercase text-[#102317] hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Registrando..." : "Aprobar y Registrar"}</button>}
        </form>}

        <div className="mx-auto mt-8 max-w-4xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm uppercase text-white/85">Ingresos registrados</h2><span className="text-xs text-[#adc0fa]">Total: {totalIncome.toFixed(2)} Bs · {approvedDollarDrafts.reduce((sum, item) => sum + item.amount, 0).toFixed(2)} $</span></div>
          {incomes.length === 0 && approvedDollarDrafts.length === 0 ? <div className="rounded-2xl border border-dashed border-white/25 px-6 py-12 text-center text-sm text-white/55">Aún no hay ingresos para este periodo.</div> : <div className="space-y-4">
            {incomes.map((income) => <article key={income.id} className="rounded-2xl border border-white/15 bg-black/15 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-base text-white">{income.description}</h3><p className="mt-1 text-sm text-[#adc0fa]">{income.totalBs.toFixed(2)} Bs</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => editIncome(income)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase text-white/80 hover:bg-white/15">Editar</button>{pendingDeleteId === income.id ? <><button type="button" onClick={() => deleteIncome(income.id)} className="rounded-lg bg-red-500/80 px-4 py-2 text-xs uppercase">Confirmar eliminación</button><button type="button" onClick={() => setPendingDeleteId(null)} className="rounded-lg border border-white/25 px-4 py-2 text-xs uppercase">Cancelar</button></> : <button type="button" onClick={() => deleteIncome(income.id)} className="rounded-lg border border-red-300/30 px-4 py-2 text-xs uppercase text-red-200">Eliminar</button>}</div></div><div className="mt-5 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2">{categoriesByCurrency.Bs.map((category) => { const percentage = income.percentages[category] ?? 0; return <div key={category} className="flex justify-between text-xs text-white/65"><span>{category} ({percentage}%)</span><span className="text-[#adc0fa]">{(income.totalBs * percentage / 100).toFixed(2)} Bs</span></div>; })}</div></article>)}
            {approvedDollarDrafts.map((income) => <article key={income.id} className="rounded-2xl border border-white/15 bg-black/15 p-5"><div><h3 className="text-base text-white">{income.description}</h3><p className="mt-1 text-sm text-emerald-200">$ {income.amount.toFixed(2)} · {income.date}</p></div><div className="mt-5 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2">{categoriesByCurrency["$"].map((category) => <div key={category} className="flex justify-between text-xs text-white/65"><span>{category} ({income.suggestedPercentages[category] ?? 0}%)</span><span className="text-emerald-200">$ {((income.amount * (income.suggestedPercentages[category] ?? 0)) / 100).toFixed(2)}</span></div>)}</div></article>)}
          </div>}
        </div>
      </section>
    </main>
  );
}

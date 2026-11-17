"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useSession } from "./session-context";
import BackButton from "./back-button";

type Currency = "Bs" | "$";
type Condition = "Nuevo" | "Usado";
type ProjectStatus = "evaluation" | "process" | "liquidated" | "discarded";
type Investment = {
  id: string;
  userId: string;
  title: string;
  category: string;
  currency: Currency;
  cost: number;
  saleEstimate: number;
  condition: Condition;
  quantity: number;
  remainingStock: number;
  soldUnits: number;
  status: ProjectStatus;
};

type Totals = Record<Currency, number>;
const statuses: { value: ProjectStatus; label: string }[] = [
  { value: "evaluation", label: "💡 En evaluación" },
  { value: "process", label: "⏳ En proceso o comprado" },
  { value: "liquidated", label: "✅ Liquidado o vendido" },
  { value: "discarded", label: "❌ Descartado" },
];
const categories = ["Reventa", "Comercio", "Activo digital", "Servicios"];
const emptyTotals: Totals = { Bs: 0, "$": 0 };
const statusPriority: Record<ProjectStatus, number> = { process: 0, evaluation: 1, liquidated: 2, discarded: 3 };

function calculateProfit(cost: number, saleEstimate: number) {
  return saleEstimate - cost;
}

function totalCost(investment: Investment) {
  return investment.cost * investment.quantity;
}

function totalSaleEstimate(investment: Investment) {
  return investment.saleEstimate * investment.quantity;
}

function calculateRoi(cost: number, saleEstimate: number) {
  return cost > 0 ? (calculateProfit(cost, saleEstimate) / cost) * 100 : 0;
}

export default function MythicalGrowthManager() {
  const { userId } = useSession();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [currency, setCurrency] = useState<Currency>("Bs");
  const [cost, setCost] = useState("");
  const [saleEstimate, setSaleEstimate] = useState("");
  const [condition, setCondition] = useState<Condition>("Nuevo");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<ProjectStatus>("evaluation");
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof userId !== "string" || userId.trim() === "") return;
    const ownerId = userId.trim();
    return onSnapshot(
      query(collection(db, "mythicalInvestments"), where("userId", "==", ownerId)),
      (snapshot) => setInvestments(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          userId: ownerId,
          title: String(data.title ?? ""),
          category: String(data.category ?? "Otros"),
          currency: data.currency === "$" ? "$" : "Bs",
          cost: Number(data.unitCost ?? data.cost ?? 0),
          saleEstimate: Number(data.unitSalePrice ?? data.saleEstimate ?? 0),
          condition: data.condition === "Usado" ? "Usado" : "Nuevo",
          quantity: Math.max(1, Math.floor(Number(data.quantity ?? 1))),
          remainingStock: Math.max(0, Math.floor(Number(data.remainingStock ?? data.quantity ?? 1))),
          soldUnits: Math.max(0, Math.floor(Number(data.soldUnits ?? 0))),
          status: statuses.some((option) => option.value === data.status) ? data.status as ProjectStatus : "evaluation",
        };
      })),
      () => setError("No se pudieron cargar los proyectos de Mythical Growth."),
    );
  }, [userId]);

  const committed = useMemo(() => investments.filter((investment) => investment.status !== "discarded").reduce<Totals>((totals, investment) => {
    totals[investment.currency] += totalCost(investment);
    return totals;
  }, { ...emptyTotals }), [investments]);
  const projectedProfit = useMemo(() => investments.filter((investment) => investment.status !== "discarded").reduce<Totals>((totals, investment) => {
    totals[investment.currency] += calculateProfit(totalCost(investment), totalSaleEstimate(investment));
    return totals;
  }, { ...emptyTotals }), [investments]);
  const activeInvestments = useMemo(() => investments
    .filter((investment) => investment.status === "process" || investment.status === "evaluation")
    .sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || a.title.localeCompare(b.title)), [investments]);
  const closedInvestments = useMemo(() => investments
    .filter((investment) => investment.status === "liquidated" || investment.status === "discarded")
    .sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || a.title.localeCompare(b.title)), [investments]);

  const resetForm = () => {
    setTitle(""); setCategory(categories[0]); setCurrency("Bs"); setCost(""); setSaleEstimate(""); setCondition("Nuevo"); setQuantity("1"); setStatus("evaluation"); setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericCost = Number(cost);
    const numericSaleEstimate = Number(saleEstimate);
    const numericQuantity = Number(quantity);
    const currentInvestment = investments.find((investment) => investment.id === editingId);
    if (!userId || !title.trim() || !Number.isFinite(numericCost) || numericCost <= 0 || !Number.isFinite(numericSaleEstimate) || numericSaleEstimate < 0 || !Number.isInteger(numericQuantity) || numericQuantity < 1 || (currentInvestment && numericQuantity < currentInvestment.soldUnits) || saving) return;
    setSaving(true); setError("");
    try {
      const data = { title: title.trim(), category, currency, cost: numericCost, saleEstimate: numericSaleEstimate, unitCost: numericCost, unitSalePrice: numericSaleEstimate, condition, quantity: numericQuantity, remainingStock: currentInvestment ? numericQuantity - currentInvestment.soldUnits : numericQuantity, soldUnits: currentInvestment?.soldUnits ?? 0, status, updatedAt: serverTimestamp() };
      if (editingId) await updateDoc(doc(db, "mythicalInvestments", editingId), data);
      else await addDoc(collection(db, "mythicalInvestments"), { ...data, userId, createdAt: serverTimestamp() });
      resetForm();
    } catch {
      setError("No se pudo guardar el proyecto.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (investment: Investment) => {
    if (actionId || !window.confirm(`¿Eliminar ${investment.title}?`)) return;
    setActionId(investment.id);
    try {
      await deleteDoc(doc(db, "mythicalInvestments", investment.id));
      if (editingId === investment.id) resetForm();
    } catch {
      setError("No se pudo eliminar el proyecto.");
    } finally {
      setActionId("");
    }
  };

  const updateStatus = async (investment: Investment, nextStatus: ProjectStatus) => {
    if (actionId || investment.status === nextStatus) return;
    setActionId(investment.id);
    setInvestments((current) => current.map((item) => item.id === investment.id ? { ...item, status: nextStatus } : item));
    try {
      await updateDoc(doc(db, "mythicalInvestments", investment.id), { status: nextStatus, updatedAt: serverTimestamp() });
    } catch {
      setInvestments((current) => current.map((item) => item.id === investment.id ? investment : item));
      setError("No se pudo actualizar el estado del proyecto.");
    } finally {
      setActionId("");
    }
  };

  const edit = (investment: Investment) => {
    setEditingId(investment.id); setTitle(investment.title); setCategory(investment.category); setCurrency(investment.currency); setCost(String(investment.cost)); setSaleEstimate(String(investment.saleEstimate)); setCondition(investment.condition); setQuantity(String(investment.quantity)); setStatus(investment.status);
  };

  const previewCost = Number(cost) || 0;
  const previewSale = Number(saleEstimate) || 0;
  const format = (value: number, itemCurrency: Currency) => `${itemCurrency} ${value.toFixed(2)}`;

  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-center justify-between gap-4"><BackButton href="/menu">Volver a Tempered</BackButton><Link href="/menu" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Panel Tempered</Link></div>
    <header className="mt-10 max-w-3xl"><p className="text-xs uppercase tracking-[0.2em] text-white/60">Tempered / Crecimiento</p><h1 className="mt-4 max-w-full wrap-break-word text-3xl uppercase tracking-widest text-[#d9a7ff] sm:text-5xl">Mythical Growth</h1><p className="mt-5 max-w-full wrap-break-word text-sm leading-7 text-white/65">Controla capital, reventas y proyectos pequeños con una mirada clara sobre el retorno esperado.</p></header>
    {!userId && <p className="mt-6 border border-[#d9a7ff]/35 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
    {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}
    <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Resumen financiero"><Metric title="Capital comprometido" totals={committed} /><Metric title="Ganancia neta proyectada" totals={projectedProfit} /></section>
    <form onSubmit={submit} className="mt-8 border border-[#d9a7ff]/30 bg-black/55 p-5 sm:p-7"><h2 className="text-lg uppercase text-[#d9a7ff]">{editingId ? "Editar proyecto" : "Nuevo proyecto"}</h2><div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]"><label className="block text-xs uppercase text-white/65">Título / proyecto<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={!userId || saving} placeholder="Ej. Lote de forros Redmi 12" className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d9a7ff] disabled:opacity-50" /></label><label className="block text-xs uppercase text-white/65">Categoría<select value={category} onChange={(event) => setCategory(event.target.value)} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none"><option value="Reventa">Reventa</option><option value="Comercio">Comercio</option><option value="Activo digital">Activo digital</option><option value="Servicios">Servicios</option><option value="Otros">Otros</option></select></label></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="block text-xs uppercase text-white/65">Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none"><option value="Bs">Bolívares - Bs</option><option value="$">Dólares - $</option></select></label><label className="block text-xs uppercase text-white/65">Inversión inicial<input type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d9a7ff] disabled:opacity-50" /></label><label className="block text-xs uppercase text-white/65">Venta estimada<input type="number" min="0" step="0.01" value={saleEstimate} onChange={(event) => setSaleEstimate(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d9a7ff] disabled:opacity-50" /></label></div><div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><label className="block text-xs uppercase text-white/65">Estado<select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-3 py-3 text-sm text-white outline-none">{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="border border-[#d9a7ff]/25 bg-[#3b0764]/20 p-4"><p className="text-xs uppercase text-white/55">Proyección en vivo</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span className={calculateProfit(previewCost, previewSale) >= 0 ? "text-emerald-300" : "text-red-300"}>Ganancia: {format(calculateProfit(previewCost, previewSale), currency)}</span><span className="text-[#d9a7ff]">ROI: {calculateRoi(previewCost, previewSale).toFixed(2)}%</span></div></div></div><div className="mt-5 flex flex-wrap gap-3"><button type="submit" disabled={!userId || saving} className="min-h-11 rounded-lg bg-[#d9a7ff] px-5 py-3 text-xs font-bold uppercase text-[#121212] hover:bg-white disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Registrar proyecto"}</button>{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-lg border border-[#d9a7ff]/45 px-5 py-3 text-xs uppercase text-[#d9a7ff]">Cancelar</button>}</div></form>
    <section className="mt-10" aria-labelledby="projects-title"><div className="flex flex-wrap items-end justify-between gap-3"><h2 id="projects-title" className="max-w-full wrap-break-word text-xl uppercase text-[#d9a7ff]">Proyectos activos</h2><span className="text-xs text-white/50">{activeInvestments.length} registros</span></div>{activeInvestments.length === 0 ? <p className="mt-5 border border-dashed border-[#d9a7ff]/30 p-5 text-sm text-white/55">No hay proyectos activos o en evaluación.</p> : <div className="mt-5 grid gap-4 lg:grid-cols-2">{activeInvestments.map((investment) => <article key={investment.id} className="min-w-0 border border-[#d9a7ff]/25 bg-black/40 p-4 sm:p-5"><div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0"><h3 className="wrap-break-word text-sm uppercase text-white">{investment.title}</h3><p className="mt-2 wrap-break-word text-xs uppercase text-white/55">{investment.category} · {format(investment.cost, investment.currency)} de inversión</p></div><span className="shrink-0 text-xs text-[#d9a7ff]">{investment.currency}</span></div><div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-xs"><p className="wrap-break-word text-white/65">Venta: <strong className="text-white">{format(investment.saleEstimate, investment.currency)}</strong></p><p className={calculateProfit(investment.cost, investment.saleEstimate) >= 0 ? "wrap-break-word text-emerald-300" : "wrap-break-word text-red-300"}>Neto: {format(calculateProfit(investment.cost, investment.saleEstimate), investment.currency)}</p><p className="text-[#d9a7ff]">ROI: {calculateRoi(investment.cost, investment.saleEstimate).toFixed(2)}%</p><p className="wrap-break-word text-white/55">{statuses.find((item) => item.value === investment.status)?.label}</p></div><div className="mt-4 flex flex-wrap gap-2"><select aria-label={`Cambiar estado de ${investment.title}`} value={investment.status} onChange={(event) => void updateStatus(investment, event.target.value as ProjectStatus)} disabled={Boolean(actionId) || saving} className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#d9a7ff]/30 bg-[#121212] px-3 py-2 text-xs text-white"><option value="evaluation">💡 En evaluación</option><option value="process">⏳ En proceso o comprado</option><option value="liquidated">✅ Liquidado o vendido</option><option value="discarded">❌ Descartado</option></select><button type="button" onClick={() => edit(investment)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-[#d9a7ff]/40 px-3 py-2 text-xs uppercase text-[#d9a7ff] hover:bg-[#3b0764]/30 disabled:opacity-50">Editar</button><button type="button" onClick={() => void remove(investment)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">Eliminar</button></div></article>)}</div>}</section>
    <section className="mt-12" aria-labelledby="closed-projects-title"><div className="flex flex-wrap items-end justify-between gap-3"><h2 id="closed-projects-title" className="max-w-full wrap-break-word text-xl uppercase text-[#d9a7ff]">Historial de Inversiones (Cerradas)</h2><span className="text-xs text-white/50">{closedInvestments.length} registros</span></div>{closedInvestments.length === 0 ? <p className="mt-5 border border-dashed border-[#d9a7ff]/30 p-5 text-sm text-white/55">No hay inversiones liquidadas o descartadas.</p> : <div className="mt-5 grid gap-4 lg:grid-cols-2">{closedInvestments.map((investment) => <article key={investment.id} className="min-w-0 border border-white/15 bg-black/25 p-4 opacity-90 sm:p-5"><div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0"><h3 className="wrap-break-word text-sm uppercase text-white/75">{investment.title}</h3><p className="mt-2 wrap-break-word text-xs uppercase text-white/45">{investment.category} · {statuses.find((item) => item.value === investment.status)?.label}</p></div><span className="shrink-0 text-xs text-white/50">{investment.currency}</span></div><div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-xs"><p className="wrap-break-word text-white/55">Inversión: {format(investment.cost, investment.currency)}</p><p className="wrap-break-word text-white/55">Venta: {format(investment.saleEstimate, investment.currency)}</p><p className={calculateProfit(investment.cost, investment.saleEstimate) >= 0 ? "wrap-break-word text-emerald-300" : "wrap-break-word text-red-300"}>Ganancia final: {format(calculateProfit(investment.cost, investment.saleEstimate), investment.currency)}</p><p className="text-[#d9a7ff]">ROI final: {calculateRoi(investment.cost, investment.saleEstimate).toFixed(2)}%</p></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => edit(investment)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-[#d9a7ff]/40 px-3 py-2 text-xs uppercase text-[#d9a7ff] hover:bg-[#3b0764]/30 disabled:opacity-50">Editar</button><button type="button" onClick={() => void remove(investment)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">Eliminar definitivamente</button></div></article>)}</div>}</section>
  </main>;
}

function Metric({ title, totals }: { title: string; totals: Totals }) {
  return <article className="min-w-0 border border-[#d9a7ff]/30 bg-black/45 p-5"><h2 className="max-w-full wrap-break-word text-xs uppercase tracking-[0.12em] text-white/60">{title}</h2><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xl text-[#d9a7ff]"><span>{totals.Bs.toFixed(2)} Bs</span><span>{totals["$"].toFixed(2)} $</span></div><p className="mt-2 text-xs uppercase text-white/40">Proyección por moneda</p></article>;
}

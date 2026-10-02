"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, Lightbulb, Package } from "lucide-react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useSession } from "./session-context";
import BackButton from "./back-button";
import { registerMythicalSale } from "./mythical-growth-data";

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
type SaleRecord = { id: string; investmentId: string; currency: Currency; quantity: number; recoveredCapital: number; netProfit: number; date: string };
type GrowthTab = "projects" | "inventory" | "history";

const statuses: { value: ProjectStatus; label: string }[] = [
  { value: "evaluation", label: "En evaluación" },
  { value: "process", label: "En proceso o comprado" },
  { value: "liquidated", label: "Liquidado o vendido" },
  { value: "discarded", label: "Descartado" },
];
const categories = ["Reventa", "Comercio", "Activo digital", "Servicios", "Otros"];
const emptyTotals: Totals = { Bs: 0, "$": 0 };
const statusPriority: Record<ProjectStatus, number> = { process: 0, evaluation: 1, liquidated: 2, discarded: 3 };
const fieldClass = "mt-2 min-h-12 w-full border border-[#d9a7ff]/30 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d9a7ff] disabled:opacity-50";

function profit(cost: number, salePrice: number) {
  return salePrice - cost;
}

function format(value: number, currency: Currency) {
  return `${currency} ${value.toFixed(2)}`;
}

function mapInvestment(id: string, userId: string, data: Record<string, unknown>): Investment {
  const quantity = Math.max(1, Math.floor(Number(data.quantity ?? 1)));
  return {
    id,
    userId,
    title: String(data.title ?? ""),
    category: String(data.category ?? "Otros"),
    currency: data.currency === "$" ? "$" : "Bs",
    cost: Number(data.unitCost ?? data.cost ?? 0),
    saleEstimate: Number(data.unitSalePrice ?? data.saleEstimate ?? 0),
    condition: data.condition === "Usado" ? "Usado" : "Nuevo",
    quantity,
    remainingStock: Math.max(0, Math.floor(Number(data.remainingStock ?? quantity))),
    soldUnits: Math.max(0, Math.floor(Number(data.soldUnits ?? 0))),
    status: statuses.some((item) => item.value === data.status) ? data.status as ProjectStatus : "evaluation",
  };
}

export default function MythicalGrowthInventory() {
  const { userId } = useSession();
  const [activeTab, setActiveTab] = useState<GrowthTab>("projects");
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [currency, setCurrency] = useState<Currency>("Bs");
  const [cost, setCost] = useState("");
  const [saleEstimate, setSaleEstimate] = useState("");
  const [condition, setCondition] = useState<Condition>("Nuevo");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<ProjectStatus>("evaluation");
  const [editingId, setEditingId] = useState("");
  const [saleInvestment, setSaleInvestment] = useState<Investment | null>(null);
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, "mythicalInvestments"), where("userId", "==", userId)),
      (snapshot) => setInvestments(snapshot.docs.map((item) => mapInvestment(item.id, userId, item.data()))),
      () => setError("No se pudieron cargar los proyectos de Mythical Growth."),
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(
      query(collection(db, "mythicalSales"), where("userId", "==", userId)),
      (snapshot) => setSales(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          investmentId: String(data.investmentId ?? ""),
          currency: data.currency === "$" ? "$" : "Bs",
          quantity: Math.max(0, Math.floor(Number(data.quantity ?? 0))),
          recoveredCapital: Number(data.recoveredCapital ?? 0),
          netProfit: Number(data.netProfit ?? 0),
          date: String(data.date ?? ""),
        };
      })),
      () => setError("No se pudo cargar el historial de ventas."),
    );
  }, [userId]);

  const committed = useMemo(() => investments.filter((item) => item.status === "process").reduce<Totals>((totals, item) => {
    totals[item.currency] += item.cost * item.quantity;
    return totals;
  }, { ...emptyTotals }), [investments]);
  const projectedProfit = useMemo(() => investments.filter((item) => item.status !== "discarded").reduce<Totals>((totals, item) => {
    totals[item.currency] += profit(item.cost, item.saleEstimate) * item.quantity;
    return totals;
  }, { ...emptyTotals }), [investments]);
  const activeInvestments = investments.filter((item) => item.status === "evaluation")
    .sort((first, second) => statusPriority[first.status] - statusPriority[second.status] || first.title.localeCompare(second.title));
  const inventory = investments.filter((item) => item.status === "process" && item.remainingStock > 0)
    .sort((first, second) => first.title.localeCompare(second.title));
  const closedInvestments = investments.filter((item) => item.status === "liquidated" || item.status === "discarded")
    .sort((first, second) => statusPriority[first.status] - statusPriority[second.status] || first.title.localeCompare(second.title));
  const salesByInvestment = useMemo(() => sales.reduce<Record<string, SaleRecord[]>>((grouped, sale) => {
    (grouped[sale.investmentId] ??= []).push(sale);
    return grouped;
  }, {}), [sales]);
  const previewQuantity = Math.max(1, Number(quantity) || 1);
  const minimumQuantity = Math.max(1, investments.find((item) => item.id === editingId)?.soldUnits ?? 1);

  const resetForm = () => {
    setTitle("");
    setCategory(categories[0]);
    setCurrency("Bs");
    setCost("");
    setSaleEstimate("");
    setCondition("Nuevo");
    setQuantity("1");
    setStatus("evaluation");
    setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const unitCost = Number(cost);
    const unitSalePrice = Number(saleEstimate);
    const totalUnits = Number(quantity);
    const current = investments.find((item) => item.id === editingId);
    if (!userId || !title.trim() || !Number.isFinite(unitCost) || unitCost <= 0 || !Number.isFinite(unitSalePrice) || unitSalePrice < 0 || !Number.isInteger(totalUnits) || totalUnits < minimumQuantity || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = {
        title: title.trim(), category, currency, cost: unitCost, saleEstimate: unitSalePrice,
        unitCost, unitSalePrice, condition, quantity: totalUnits,
        remainingStock: current ? totalUnits - current.soldUnits : totalUnits,
        soldUnits: current?.soldUnits ?? 0, status, updatedAt: serverTimestamp(),
      };
      if (editingId) await updateDoc(doc(db, "mythicalInvestments", editingId), data);
      else await addDoc(collection(db, "mythicalInvestments"), { ...data, userId, createdAt: serverTimestamp() });
      resetForm();
    } catch {
      setError("No se pudo guardar el proyecto.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (investment: Investment) => {
    setActiveTab("projects");
    setEditingId(investment.id);
    setTitle(investment.title);
    setCategory(investment.category);
    setCurrency(investment.currency);
    setCost(String(investment.cost));
    setSaleEstimate(String(investment.saleEstimate));
    setCondition(investment.condition);
    setQuantity(String(investment.quantity));
    setStatus(investment.status);
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateStatus = async (investment: Investment, nextStatus: ProjectStatus) => {
    if (!userId || actionId || investment.status === nextStatus) return;
    setActionId(investment.id);
    try {
      await updateDoc(doc(db, "mythicalInvestments", investment.id), { status: nextStatus, updatedAt: serverTimestamp() });
    } catch {
      setError("No se pudo actualizar el estado del proyecto.");
    } finally {
      setActionId("");
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

  const confirmSale = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const soldQuantity = Number(saleQuantity);
    if (!userId || !saleInvestment || !Number.isInteger(soldQuantity) || soldQuantity < 1 || soldQuantity > saleInvestment.remainingStock || actionId) return;
    setActionId(saleInvestment.id);
    setError("");
    setNotice("");
    try {
      const result = await registerMythicalSale({ userId, investmentId: saleInvestment.id, quantity: soldQuantity });
      setNotice(`Venta registrada (${result.date}). Capital recuperado: ${format(result.recoveredCapital, saleInvestment.currency)}; ganancia neta: ${format(result.netProfit, saleInvestment.currency)}.`);
      setSaleInvestment(null);
      setSaleQuantity("1");
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "No se pudo registrar la venta.");
    } finally {
      setActionId("");
    }
  };

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BackButton href="/menu">Volver a Tempered</BackButton>
        <Link href="/menu" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Panel Tempered</Link>
      </div>
      <header className="mt-10 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Tempered / Crecimiento</p>
        <h1 className="mt-4 max-w-full wrap-break-word text-3xl uppercase tracking-widest text-[#d9a7ff] sm:text-5xl">Mythical Growth</h1>
        <p className="mt-5 max-w-full wrap-break-word text-sm leading-7 text-white/65">Controla capital, reventas y proyectos pequeños con una mirada clara sobre el retorno esperado.</p>
      </header>
      {!userId && <p className="mt-6 border border-[#d9a7ff]/35 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" className="mt-6 border border-emerald-300/40 bg-emerald-950/40 p-4 text-sm text-emerald-100">{notice}</p>}

      <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Resumen financiero">
        <Metric title="Capital comprometido" totals={committed} />
        <Metric title="Ganancia neta proyectada" totals={projectedProfit} />
      </section>

      <nav aria-label="Secciones de Mythical Growth" className="sticky top-0 z-30 -mx-4 mt-8 border-y border-[#d9a7ff]/20 bg-[#121212]/45 px-4 py-2 backdrop-blur-md sm:mx-0 sm:rounded-lg sm:border sm:px-2">
        <div role="tablist" aria-label="Mythical Growth" className="grid grid-cols-3 gap-1">
          <TabButton id="projects" activeTab={activeTab} onSelect={setActiveTab} count={activeInvestments.length} icon={<Lightbulb aria-hidden="true" size={17} />} label="Proyectos / Pipeline" />
          <TabButton id="inventory" activeTab={activeTab} onSelect={setActiveTab} count={inventory.length} icon={<Package aria-hidden="true" size={17} />} label="Inventario Activo" />
          <TabButton id="history" activeTab={activeTab} onSelect={setActiveTab} count={closedInvestments.length} icon={<Archive aria-hidden="true" size={17} />} label="Historial" />
        </div>
      </nav>

      {activeTab === "inventory" && <section key="inventory-panel" role="tabpanel" id="inventory-panel" aria-labelledby="inventory-tab" className="item-enter mt-8" tabIndex={0}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="inventory-title" className="text-xl uppercase text-[#d9a7ff]">Inventario Activo</h2>
          <span className="text-xs text-white/50">{inventory.length} productos</span>
        </div>
        {inventory.length === 0 ? <p className="mt-5 border border-dashed border-[#d9a7ff]/30 p-5 text-sm text-white/55">No hay artículos comprados con stock disponible.</p> : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {inventory.map((investment) => (
              <article key={investment.id} className="min-w-0 border border-[#d9a7ff]/25 bg-black/40 p-4 sm:p-5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="wrap-break-word text-sm uppercase text-white">{investment.title}</h3><p className="mt-2 text-xs uppercase text-white/55">{investment.category}</p></div>
                  <span className="shrink-0 border border-[#d9a7ff]/40 px-2 py-1 text-xs text-[#d9a7ff]">{investment.condition}</span>
                </div>
                <p className="mt-4 text-lg text-white">Stock: {investment.remainingStock} / {investment.quantity}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-xs">
                  <p className="text-white/65">Costo unitario: <strong className="text-white">{format(investment.cost, investment.currency)}</strong></p>
                  <p className="text-white/65">Venta unitaria: <strong className="text-white">{format(investment.saleEstimate, investment.currency)}</strong></p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setSaleInvestment(investment); setSaleQuantity("1"); }} disabled={Boolean(actionId)} className="min-h-10 border border-emerald-300/50 px-3 py-2 text-xs uppercase text-emerald-200 hover:bg-emerald-300/10">Registrar Venta</button>
                  <button type="button" onClick={() => edit(investment)} disabled={Boolean(actionId) || saving} className="min-h-10 border border-white/20 px-3 py-2 text-xs uppercase text-white/75">Editar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>}

      {activeTab === "projects" && <section key="projects-panel" role="tabpanel" id="projects-panel" aria-labelledby="projects-tab" className="item-enter mt-8" tabIndex={0}>
      <form onSubmit={submit} className="border border-[#d9a7ff]/30 bg-[#121212]/30 p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg uppercase text-[#d9a7ff]">{editingId ? "Editar proyecto" : "Nuevo proyecto"}</h2>{editingId && <button type="button" onClick={resetForm} className="text-xs uppercase text-white/60 underline">Cancelar edición</button>}</div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Título / proyecto"><input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={!userId || saving} placeholder="Ej. Lote de forros Redmi 12" /></Field>
          <Field label="Categoría"><select className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)} disabled={!userId || saving}>{categories.map((item) => <option key={item}>{item}</option>)}</select></Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Moneda"><select className={fieldClass} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} disabled={!userId || saving}><option value="Bs">Bolívares - Bs</option><option value="$">Dólares - $</option></select></Field>
          <Field label="Condición"><select className={fieldClass} value={condition} onChange={(event) => setCondition(event.target.value as Condition)} disabled={!userId || saving}><option value="Nuevo">Nuevo</option><option value="Usado">Usado</option></select></Field>
          <Field label="Cantidad total de unidades"><input className={fieldClass} type="number" min={minimumQuantity} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required disabled={!userId || saving} /></Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Costo unitario"><input className={fieldClass} type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} required disabled={!userId || saving} /></Field>
          <Field label="Precio de venta unitario"><input className={fieldClass} type="number" min="0" step="0.01" value={saleEstimate} onChange={(event) => setSaleEstimate(event.target.value)} required disabled={!userId || saving} /></Field>
          <Field label="Estado"><select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} disabled={!userId || saving}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        </div>
        <p className="mt-4 text-xs text-white/55">Total del lote ({previewQuantity} unidades): inversión {format((Number(cost) || 0) * previewQuantity, currency)} · venta estimada {format((Number(saleEstimate) || 0) * previewQuantity, currency)} · ganancia neta {format(((Number(saleEstimate) || 0) - (Number(cost) || 0)) * previewQuantity, currency)}</p>
        <button type="submit" disabled={!userId || saving} className="mt-5 min-h-11 bg-[#d9a7ff] px-5 py-3 text-xs uppercase text-black disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar proyecto"}</button>
      </form>

      <section className="mt-10" aria-labelledby="projects-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="projects-title" className="text-xl uppercase text-[#d9a7ff]">Proyectos activos</h2><span className="text-xs text-white/50">{activeInvestments.length} registros</span></div>
        {activeInvestments.length === 0 ? <p className="mt-5 border border-dashed border-[#d9a7ff]/30 p-5 text-sm text-white/55">No hay proyectos activos o en evaluación.</p> : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">{activeInvestments.map((investment) => <ProjectCard key={investment.id} investment={investment} actionId={actionId} onEdit={edit} onRemove={remove} onStatus={updateStatus} />)}</div>
        )}
      </section>
      </section>}

      {activeTab === "history" && <section key="history-panel" role="tabpanel" id="history-panel" aria-labelledby="history-tab" className="item-enter mt-8" tabIndex={0}>
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="closed-title" className="text-xl uppercase text-[#d9a7ff]">Historial de Inversiones</h2><span className="text-xs text-white/50">{closedInvestments.length} registros</span></div>
        {closedInvestments.length === 0 ? <p className="mt-5 border border-dashed border-[#d9a7ff]/30 p-5 text-sm text-white/55">No hay inversiones liquidadas o descartadas.</p> : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">{closedInvestments.map((investment) => <ProjectCard key={investment.id} investment={investment} sales={salesByInvestment[investment.id] ?? []} actionId={actionId} onEdit={edit} onRemove={remove} onStatus={updateStatus} closed />)}</div>
        )}
      </section>
      }

      {saleInvestment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionId) setSaleInvestment(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title" className="w-full max-w-md border border-[#d9a7ff]/40 bg-[#121212] p-5 shadow-2xl sm:p-7">
          <h2 id="sale-dialog-title" className="text-lg uppercase text-[#d9a7ff]">Registrar Venta</h2>
          <p className="mt-2 wrap-break-word text-sm text-white">{saleInvestment.title} · Stock: {saleInvestment.remainingStock} / {saleInvestment.quantity}</p>
          {error && <p role="alert" className="mt-3 border border-red-300/50 bg-red-950/50 p-3 text-xs text-red-100">{error}</p>}
          <form onSubmit={confirmSale} className="mt-5">
            <Field label="Unidades vendidas"><input autoFocus className={fieldClass} type="number" min="1" max={saleInvestment.remainingStock} step="1" required value={saleQuantity} onChange={(event) => setSaleQuantity(event.target.value)} disabled={Boolean(actionId)} /></Field>
            <p className="mt-3 text-xs text-white/55">Capital recuperado: {format(saleInvestment.cost * (Number(saleQuantity) || 0), saleInvestment.currency)} · Ganancia neta: {format(profit(saleInvestment.cost, saleInvestment.saleEstimate) * (Number(saleQuantity) || 0), saleInvestment.currency)}</p>
            <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setSaleInvestment(null)} disabled={Boolean(actionId)} className="min-h-10 border border-white/20 px-3 py-2 text-xs uppercase text-white/70">Cancelar</button><button type="submit" disabled={Boolean(actionId) || !Number.isInteger(Number(saleQuantity)) || Number(saleQuantity) > saleInvestment.remainingStock} className="min-h-10 bg-emerald-300 px-4 py-2 text-xs uppercase text-black disabled:opacity-50">{actionId === saleInvestment.id ? "Registrando..." : "Confirmar venta"}</button></div>
          </form>
        </section>
      </div>}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs uppercase text-white/65">{label}{children}</label>;
}

function TabButton({ id, activeTab, onSelect, count, icon, label }: {
  id: GrowthTab;
  activeTab: GrowthTab;
  onSelect: (tab: GrowthTab) => void;
  count: number;
  icon: React.ReactNode;
  label: string;
}) {
  const tabs: GrowthTab[] = ["projects", "inventory", "history"];
  const selected = id === activeTab;
  const tabId = `${id}-tab`;

  return <button
    id={tabId}
    type="button"
    role="tab"
    aria-selected={selected}
    aria-controls={`${id}-panel`}
    tabIndex={selected ? 0 : -1}
    onClick={() => onSelect(id)}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = tabs.indexOf(id);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      onSelect(tabs[nextIndex]);
      document.getElementById(`${tabs[nextIndex]}-tab`)?.focus();
    }}
    className={`flex min-h-14 min-w-0 items-center justify-center gap-1.5 border-b-2 px-1 text-center text-[10px] uppercase transition-colors sm:gap-2 sm:px-3 sm:text-xs ${selected ? "border-[#d9a7ff] bg-[#d9a7ff]/10 text-[#e5c7ff]" : "border-transparent text-white/55 hover:bg-white/5 hover:text-white/85"}`}
  >
    {icon}<span className="min-w-0">{label}</span><span className={`text-[10px] ${selected ? "text-[#d9a7ff]" : "text-white/40"}`}>{count}</span>
  </button>;
}

function Metric({ title, totals }: { title: string; totals: Totals }) {
  return <article className="min-w-0 border border-[#d9a7ff]/30 bg-black/45 p-5"><h2 className="text-xs uppercase tracking-[0.12em] text-white/60">{title}</h2><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xl text-[#d9a7ff]"><span>{totals.Bs.toFixed(2)} Bs</span><span>{totals["$"].toFixed(2)} $</span></div><p className="mt-2 text-xs uppercase text-white/40">Proyección por moneda</p></article>;
}

function ProjectCard({ investment, sales = [], actionId, onEdit, onRemove, onStatus, closed = false }: {
  investment: Investment;
  sales?: SaleRecord[];
  actionId: string;
  onEdit: (investment: Investment) => void;
  onRemove: (investment: Investment) => void;
  onStatus: (investment: Investment, status: ProjectStatus) => void;
  closed?: boolean;
}) {
  const totalCost = investment.cost * investment.quantity;
  const totalSale = investment.saleEstimate * investment.quantity;
  const projectSales = sales.filter((sale) => sale.currency === investment.currency);
  const realizedCost = projectSales.reduce((sum, sale) => sum + sale.recoveredCapital, 0);
  const realizedGain = projectSales.reduce((sum, sale) => sum + sale.netProfit, 0);
  const realizedRevenue = realizedCost + realizedGain;
  return <article className={`min-w-0 border ${closed ? "border-white/15 bg-black/25" : "border-[#d9a7ff]/25 bg-black/40"} p-4 sm:p-5`}>
    <div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0"><h3 className="wrap-break-word text-sm uppercase text-white">{investment.title}</h3><p className="mt-2 wrap-break-word text-xs uppercase text-white/55">{investment.category} · {investment.condition} · {investment.quantity} unidades</p></div><span className="shrink-0 text-xs text-[#d9a7ff]">{investment.currency}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-xs"><p className="text-white/65">Costo unitario: <strong className="text-white">{format(investment.cost, investment.currency)}</strong></p><p className="text-white/65">Venta unitaria: <strong className="text-white">{format(investment.saleEstimate, investment.currency)}</strong></p><p className="text-white/55">Inversión del lote: {format(totalCost, investment.currency)}</p><p className="text-white/55">Venta estimada: {format(totalSale, investment.currency)}</p><p className="text-white/55">Stock: {investment.remainingStock} / {investment.quantity}</p><p className={profit(investment.cost, investment.saleEstimate) >= 0 ? "text-emerald-300" : "text-red-300"}>Neto estimado: {format(profit(investment.cost, investment.saleEstimate) * investment.quantity, investment.currency)}</p><p className="text-[#d9a7ff]">ROI: {(investment.cost > 0 ? profit(investment.cost, investment.saleEstimate) / investment.cost * 100 : 0).toFixed(2)}%</p></div>
    {closed && <div className="mt-4 border border-white/10 bg-black/25 p-3"><h4 className="text-[11px] uppercase text-[#d9a7ff]">Resultado real de ventas</h4>{projectSales.length === 0 ? <p className="mt-2 text-xs text-white/45">Sin ventas registradas para este proyecto.</p> : <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p className="text-white/60">Costo vendido: <strong className="text-white">{format(realizedCost, investment.currency)}</strong></p><p className="text-white/60">Precio final: <strong className="text-white">{format(realizedRevenue, investment.currency)}</strong></p><p className="text-white/60">Unidades vendidas: <strong className="text-white">{projectSales.reduce((sum, sale) => sum + sale.quantity, 0)}</strong></p><p className={realizedGain >= 0 ? "text-emerald-300" : "text-red-300"}>Ganancia neta: <strong>{format(realizedGain, investment.currency)}</strong></p><p className="col-span-2 text-[#d9a7ff]">ROI realizado: {realizedCost > 0 ? `${(realizedGain / realizedCost * 100).toFixed(2)}%` : "--"}</p></div>}</div>}
    <div className="mt-4 flex flex-wrap items-center gap-2">{!closed && investment.status === "evaluation" && <button type="button" onClick={() => void onStatus(investment, "process")} disabled={Boolean(actionId)} className="min-h-10 border border-emerald-300/45 bg-emerald-300/10 px-3 py-2 text-xs uppercase text-emerald-100 hover:bg-emerald-300/20">Confirmar y pasar al inventario</button>}<select aria-label={`Cambiar estado de ${investment.title}`} value={investment.status} onChange={(event) => void onStatus(investment, event.target.value as ProjectStatus)} disabled={Boolean(actionId)} className="min-h-10 max-w-full border border-white/20 bg-[#121212] px-3 py-2 text-xs text-white">{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" onClick={() => onEdit(investment)} disabled={Boolean(actionId)} className="min-h-10 border border-white/20 px-3 py-2 text-xs uppercase text-white/75">Editar</button><button type="button" onClick={() => onRemove(investment)} disabled={Boolean(actionId)} className="min-h-10 border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200">Eliminar</button></div>
  </article>;
}
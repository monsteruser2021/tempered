"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { CircleAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { getDueDateUrgency, localDateString } from "./task-data";
import { useSession } from "./session-context";

type ShoppingItem = { id: string; userId: string; title: string; price: number; currency: "Bs" | "$"; dueDate: string; completed: boolean };

export default function ShoppingManager() {
  const { userId } = useSession();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<ShoppingItem["currency"]>("Bs");
  const [dueDate, setDueDate] = useState(localDateString());
  const [editingId, setEditingId] = useState("");
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(query(collection(db, "shoppingItems"), where("userId", "==", userId)), (snapshot) => {
      setItems(snapshot.docs.map((item) => ({ id: item.id, userId, title: String(item.data().title ?? ""), price: Number(item.data().price ?? 0), currency: item.data().currency === "$" ? "$" : "Bs", dueDate: String(item.data().dueDate ?? ""), completed: item.data().completed === true })));
    }, () => setError("No se pudo cargar la lista de compras."));
  }, [userId]);

  const pending = useMemo(() => userId ? items.filter((item) => !item.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [], [items, userId]);
  const completed = useMemo(() => userId ? items.filter((item) => item.completed) : [], [items, userId]);
  const reset = () => { setTitle(""); setPrice(""); setCurrency("Bs"); setDueDate(localDateString()); setEditingId(""); };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(price);
    if (!userId || !title.trim() || !Number.isFinite(amount) || amount < 0 || !dueDate || busy) return;
    setBusy(true); setError("");
    try {
      const data = { title: title.trim(), price: amount, currency, dueDate };
      if (editingId) await updateDoc(doc(db, "shoppingItems", editingId), data);
      else await addDoc(collection(db, "shoppingItems"), { ...data, userId, completed: false, createdAt: serverTimestamp() });
      reset();
    } catch { setError("No se pudo guardar el artículo."); } finally { setBusy(false); }
  };

  const toggle = async (item: ShoppingItem) => {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry));
    try { await updateDoc(doc(db, "shoppingItems", item.id), { completed: !item.completed }); } catch { setItems((current) => current.map((entry) => entry.id === item.id ? item : entry)); setError("No se pudo actualizar el artículo."); }
  };

  const remove = async (item: ShoppingItem) => {
    if (!window.confirm(`¿Eliminar ${item.title}?`)) return;
    try { await deleteDoc(doc(db, "shoppingItems", item.id)); } catch { setError("No se pudo eliminar el artículo."); }
  };

  const edit = (item: ShoppingItem) => { setEditingId(item.id); setTitle(item.title); setPrice(String(item.price)); setCurrency(item.currency); setDueDate(item.dueDate); };
  const renderItem = (item: ShoppingItem) => {
    const urgency = getDueDateUrgency(item.dueDate);
    const urgencyClass = item.completed ? "text-white/40" : urgency === "overdue" ? "font-bold text-red-200" : urgency === "today" ? "font-bold text-amber-300" : urgency === "soon" ? "font-semibold text-teal-200" : "text-white/50";
    const urgencyLabel = item.completed ? "Fecha límite" : urgency === "overdue" ? "Atrasada" : urgency === "today" ? "Vence hoy" : urgency === "soon" ? "Vence pronto" : "Fecha límite";

    return <article key={item.id} className="border border-white/25 bg-black/50 p-4 sm:p-5"><div className="flex min-w-0 items-start gap-3"><input type="checkbox" checked={item.completed} onChange={() => void toggle(item)} className="mt-1 size-5 shrink-0 accent-emerald-300" aria-label={`Marcar ${item.title} como comprado`} /><div className="min-w-0 flex-1"><h3 className={`wrap-break-word text-sm uppercase ${item.completed ? "text-white/50 line-through" : "text-white"}`}>{item.title}</h3><p className="mt-2 text-xs uppercase text-white/55">{item.currency} {item.price.toFixed(2)}</p><p className={`mt-2 flex items-center gap-1.5 text-xs uppercase ${urgencyClass}`}>{!item.completed && (urgency === "overdue" || urgency === "today") && <CircleAlert aria-hidden="true" size={14} />}{urgencyLabel} · {item.dueDate}</p></div></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => edit(item)} className="min-h-10 rounded-lg border border-white/25 px-3 py-2 text-xs uppercase text-white hover:bg-white/10">Editar</button><button type="button" onClick={() => void remove(item)} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50">Eliminar</button></div></article>;
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BackButton href="/utilidades">Volver a Utilidades</BackButton>
        <Link href="/menu" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Panel Tempered</Link>
      </div>
      <header className="mt-12 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Herramientas / Utilidad puntual</p>
        <h1 className="mt-4 wrap-break-word text-3xl uppercase tracking-widest text-white sm:text-5xl">Compras</h1>
        <p className="mt-5 max-w-full wrap-break-word text-sm leading-7 text-white/65">Artículos, precios, moneda y fechas límite en un solo lugar.</p>
      </header>
      {!userId && <p className="mt-6 border border-white/30 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}
      <form onSubmit={submit} className="mt-10 border border-white/30 bg-black/60 p-5 sm:p-7">
        <h2 className="text-lg uppercase text-white">{editingId ? "Editar artículo" : "Nuevo artículo"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_8rem]">
          <label className="block text-xs uppercase text-white/65">Artículo<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none" /></label>
          <label className="block text-xs uppercase text-white/65">Precio<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none" /></label>
          <label className="block text-xs uppercase text-white/65">Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value as ShoppingItem["currency"])} className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-3 py-3 text-sm text-white outline-none"><option>Bs</option><option>$</option></select></label>
        </div>
        <label className="mt-4 block max-w-full text-xs uppercase text-white/65">Fecha límite<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none" /></label>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" disabled={!userId || busy} className="min-h-11 rounded-lg bg-white px-5 py-3 text-xs font-bold uppercase text-black disabled:opacity-50">{busy ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar artículo"}</button>
          {editingId && <button type="button" onClick={reset} className="min-h-11 rounded-lg border border-white/30 px-5 py-3 text-xs uppercase text-white">Cancelar</button>}
        </div>
      </form>
      <section className="mt-10" aria-labelledby="shopping-list-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="shopping-list-title" className="max-w-full wrap-break-word text-xl uppercase text-white">Mi lista</h2>
          <span className="text-xs text-white/50">{pending.length} pendientes · {completed.length} completados</span>
        </div>
        <div role="group" aria-label="Filtrar artículos de compra" className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-emerald-300/20 bg-[#121212] p-1">
          <button type="button" aria-pressed={activeTab === "pending"} onClick={() => setActiveTab("pending")} className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold uppercase transition ${activeTab === "pending" ? "bg-emerald-300 text-[#121212]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>Pendientes ({pending.length})</button>
          <button type="button" aria-pressed={activeTab === "completed"} onClick={() => setActiveTab("completed")} className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold uppercase transition ${activeTab === "completed" ? "bg-teal-200 text-[#121212]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>Completadas ({completed.length})</button>
        </div>
        <div className="mt-5 space-y-3" aria-live="polite">
          {activeTab === "pending" ? pending.length ? pending.map(renderItem) : <p className="border border-dashed border-white/25 p-5 text-sm text-white/55">No hay compras pendientes.</p> : completed.length ? completed.map(renderItem) : <p className="border border-dashed border-white/25 p-5 text-sm text-white/55">Aún no hay compras completadas.</p>}
        </div>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { type Habit, weekDays } from "./grobit-data";
import { useSession } from "./session-context";

const allDays = weekDays.map((day) => day.value);

export default function GrobitAdmin() {
  const { userId } = useSession();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(allDays);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [removingId, setRemovingId] = useState("");

  useEffect(() => {
    if (!userId) return;

    const habitsQuery = query(collection(db, "habits"), where("userId", "==", userId));
    return onSnapshot(habitsQuery, (snapshot) => {
      setHabits(snapshot.docs.map((item) => ({
        id: item.id,
        userId: String(item.data().userId ?? ""),
        name: String(item.data().name ?? ""),
        active: item.data().active !== false,
        days: Array.isArray(item.data().days) ? item.data().days.map(Number) : allDays,
      })));
      setLoading(false);
    }, () => {
      setLoading(false);
      setError("No se pudieron cargar los hábitos.");
    });
  }, [userId]);

  const resetForm = () => {
    setName("");
    setDays(allDays);
    setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !name.trim() || days.length === 0 || saving) return;

    setError("");
    setSaving(true);
    try {
      const ownedHabit = habits.find((habit) => habit.id === editingId && habit.userId === userId);
      if (editingId && !ownedHabit) {
        setError("El hábito seleccionado no pertenece a tu cuenta.");
        return;
      }

      if (ownedHabit) {
        await updateDoc(doc(db, "habits", ownedHabit.id), { name: name.trim(), days });
      } else {
        await addDoc(collection(db, "habits"), { userId, name: name.trim(), days, active: true, createdAt: new Date() });
      }
      resetForm();
    } catch (submissionError) {
      console.error("Error al guardar hábito:", submissionError);
      setError("No se pudo guardar el hábito. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (habit: Habit) => {
    if (habit.userId !== userId) return;
    setEditingId(habit.id);
    setName(habit.name);
    setDays(habit.days);
  };

  const toggleActive = async (habit: Habit) => {
    if (habit.userId !== userId || actionId) return;
    setError("");
    setActionId(habit.id);
    try {
      await updateDoc(doc(db, "habits", habit.id), { active: !habit.active });
    } catch (actionError) {
      console.error("Error al actualizar hábito:", actionError);
      setError("No se pudo actualizar el hábito.");
    } finally {
      setActionId("");
    }
  };

  const remove = async (habit: Habit) => {
    if (habit.userId !== userId || actionId || !window.confirm(`¿Eliminar ${habit.name}?`)) return;
    setError("");
    setActionId(habit.id);
    setRemovingId(habit.id);
    try {
      await deleteDoc(doc(db, "habits", habit.id));
      if (editingId === habit.id) resetForm();
    } catch (actionError) {
      console.error("Error al eliminar hábito:", actionError);
      setError("No se pudo eliminar el hábito.");
    } finally {
      setActionId("");
      setRemovingId("");
    }
  };

  const unavailable = !userId;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <BackButton href="/grobit">Volver a Grobit</BackButton>
        <Link href="/grobit" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Ver checklist</Link>
      </div>

      <header className="mt-12">
        <p className="text-xs uppercase tracking-[0.16em] text-white/55">Grobit</p>
        <h1 className="mt-4 max-w-full wrap-break-word text-3xl uppercase tracking-widest text-[#76c978] sm:text-5xl">Administración de hábitos</h1>
        <p className="mt-5 text-sm leading-6 text-white/70">Define qué hábitos aparecen en tu checklist y qué días deben cumplirse.</p>
      </header>

      {unavailable && <p className="mt-6 rounded-xl border border-amber-200/40 bg-black/30 p-4 text-sm text-amber-100">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-200/40 bg-black/30 p-4 text-sm text-red-100">{error}</p>}
      {loading && <p className="mt-6 text-sm text-white/60">Cargando hábitos...</p>}

      <form onSubmit={submit} className="mt-10 rounded-2xl border border-white/20 bg-black/25 p-5 sm:p-7">
        <h2 className="text-lg uppercase text-white">{editingId ? "Editar hábito" : "Nuevo hábito"}</h2>
        <label className="mt-5 block text-xs uppercase text-white/65">Nombre<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#76c978] disabled:cursor-not-allowed disabled:opacity-50" placeholder="Ej. Leer 20 minutos" /></label>
        <fieldset className="mt-5" disabled={!userId || saving}>
          <legend className="text-xs uppercase text-white/65">Días activos</legend>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">{weekDays.map((day) => <label key={day.value} className="flex min-w-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 p-3 text-xs text-white transition hover:border-[#76c978]/70"><input type="checkbox" checked={days.includes(day.value)} onChange={() => setDays((current) => current.includes(day.value) ? current.filter((item) => item !== day.value) : [...current, day.value])} className="size-4 accent-[#76c978]" />{day.label}</label>)}</div>
        </fieldset>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="submit" disabled={!userId || !name.trim() || days.length === 0 || saving} className="min-h-11 rounded-xl bg-[#76c978] px-5 py-3 text-xs font-bold uppercase text-[#121212] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar hábito"}</button>{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-xl border border-white/25 px-5 py-3 text-xs uppercase text-white hover:bg-white/10 disabled:opacity-50">Cancelar</button>}</div>
      </form>

      <section className="mt-8 space-y-3" aria-labelledby="habits-list-title">
        <h2 id="habits-list-title" className="text-lg uppercase text-white">Hábitos configurados</h2>
        {habits.length === 0 && !loading ? <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-white/55">Todavía no hay hábitos configurados.</p> : habits.map((habit, index) => <article key={habit.id} style={{ animationDelay: `${Math.min(index * 25, 150)}ms` }} className={`item-enter flex min-w-0 flex-col gap-4 rounded-xl border border-white/15 bg-black/20 p-4 transition-[opacity,transform] duration-200 sm:flex-row sm:items-center sm:justify-between ${removingId === habit.id ? "item-exit" : ""}`}><div className="min-w-0"><h3 className={`wrap-break-word text-sm uppercase ${habit.active ? "text-white" : "text-white/45 line-through"}`}>{habit.name}</h3><p className="mt-2 text-xs text-white/50">{habit.days.map((day) => weekDays.find((item) => item.value === day)?.label).join(" · ")}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => edit(habit)} disabled={Boolean(actionId) || saving} className="min-h-10 transform-gpu rounded-lg border border-white/25 px-3 py-2 text-xs uppercase text-white transition-transform duration-150 active:scale-95 hover:bg-white/10 disabled:opacity-50">Editar</button><button type="button" onClick={() => void toggleActive(habit)} disabled={Boolean(actionId) || saving} className="min-h-10 transform-gpu rounded-lg border border-[#76c978]/50 px-3 py-2 text-xs uppercase text-[#b8f0b9] transition-transform duration-150 active:scale-95 disabled:opacity-50">{actionId === habit.id ? "Procesando..." : habit.active ? "Pausar" : "Activar"}</button><button type="button" onClick={() => void remove(habit)} disabled={Boolean(actionId) || saving} className="min-h-10 transform-gpu rounded-lg border border-red-300/30 px-3 py-2 text-xs uppercase text-red-200 transition-transform duration-150 active:scale-95 disabled:opacity-50">Eliminar</button></div></article>)}
      </section>
    </main>
  );
}
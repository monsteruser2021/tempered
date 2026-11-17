"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { readSessionUserId } from "./grobit-data";
import { isRoutineScheduledToday, mawinaDateString, mawinaWeekDays, type MawinaRoutine } from "./mawina-data";
import { useSession } from "./session-context";

const emptyDays = [1, 2, 3, 4, 5];

export default function MawinaManager() {
  const { userId: sessionUserId } = useSession();
  const userId = sessionUserId ?? (typeof document === "undefined" ? null : readSessionUserId());
  const today = mawinaDateString();
  const [routines, setRoutines] = useState<MawinaRoutine[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [duration, setDuration] = useState("");
  const [days, setDays] = useState<number[]>(emptyDays);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) {
      return;
    }

    return onSnapshot(
      query(collection(db, "mawinaRoutines"), where("userId", "==", userId)),
      (snapshot) => {
        setRoutines(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            userId: String(data.userId ?? ""),
            title: String(data.title ?? ""),
            category: String(data.category ?? ""),
            duration: String(data.duration ?? ""),
            days: Array.isArray(data.days) ? data.days.map(Number).filter(Number.isInteger) : [],
            completedDates: Array.isArray(data.completedDates) ? data.completedDates.map(String) : [],
          };
        }));
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Error al cargar rutinas de Mawina:", snapshotError);
        setLoading(false);
        setError("No se pudieron cargar tus bloques de rutina.");
      },
    );
  }, [userId]);

  const todaysRoutines = useMemo(() => routines.filter((routine) => isRoutineScheduledToday(routine)), [routines]);
  const completedToday = todaysRoutines.filter((routine) => routine.completedDates.includes(today)).length;
  const progress = todaysRoutines.length ? Math.round((completedToday / todaysRoutines.length) * 100) : 0;

  const resetForm = () => {
    setTitle("");
    setCategory("");
    setDuration("");
    setDays(emptyDays);
    setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !title.trim() || !category.trim() || !duration.trim() || !days.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = { title: title.trim(), category: category.trim(), duration: duration.trim(), days: [...days].sort((a, b) => a - b) };
      const ownedRoutine = routines.find((routine) => routine.id === editingId && routine.userId === userId);
      if (ownedRoutine) await updateDoc(doc(db, "mawinaRoutines", ownedRoutine.id), data);
      else await addDoc(collection(db, "mawinaRoutines"), { ...data, userId, completedDates: [], createdAt: serverTimestamp() });
      resetForm();
    } catch (submissionError) {
      console.error("Error al guardar rutina de Mawina:", submissionError);
      setError("No se pudo guardar el bloque. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCompleted = async (routine: MawinaRoutine) => {
    if (routine.userId !== userId || actionId) return;
    setActionId(routine.id);
    const completed = routine.completedDates.includes(today);
    const completedDates = completed ? routine.completedDates.filter((date) => date !== today) : [...routine.completedDates, today];
    setRoutines((current) => current.map((item) => item.id === routine.id ? { ...item, completedDates } : item));
    try {
      await updateDoc(doc(db, "mawinaRoutines", routine.id), { completedDates });
    } catch (actionError) {
      console.error("Error al actualizar rutina de Mawina:", actionError);
      setRoutines((current) => current.map((item) => item.id === routine.id ? routine : item));
      setError("No se pudo actualizar el estado del bloque.");
    } finally {
      setActionId("");
    }
  };

  const remove = async (routine: MawinaRoutine) => {
    if (routine.userId !== userId || actionId || !window.confirm(`¿Eliminar ${routine.title}?`)) return;
    setActionId(routine.id);
    try {
      await deleteDoc(doc(db, "mawinaRoutines", routine.id));
      if (editingId === routine.id) resetForm();
    } catch (actionError) {
      console.error("Error al eliminar rutina de Mawina:", actionError);
      setError("No se pudo eliminar el bloque.");
    } finally {
      setActionId("");
    }
  };

  const edit = (routine: MawinaRoutine) => {
    setEditingId(routine.id);
    setTitle(routine.title);
    setCategory(routine.category);
    setDuration(routine.duration);
    setDays(routine.days);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton href="/menu">Volver a Tempered</BackButton>
        <span className="text-xs uppercase tracking-[0.16em] text-white/50">Mawina Kairos</span>
      </div>

      <header className="mt-10 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-[#e5a0a0]">Bloques de rutina / ejecución operativa</p>
        <h1 className="font-display mt-4 wrap-break-word text-3xl uppercase tracking-widest text-white sm:text-5xl">Mawina Kairos</h1>
        <p className="mt-5 text-sm leading-7 text-white/65">Diseña el ritmo de tu jornada, ejecuta lo importante y conserva una señal clara de constancia.</p>
      </header>

      <section className="mt-8 border border-[#a94c4c]/50 bg-black/35 p-5 shadow-xl shadow-black/20 sm:p-7" aria-labelledby="today-title">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.16em] text-[#e5a0a0]">Jornada actual</p><h2 id="today-title" className="mt-2 text-xl uppercase text-white">Ritmo de hoy</h2></div><p className="text-2xl font-bold text-white">{completedToday}<span className="text-base font-normal text-white/50"> / {todaysRoutines.length}</span></p></div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10" aria-label={`${completedToday} de ${todaysRoutines.length} bloques completados`}><div className="h-full rounded-full bg-[#c45b5b] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
        <p className="mt-3 text-xs uppercase tracking-[0.12em] text-white/50">{todaysRoutines.length ? `${progress}% de la jornada ejecutada` : "Sin bloques programados para hoy"}</p>
      </section>

      {!userId && <p className="mt-6 border border-white/30 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}

      <form onSubmit={submit} className="mt-8 border border-white/20 bg-black/45 p-5 sm:p-7">
        <h2 className="text-lg uppercase text-white">{editingId ? "Editar bloque" : "Nuevo bloque de rutina"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_10rem]">
          <label className="block min-w-0 text-xs uppercase text-white/65">Título del bloque<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d87979] disabled:opacity-50" placeholder="Ej. Código frontend" /></label>
          <label className="block min-w-0 text-xs uppercase text-white/65">Categoría o enfoque<input value={category} onChange={(event) => setCategory(event.target.value)} required maxLength={80} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d87979] disabled:opacity-50" placeholder="Desarrollo" /></label>
          <label className="block min-w-0 text-xs uppercase text-white/65">Duración<input value={duration} onChange={(event) => setDuration(event.target.value)} required maxLength={40} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-[#d87979] disabled:opacity-50" placeholder="45 mins" /></label>
        </div>
        <fieldset className="mt-5"><legend className="text-xs uppercase text-white/65">Días asignados</legend><div className="mt-3 grid grid-cols-7 gap-2">{mawinaWeekDays.map((day) => <label key={day.value} title={day.label} className="min-w-0"><input type="checkbox" checked={days.includes(day.value)} onChange={() => setDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value])} disabled={!userId || saving} className="peer sr-only" /><span className="flex min-h-11 items-center justify-center rounded-lg border border-white/20 bg-[#121212] px-1 text-xs text-white/65 transition peer-checked:border-[#d87979] peer-checked:bg-[#620404] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-white">{day.shortLabel}</span></label>)}</div></fieldset>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="submit" disabled={!userId || !title.trim() || !category.trim() || !duration.trim() || !days.length || saving} className="min-h-11 rounded-lg bg-[#d87979] px-5 py-3 text-xs font-bold uppercase text-[#210000] transition hover:bg-[#edaaaa] disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar bloque"}</button>{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-lg border border-white/25 px-5 py-3 text-xs uppercase text-white hover:bg-white/10">Cancelar</button>}</div>
      </form>

      <section className="mt-10" aria-labelledby="routine-list-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="routine-list-title" className="text-xl uppercase text-white">Mis bloques</h2><span className="text-xs text-white/50">{routines.length} configurados</span></div>
        {loading && userId && <p className="mt-5 text-sm text-white/60">Cargando bloques...</p>}
        {!loading && routines.length === 0 && <p className="mt-5 border border-dashed border-white/25 p-5 text-sm text-white/55">Aún no hay bloques. Crea el primero para darle forma a tu jornada.</p>}
        <div className="mt-5 grid gap-4 md:grid-cols-2">{routines.map((routine, index) => { const completed = routine.completedDates.includes(today); const scheduled = isRoutineScheduledToday(routine); return <article key={routine.id} style={{ animationDelay: `${Math.min(index * 25, 150)}ms` }} className={`item-enter min-w-0 border p-4 sm:p-5 ${scheduled ? completed ? "border-[#bc7777]/70 bg-[#620404]/45" : "border-[#a94c4c]/50 bg-black/45" : "border-white/15 bg-black/25"}`}><div className="flex min-w-0 items-start gap-3"><input type="checkbox" checked={completed} disabled={!scheduled || actionId === routine.id} onChange={() => void toggleCompleted(routine)} aria-label={`${completed ? "Desmarcar" : "Marcar"} ${routine.title}`} className="mt-1 size-6 shrink-0 accent-[#d87979]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className={`max-w-full wrap-break-word text-sm uppercase ${completed ? "text-white/60 line-through" : "text-white"}`}>{routine.title}</h3>{scheduled && <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#e5a0a0]">{completed ? "Ejecutado" : "Pendiente"}</span>}</div><p className="mt-2 wrap-break-word text-sm text-white/60">{routine.category} <span className="text-white/30">·</span> {routine.duration}</p><div className="mt-4 flex flex-wrap gap-1.5">{mawinaWeekDays.map((day) => <span key={day.value} className={`rounded px-2 py-1 text-[10px] uppercase ${routine.days.includes(day.value) ? "bg-white/15 text-white/80" : "bg-white/5 text-white/25"}`}>{day.shortLabel}</span>)}</div>{!scheduled && <p className="mt-4 text-xs uppercase text-white/35">No programado hoy</p>}</div></div><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => edit(routine)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-white/20 px-3 py-2 text-xs uppercase text-white hover:bg-white/10 disabled:opacity-50">Editar</button><button type="button" onClick={() => void remove(routine)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">{actionId === routine.id ? "Procesando..." : "Eliminar"}</button></div></article>; })}</div>
      </section>
    </main>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { CircleAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import BackButton from "./back-button";
import { getDueDateUrgency, localDateString, type Task } from "./task-data";
import { readSessionUserId } from "./grobit-data";
import { useSession } from "./session-context";

export default function TaskManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(localDateString());
  const [editingId, setEditingId] = useState("");
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const { userId: sessionUserId } = useSession();
  const userId = sessionUserId ?? (typeof document === "undefined" ? null : readSessionUserId());
  const today = localDateString();

  useEffect(() => {
    if (!userId) return;

    return onSnapshot(
      query(collection(db, "tasks"), where("userId", "==", userId)),
      (snapshot) => {
        setTasks(snapshot.docs.map((item) => ({
          id: item.id,
          userId: String(item.data().userId ?? ""),
          title: String(item.data().title ?? ""),
          description: String(item.data().description ?? ""),
          dueDate: String(item.data().dueDate ?? ""),
          completed: item.data().completed === true,
          completedAt: item.data().completedAt?.toDate?.().toISOString() ?? undefined,
        })));
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Error al cargar tareas:", snapshotError);
        setLoading(false);
        setError("No se pudieron cargar tus tareas.");
      },
    );
  }, [userId]);

  const pendingTasks = useMemo(() => tasks.filter((task) => !task.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title)), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.completed).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")), [tasks]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDueDate(today);
    setEditingId("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !title.trim() || !dueDate || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = { title: title.trim(), description: description.trim(), dueDate };
      const ownedTask = tasks.find((task) => task.id === editingId && task.userId === userId);
      if (ownedTask) await updateDoc(doc(db, "tasks", ownedTask.id), data);
      else await addDoc(collection(db, "tasks"), { ...data, userId, completed: false, createdAt: serverTimestamp() });
      resetForm();
    } catch (submissionError) {
      console.error("Error al guardar tarea:", submissionError);
      setError("No se pudo guardar la tarea. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCompleted = async (task: Task) => {
    if (task.userId !== userId || actionId) return;
    setActionId(task.id);
    try {
      const completed = !task.completed;
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed, completedAt: completed ? new Date().toISOString() : undefined } : item));
      await updateDoc(doc(db, "tasks", task.id), { completed, completedAt: completed ? serverTimestamp() : null });
    } catch (actionError) {
      console.error("Error al actualizar tarea:", actionError);
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setError("No se pudo actualizar el estado de la tarea.");
    } finally {
      setActionId("");
      setRemovingId("");
    }
  };

  const remove = async (task: Task) => {
    if (task.userId !== userId || actionId || !window.confirm(`¿Eliminar ${task.title}?`)) return;
    setActionId(task.id);
    setRemovingId(task.id);
    try {
      await deleteDoc(doc(db, "tasks", task.id));
      if (editingId === task.id) resetForm();
    } catch (actionError) {
      console.error("Error al eliminar tarea:", actionError);
      setError("No se pudo eliminar la tarea.");
    } finally {
      setActionId("");
    }
  };

  const edit = (task: Task) => {
    if (task.userId !== userId) return;
    setEditingId(task.id);
    setTitle(task.title);
    setDescription(task.description);
    setDueDate(task.dueDate);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <BackButton href="/utilidades">Volver a Utilidades</BackButton>
        <Link href="/menu" className="text-xs uppercase text-white/65 underline-offset-4 hover:text-white hover:underline">Panel Tempered</Link>
      </div>
      <header className="mt-12 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Herramientas / Utilidad puntual</p>
        <h1 className="mt-4 wrap-break-word text-3xl uppercase tracking-widest text-white sm:text-5xl">Tareas / To-Do List</h1>
        <p className="mt-5 text-sm leading-7 text-white/65">Pendientes concretos, fechas claras y una señal visible cuando algo ya quedó atrás.</p>
      </header>

      {!userId && <p className="mt-6 rounded-xl border border-white/30 bg-black/50 p-4 text-sm text-white/75">No se encontró una sesión activa de Tempered.</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-300/50 bg-red-950/50 p-4 text-sm text-red-100">{error}</p>}

      <form onSubmit={submit} className="mt-10 border border-white/30 bg-black/60 p-5 sm:p-7">
        <h2 className="text-lg uppercase text-white">{editingId ? "Editar tarea" : "Nueva tarea"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="block text-xs uppercase text-white/65">Título<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-white disabled:opacity-50" placeholder="Ej. Enviar informe" /></label>
          <label className="block text-xs uppercase text-white/65">Fecha límite<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required disabled={!userId || saving} className="mt-2 min-h-12 w-full rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-white disabled:opacity-50" /></label>
        </div>
        <label className="mt-4 block text-xs uppercase text-white/65">Descripción <span className="normal-case text-white/40">(opcional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} disabled={!userId || saving} rows={3} className="mt-2 w-full resize-y rounded-lg border border-white/25 bg-[#121212] px-4 py-3 text-sm text-white outline-none focus:border-white disabled:opacity-50" placeholder="Añade contexto o próximos pasos" /></label>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row"><button type="submit" disabled={!userId || !title.trim() || !dueDate || saving} className="min-h-11 rounded-lg bg-white px-5 py-3 text-xs font-bold uppercase text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar tarea"}</button>{editingId && <button type="button" onClick={resetForm} disabled={saving} className="min-h-11 rounded-lg border border-white/30 px-5 py-3 text-xs uppercase text-white hover:bg-white/10">Cancelar</button>}</div>
      </form>

      <section className="mt-10" aria-labelledby="task-list-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="task-list-title" className="text-xl uppercase text-white">Mis tareas</h2>
          <span className="text-xs text-white/50">{pendingTasks.length} pendientes · {completedTasks.length} completadas</span>
        </div>
        <div role="group" aria-label="Filtrar tareas" className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-emerald-300/20 bg-[#121212] p-1">
          <button type="button" aria-pressed={activeTab === "pending"} onClick={() => setActiveTab("pending")} className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold uppercase transition ${activeTab === "pending" ? "bg-emerald-300 text-[#121212]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>Pendientes ({pendingTasks.length})</button>
          <button type="button" aria-pressed={activeTab === "completed"} onClick={() => setActiveTab("completed")} className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold uppercase transition ${activeTab === "completed" ? "bg-teal-200 text-[#121212]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>Completadas ({completedTasks.length})</button>
        </div>
        <div className="mt-5 space-y-3" aria-live="polite">
          {loading && userId && <p className="text-sm text-white/60">Cargando tareas...</p>}
          {activeTab === "pending" ? (
            <>
              {!loading && pendingTasks.length === 0 && <p className="border border-dashed border-white/25 p-5 text-sm text-white/55">No hay tareas pendientes.</p>}
              {pendingTasks.map((task, index) => {
                const urgency = getDueDateUrgency(task.dueDate, today);
                const urgent = urgency === "overdue" || urgency === "today";
                const urgencyClass = urgency === "overdue" ? "font-bold text-red-200" : urgency === "today" ? "font-bold text-amber-300" : urgency === "soon" ? "font-semibold text-teal-200" : "text-white/50";
                const urgencyLabel = urgency === "overdue" ? "Atrasada" : urgency === "today" ? "Vence hoy" : urgency === "soon" ? "Vence pronto" : "Fecha límite";
                return <article key={task.id} style={{ animationDelay: `${Math.min(index * 25, 150)}ms` }} className={`item-enter border p-4 sm:p-5 ${removingId === task.id ? "item-exit" : ""} ${urgency === "overdue" ? "border-red-400/80 bg-red-950/60" : urgency === "today" ? "border-amber-300/70 bg-amber-950/30" : urgency === "soon" ? "border-teal-300/50 bg-teal-950/20" : "border-white/25 bg-black/50"}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <input type="checkbox" checked={false} disabled={actionId === task.id} onChange={() => void toggleCompleted(task)} aria-label={`Marcar ${task.title} como completada`} className="mt-1 size-5 shrink-0 accent-emerald-300" />
                    <div className="min-w-0 flex-1">
                      <h3 className={`wrap-break-word text-sm uppercase ${urgency === "overdue" ? "text-red-100" : "text-white"}`}>{task.title}</h3>
                      {task.description && <p className="mt-2 wrap-break-word text-sm leading-6 text-white/60">{task.description}</p>}
                      <p className={`mt-3 flex items-center gap-1.5 text-xs uppercase ${urgencyClass}`}>{urgent && <CircleAlert aria-hidden="true" size={14} />}{urgencyLabel} · {task.dueDate}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => edit(task)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-white/25 px-3 py-2 text-xs uppercase text-white hover:bg-white/10 disabled:opacity-50">Editar</button>
                    <button type="button" onClick={() => void remove(task)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">{actionId === task.id ? "Procesando..." : "Eliminar"}</button>
                  </div>
                </article>;
              })}
            </>
          ) : (
            <>
              {!loading && completedTasks.length === 0 && <p className="border border-dashed border-white/25 p-5 text-sm text-white/55">Aún no hay tareas completadas.</p>}
              {completedTasks.map((task) => <article key={task.id} className="border border-white/15 bg-white/5 p-4 sm:p-5"><div className="flex min-w-0 items-start gap-3"><input type="checkbox" checked disabled={actionId === task.id} onChange={() => void toggleCompleted(task)} aria-label={`Reabrir ${task.title}`} className="mt-1 size-5 shrink-0 accent-emerald-300" /><div className="min-w-0 flex-1"><h3 className="wrap-break-word text-sm uppercase text-white/55 line-through">{task.title}</h3>{task.description && <p className="mt-2 wrap-break-word text-sm leading-6 text-white/50">{task.description}</p>}<p className="mt-3 wrap-break-word text-xs uppercase text-white/45">Completada · {task.completedAt ? new Date(task.completedAt).toLocaleString("es-VE") : "fecha no disponible"}</p></div></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void toggleCompleted(task)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-white/25 px-3 py-2 text-xs uppercase text-white hover:bg-white/10 disabled:opacity-50">Reabrir</button><button type="button" onClick={() => void remove(task)} disabled={Boolean(actionId) || saving} className="min-h-10 rounded-lg border border-red-300/40 px-3 py-2 text-xs uppercase text-red-100 hover:bg-red-900/50 disabled:opacity-50">Eliminar</button></div></article>)}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
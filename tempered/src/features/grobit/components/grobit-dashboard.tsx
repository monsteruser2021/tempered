"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dayOfWeek, displayDate, formatDate, getMonthDates, type Habit } from "./grobit-data";
import { useSession } from "./session-context";

type Completion = { habitId: string; date: string; completed: boolean };

export default function GrobitDashboard() {
  const { userId } = useSession();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const todayString = formatDate(today);
  const monthDates = getMonthDates(today);
  useEffect(() => {
    if (!userId) return;

    const habitsQuery = query(collection(db, "habits"), where("userId", "==", userId));
    const completionsQuery = query(collection(db, "habitCompletions"), where("userId", "==", userId));
    const stopHabits = onSnapshot(habitsQuery, (snapshot) => {
      setHabits(snapshot.docs.map((item) => ({ id: item.id, userId: String(item.data().userId ?? ""), name: String(item.data().name ?? ""), active: item.data().active !== false, days: Array.isArray(item.data().days) ? item.data().days.map(Number) : [1, 2, 3, 4, 5, 6, 0] })));
      setLoading(false);
    }, () => { setLoading(false); setError("No se pudieron cargar los hábitos."); });
    const stopCompletions = onSnapshot(completionsQuery, (snapshot) => {
      setCompletions(snapshot.docs.map((item) => ({ habitId: String(item.data().habitId ?? ""), date: String(item.data().date ?? ""), completed: item.data().completed === true })));
    }, () => { setLoading(false); setError("No se pudo cargar el historial diario."); });

    return () => {
      stopHabits();
      stopCompletions();
    };
  }, [userId]);

  const todaysHabits = habits.filter((habit) => habit.active && habit.days.includes(today.getDay()));
  const completedKey = (habitId: string, date: string) => `${habitId}:${date}`;
  const completed = new Set(completions.filter((item) => item.completed).map((item) => completedKey(item.habitId, item.date)));
  const todayCompleted = todaysHabits.filter((habit) => completed.has(completedKey(habit.id, todayString))).length;

  const toggleHabit = async (habit: Habit) => {
    if (!userId) return;
    const key = completedKey(habit.id, todayString);
    const isCompleted = completed.has(key);
    setSavingId(habit.id);
    try {
      await setDoc(doc(db, "habitCompletions", `${userId}_${habit.id}_${todayString}`), { userId, habitId: habit.id, date: todayString, completed: !isCompleted }, { merge: true });
    } catch {
      setError("No se pudo guardar el cumplimiento.");
    } finally {
      setSavingId("");
    }
  };

  const monthlyTotal = monthDates.reduce((total, date) => total + habits.filter((habit) => habit.active && habit.days.includes(dayOfWeek(date)) && completed.has(completedKey(habit.id, date))).length, 0);
  const monthlyPossible = monthDates.reduce((total, date) => total + habits.filter((habit) => habit.active && habit.days.includes(dayOfWeek(date))).length, 0);
  const monthPercent = monthlyPossible ? Math.round((monthlyTotal / monthlyPossible) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/grobit/administracion" className="inline-flex min-h-11 max-w-full items-center justify-center rounded-xl border border-[#76c978]/70 bg-[#066204]/70 px-4 py-3 text-center text-xs font-bold uppercase text-white transition hover:bg-[#087b06] focus:outline-none focus:ring-2 focus:ring-white">Administrar hábitos</Link>
      </div>

      <header className="mt-12 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.16em] text-white/55">Aplicación de hábitos</p>
        <h1 className="mt-4 max-w-full wrap-break-word text-4xl uppercase tracking-widest text-[#76c978] sm:text-6xl">Grobit</h1>
        <p className="mt-5 text-sm leading-6 text-white/70">Construye constancia, un día a la vez.</p>
      </header>

      {error && <p className="mt-6 rounded-xl border border-amber-200/40 bg-black/30 p-4 text-sm text-amber-100">{error}</p>}

      {loading && <p className="mt-6 text-sm text-white/60">Cargando tus hábitos...</p>}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <section className="min-w-0 rounded-2xl border border-white/20 bg-black/25 p-5 sm:p-7" aria-labelledby="monthly-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs uppercase tracking-[0.14em] text-white/50">Historial</p><h2 id="monthly-title" className="mt-2 text-xl uppercase text-white sm:text-2xl">Este mes</h2></div>
            <p className="text-sm text-[#b8f0b9]">{monthPercent}% completado</p>
          </div>
          <div className="mt-6 grid grid-cols-7 gap-2" aria-label="Gráfica mensual de hábitos completados">
            {monthDates.map((date) => {
              const due = habits.filter((habit) => habit.active && habit.days.includes(dayOfWeek(date))).length;
              const done = habits.filter((habit) => habit.active && habit.days.includes(dayOfWeek(date)) && completed.has(completedKey(habit.id, date))).length;
              const ratio = due ? done / due : 0;
              return <div key={date} className="min-w-0 text-center"><div className="flex h-28 items-end justify-center rounded-lg border border-white/10 bg-[#121212]/70 p-1"><div className="w-full rounded-sm bg-[#066204] transition-all" style={{ height: `${Math.max(ratio * 100, ratio ? 8 : 2)}%` }} title={`${displayDate(date)}: ${done} de ${due}`} /></div><span className="mt-2 block text-[10px] text-white/50">{date.slice(-2)}</span></div>;
            })}
          </div>
          <p className="mt-4 text-xs text-white/45">Cada barra representa los hábitos programados y completados de ese día.</p>
        </section>

        <section className="min-w-0 rounded-2xl border border-white/20 bg-black/25 p-5 sm:p-7" aria-labelledby="checklist-title">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.14em] text-white/50">{todayString}</p><h2 id="checklist-title" className="mt-2 text-xl uppercase text-white sm:text-2xl">Checklist diario</h2></div><span className="shrink-0 text-sm text-[#b8f0b9]">{todayCompleted}/{todaysHabits.length}</span></div>
          <div className="mt-6 space-y-3">
            {todaysHabits.length === 0 ? <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm leading-6 text-white/55">No hay hábitos activos para hoy. Configúralos desde Administración.</p> : todaysHabits.map((habit) => { const isDone = completed.has(completedKey(habit.id, todayString)); return <label key={habit.id} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${isDone ? "border-[#76c978]/70 bg-[#066204]/30" : "border-white/15 bg-black/20 hover:border-white/35"}`}><input type="checkbox" checked={isDone} disabled={savingId === habit.id} onChange={() => void toggleHabit(habit)} className="size-5 shrink-0 accent-[#76c978]" /><span className={`min-w-0 wrap-break-word text-sm ${isDone ? "text-[#b8f0b9] line-through" : "text-white"}`}>{habit.name}</span></label>; })}
          </div>
        </section>
      </div>
    </main>
  );
}
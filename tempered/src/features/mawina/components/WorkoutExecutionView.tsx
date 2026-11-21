"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clock3, Dumbbell, Pause, Play, RotateCcw } from "lucide-react";
import type { Routine, RoutineDay, WorkoutSession } from "../types/mawina.types";

type Props = {
  userId: string;
  routine: Routine;
  day: RoutineDay;
  saving: boolean;
  onCancel: () => void;
  onFinish: (session: Omit<WorkoutSession, "id">) => Promise<void>;
};

type ExerciseSetState = {
  completed: boolean;
  reps: string;
  weight: string;
};

function suggestedReps(reps: string): number {
  const values = reps.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (values.length > 1) return Math.round((values[0] + values[1]) / 2);
  return values[0] ?? 1;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function WorkoutExecutionView({ userId, routine, day, saving, onCancel, onFinish }: Props) {
  const exercises = [...day.exercises].sort((a, b) => a.order - b.order);
  const startedAt = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [series, setSeries] = useState<Record<string, ExerciseSetState[]>>(() => Object.fromEntries(
    exercises.map((exercise) => [
      exercise.id,
      Array.from({ length: Math.min(50, Math.max(0, exercise.sets)) }, () => ({
        completed: false,
        reps: String(suggestedReps(exercise.reps)),
        weight: "0",
      })),
    ]),
  ));
  const [restDuration, setRestDuration] = useState(0);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restPaused, setRestPaused] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    startedAt.current = Date.now();
    const timerId = window.setInterval(() => {
      if (startedAt.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const restIsRunning = restRemaining > 0 && !restPaused;
  useEffect(() => {
    if (!restIsRunning) return;
    const timerId = window.setInterval(() => {
      setRestRemaining((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [restIsRunning]);

  const updateSet = (exerciseId: string, setIndex: number, patch: Partial<ExerciseSetState>) => {
    setSeries((current) => ({
      ...current,
      [exerciseId]: current[exerciseId].map((set, index) => index === setIndex ? { ...set, ...patch } : set),
    }));
  };

  const toggleSetComplete = (exerciseId: string, setIndex: number, restSeconds: number) => {
    const currentSet = series[exerciseId][setIndex];
    const isCompleting = !currentSet.completed;
    updateSet(exerciseId, setIndex, { completed: isCompleting });
    if (isCompleting && restSeconds > 0) {
      setRestDuration(restSeconds);
      setRestRemaining(restSeconds);
      setRestPaused(false);
    }
  };

  const finish = async () => {
    setError("");
    const invalidCompletedSet = Object.values(series).some((exerciseSeries) =>
      exerciseSeries.some((set) => {
        if (!set.completed) return false;
        const reps = Number(set.reps);
        const weight = Number(set.weight);
        return set.reps.trim() === "" || set.weight.trim() === ""
          || !Number.isInteger(reps) || reps < 0 || reps > 200
          || !Number.isFinite(weight) || weight < 0 || weight > 1000;
      }),
    );
    if (invalidCompletedSet) {
      setError("Revisa las repeticiones y el peso de las series completadas antes de guardar.");
      return;
    }

    const completedExercises = exercises.map((exercise) => ({
      exerciseId: exercise.id,
      name: exercise.name,
      sets: (series[exercise.id] ?? []).flatMap((set, index) => {
        if (!set.completed) return [];
        const reps = Number(set.reps);
        const weight = Number(set.weight);
        return [{ setNumber: index + 1, reps, weight }];
      }),
    }));

    try {
      await onFinish({
        userId,
        routineId: routine.id,
        routineName: routine.name,
        dayTitle: day.title,
        date: new Date(),
        durationSeconds: elapsedSeconds,
        completedExercises,
      });
    } catch (finishError) {
      console.error("Error al finalizar la sesión de Mawina:", finishError);
      setError("No se pudo guardar la sesión. Tus datos siguen disponibles para reintentar.");
    }
  };

  const cancel = () => {
    if (elapsedSeconds > 0 && !window.confirm("¿Salir del entrenamiento sin guardar la sesión?")) return;
    onCancel();
  };

  const completedSetCount = Object.values(series).reduce(
    (total, exerciseSeries) => total + exerciseSeries.filter((set) => set.completed).length,
    0,
  );
  const plannedSetCount = Object.values(series).reduce((total, exerciseSeries) => total + exerciseSeries.length, 0);

  return (
    <section className="mt-7" aria-labelledby="workout-execution-title">
      <header className="flex flex-col gap-4 rounded-2xl border border-[#d1a84b]/35 bg-[#171615] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#d1a84b]/10 text-[#e2c47d]"><Dumbbell aria-hidden="true" size={20} /></span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.17em] text-[#d1a84b]">Entrenamiento en vivo · {routine.name}</p>
            <h2 id="workout-execution-title" className="mt-2 wrap-break-word text-lg uppercase text-white sm:text-xl">{day.title}</h2>
            <p className="mt-2 text-[10px] text-white/45">{completedSetCount} de {plannedSetCount} series completadas</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="timer" aria-label="Duración de la sesión" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 text-sm tabular-nums text-[#e2c47d]">
            <Clock3 aria-hidden="true" size={16} />
            {formatTime(elapsedSeconds)}
          </div>
          <button type="button" onClick={cancel} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-[10px] uppercase text-white/60 transition hover:bg-white/5 disabled:opacity-40">
            <ArrowLeft aria-hidden="true" size={14} /> Salir
          </button>
        </div>
      </header>

      {restRemaining > 0 && (
        <aside aria-live="polite" className="mt-4 flex flex-col gap-3 rounded-xl border border-[#d1a84b]/35 bg-[#d1a84b]/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[0.16em] text-[#d1a84b]">Descanso entre series</p>
            <p className="mt-1 text-2xl tabular-nums text-white">{formatTime(restRemaining)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRestPaused((paused) => !paused)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/75 hover:bg-white/5">
              {restPaused ? <Play aria-hidden="true" size={13} /> : <Pause aria-hidden="true" size={13} />}
              {restPaused ? "Reanudar" : "Pausar"}
            </button>
            <button type="button" onClick={() => { setRestRemaining(restDuration); setRestPaused(false); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[10px] uppercase text-white/75 hover:bg-white/5">
              <RotateCcw aria-hidden="true" size={13} /> Reiniciar
            </button>
            <button type="button" onClick={() => { setRestDuration((duration) => duration + 15); setRestRemaining((remaining) => remaining + 15); }} className="min-h-10 rounded-lg border border-[#d1a84b]/35 px-3 py-2 text-[10px] uppercase text-[#e2c47d] hover:bg-[#d1a84b]/10">
              +15s
            </button>
          </div>
        </aside>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/30 bg-red-950/30 p-4 text-xs text-red-100">{error}</p>}

      {exercises.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-white/15 bg-black/20 p-7 text-center">
          <p className="text-sm text-white/65">Este día no tiene ejercicios planificados.</p>
          <p className="mt-2 text-xs text-white/40">Puedes finalizar la sesión para registrar su duración o volver al detalle para añadir ejercicios.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {exercises.map((exercise, exerciseIndex) => (
            <article key={exercise.id} className="rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.15em] text-[#d1a84b]">Ejercicio {exerciseIndex + 1}</p>
                  <h3 className="mt-2 text-sm uppercase text-white">{exercise.name}</h3>
                  <p className="mt-2 text-[10px] text-white/45">Plan: {exercise.sets} series × {exercise.reps} reps · {exercise.restSeconds}s de descanso</p>
                  {exercise.notes && <p className="mt-2 text-[10px] leading-5 text-white/45">{exercise.notes}</p>}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {(series[exercise.id] ?? []).map((set, setIndex) => (
                  <div key={`${exercise.id}-set-${setIndex + 1}`} className={`grid grid-cols-[minmax(4.5rem,0.7fr)_minmax(5rem,1fr)_minmax(6rem,1fr)_auto] items-center gap-2 rounded-xl border p-3 transition sm:gap-3 ${set.completed ? "border-[#d1a84b]/35 bg-[#d1a84b]/[0.06]" : "border-white/8 bg-black/20"}`}>
                    <span className="text-[10px] uppercase text-white/60">Serie {setIndex + 1}</span>
                    <label className="block min-w-0 text-[8px] uppercase text-white/40">
                      Reps
                      <input type="number" min={0} max={200} step={1} value={set.reps} disabled={saving} onChange={(event) => updateSet(exercise.id, setIndex, { reps: event.target.value })} aria-label={`Repeticiones reales, ${exercise.name}, serie ${setIndex + 1}`} className="mt-1 min-h-9 w-full rounded-md border border-white/10 bg-[#121212] px-2 text-xs text-white outline-none focus:border-[#d1a84b] disabled:opacity-50" />
                    </label>
                    <label className="block min-w-0 text-[8px] uppercase text-white/40">
                      Peso (kg)
                      <input type="number" min={0} max={1000} step="0.5" value={set.weight} disabled={saving} onChange={(event) => updateSet(exercise.id, setIndex, { weight: event.target.value })} aria-label={`Peso usado, ${exercise.name}, serie ${setIndex + 1}`} className="mt-1 min-h-9 w-full rounded-md border border-white/10 bg-[#121212] px-2 text-xs text-white outline-none focus:border-[#d1a84b] disabled:opacity-50" />
                    </label>
                    <button type="button" onClick={() => toggleSetComplete(exercise.id, setIndex, exercise.restSeconds)} disabled={saving} aria-pressed={set.completed} aria-label={`${set.completed ? "Desmarcar" : "Completar"} serie ${setIndex + 1} de ${exercise.name}`} className={`flex size-9 items-center justify-center rounded-lg border transition focus:outline-none focus:ring-2 focus:ring-[#d1a84b] disabled:opacity-50 ${set.completed ? "border-[#d1a84b]/60 bg-[#d1a84b]/20 text-[#f1d58f]" : "border-white/15 text-white/35 hover:bg-white/5"}`}>
                      <Check aria-hidden="true" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[10px] leading-5 text-white/40">Se guardarán las series completadas junto con las repeticiones y el peso registrados.</p>
        <button type="button" onClick={() => void finish()} disabled={saving} className="min-h-12 rounded-xl bg-[#d1a84b] px-6 py-3 text-xs font-bold uppercase text-[#17130b] transition hover:bg-[#e6c46f] focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Guardando sesión..." : "Finalizar entrenamiento"}
        </button>
      </footer>
    </section>
  );
}

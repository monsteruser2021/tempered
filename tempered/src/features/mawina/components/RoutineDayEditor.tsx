"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Dumbbell, Pencil, Plus, Trash2 } from "lucide-react";
import type { ExerciseItem, RoutineDay } from "../types/mawina.types";

type Props = {
  day: RoutineDay;
  onChange: (day: RoutineDay) => void;
};

const emptyExercise = {
  name: "",
  sets: "4",
  reps: "8-12",
  restSeconds: "90",
  notes: "",
};

export default function RoutineDayEditor({ day, onChange }: Props) {
  const [name, setName] = useState(emptyExercise.name);
  const [sets, setSets] = useState(emptyExercise.sets);
  const [reps, setReps] = useState(emptyExercise.reps);
  const [restSeconds, setRestSeconds] = useState(emptyExercise.restSeconds);
  const [notes, setNotes] = useState(emptyExercise.notes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const exercises = [...day.exercises].sort((a, b) => a.order - b.order);

  const resetForm = () => {
    setName(emptyExercise.name);
    setSets(emptyExercise.sets);
    setReps(emptyExercise.reps);
    setRestSeconds(emptyExercise.restSeconds);
    setNotes(emptyExercise.notes);
    setEditingId(null);
    setError("");
  };

  const submitExercise = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedSets = Number(sets);
    const parsedRest = Number(restSeconds);
    if (!name.trim() || !reps.trim()) {
      setError("Completa el nombre y el rango de repeticiones.");
      return;
    }
    if (!Number.isInteger(parsedSets) || parsedSets < 1 || parsedSets > 50) {
      setError("Las series deben ser un número entero entre 1 y 50.");
      return;
    }
    if (!Number.isInteger(parsedRest) || parsedRest < 0 || parsedRest > 3600) {
      setError("El descanso debe ser un número entre 0 y 3600 segundos.");
      return;
    }

    const updatedExercise: ExerciseItem = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      sets: parsedSets,
      reps: reps.trim(),
      restSeconds: parsedRest,
      order: 0,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const updated = editingId
      ? exercises.map((exercise) => exercise.id === editingId ? updatedExercise : exercise)
      : [...exercises, updatedExercise];

    onChange({
      ...day,
      exercises: updated.map((exercise, index) => ({ ...exercise, order: index })),
    });
    resetForm();
  };

  const editExercise = (exercise: ExerciseItem) => {
    setEditingId(exercise.id);
    setName(exercise.name);
    setSets(String(exercise.sets));
    setReps(exercise.reps);
    setRestSeconds(String(exercise.restSeconds));
    setNotes(exercise.notes ?? "");
    setError("");
  };

  const reorderExercise = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= exercises.length) return;
    const reordered = [...exercises];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange({
      ...day,
      exercises: reordered.map((exercise, order) => ({ ...exercise, order })),
    });
  };

  const removeExercise = (exerciseId: string) => {
    onChange({
      ...day,
      exercises: exercises
        .filter((exercise) => exercise.id !== exerciseId)
        .map((exercise, order) => ({ ...exercise, order })),
    });
    if (editingId === exerciseId) resetForm();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
      <section aria-labelledby="day-exercises-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Plan del día</p>
            <h4 id="day-exercises-title" className="mt-2 text-sm uppercase text-white">Ejercicios</h4>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] text-white/45">
            {exercises.length} {exercises.length === 1 ? "ejercicio" : "ejercicios"}
          </span>
        </div>

        {exercises.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/15 px-4 py-8 text-center">
            <Dumbbell aria-hidden="true" className="mx-auto text-[#d1a84b]/70" size={22} />
            <p className="mt-3 text-xs text-white/60">Aún no hay ejercicios en este día.</p>
            <p className="mt-1 text-[10px] text-white/35">Añade el primero desde el formulario.</p>
          </div>
        ) : (
          <ol className="mt-4 space-y-3">
            {exercises.map((exercise, index) => (
              <li key={exercise.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#d1a84b]/20 bg-[#d1a84b]/[0.07] text-[10px] text-[#e2c47d]">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h5 className="wrap-break-word text-xs uppercase text-white">{exercise.name}</h5>
                    <p className="mt-2 text-[11px] text-white/55">{exercise.sets} series <span className="px-1 text-white/25">·</span> {exercise.reps} reps <span className="px-1 text-white/25">·</span> {exercise.restSeconds}s descanso</p>
                    {exercise.notes && <p className="mt-2 text-[10px] leading-5 text-white/40">{exercise.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => reorderExercise(index, -1)} disabled={index === 0} aria-label={`Subir ${exercise.name}`} className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/10 disabled:opacity-25">
                      <ArrowUp aria-hidden="true" size={13} />
                    </button>
                    <button type="button" onClick={() => reorderExercise(index, 1)} disabled={index === exercises.length - 1} aria-label={`Bajar ${exercise.name}`} className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/10 disabled:opacity-25">
                      <ArrowDown aria-hidden="true" size={13} />
                    </button>
                    <button type="button" onClick={() => editExercise(exercise)} aria-label={`Editar ${exercise.name}`} className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/10 hover:text-white">
                      <Pencil aria-hidden="true" size={13} />
                    </button>
                    <button type="button" onClick={() => removeExercise(exercise.id)} aria-label={`Eliminar ${exercise.name}`} className="flex size-8 items-center justify-center rounded-lg border border-red-200/10 text-red-100/55 hover:border-red-200/25 hover:bg-red-950/30 hover:text-red-100">
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <form onSubmit={submitExercise} className="h-fit rounded-xl border border-[#d1a84b]/20 bg-[#d1a84b]/[0.035] p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs uppercase tracking-wide text-white">{editingId ? "Editar ejercicio" : "Añadir ejercicio"}</h4>
          {editingId && <button type="button" onClick={resetForm} className="min-h-8 rounded-md px-2 text-[9px] uppercase text-white/45 hover:bg-white/5">Cancelar edición</button>}
        </div>
        <label className="mt-4 block text-[10px] uppercase text-white/55">
          Nombre
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white outline-none focus:border-[#d1a84b]" placeholder="Ej. Press de banca plano" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-[10px] uppercase text-white/55">
            Series
            <input type="number" min={1} max={50} step={1} value={sets} onChange={(event) => setSets(event.target.value)} required className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#121212] px-3 text-xs text-white outline-none focus:border-[#d1a84b]" />
          </label>
          <label className="block text-[10px] uppercase text-white/55">
            Repeticiones
            <input value={reps} onChange={(event) => setReps(event.target.value)} required maxLength={30} className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#121212] px-3 text-xs text-white outline-none focus:border-[#d1a84b]" placeholder="10-12" />
          </label>
        </div>
        <label className="mt-3 block text-[10px] uppercase text-white/55">
          Descanso entre series (segundos)
          <input type="number" min={0} max={3600} step={1} value={restSeconds} onChange={(event) => setRestSeconds(event.target.value)} required className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#121212] px-3 text-xs text-white outline-none focus:border-[#d1a84b]" />
        </label>
        <label className="mt-3 block text-[10px] uppercase text-white/55">
          Notas técnicas <span className="text-white/30">(opcional)</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} rows={2} className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-xs text-white outline-none focus:border-[#d1a84b]" placeholder="Pausa de 2s abajo, última serie al fallo..." />
        </label>
        {error && <p role="alert" className="mt-3 text-[10px] leading-5 text-red-200">{error}</p>}
        <button type="submit" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#d1a84b] px-4 py-2 text-[10px] font-bold uppercase text-[#17130b] transition hover:bg-[#e6c46f] focus:outline-none focus:ring-2 focus:ring-white">
          <Plus aria-hidden="true" size={15} />
          {editingId ? "Guardar ejercicio" : "Añadir al día"}
        </button>
      </form>
    </div>
  );
}

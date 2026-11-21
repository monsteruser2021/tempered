"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Dumbbell, Moon, X } from "lucide-react";
import type { Routine, RoutineCategory, RoutineConfiguration, RoutineDay, RoutineScheduleType } from "../types/mawina.types";

const MAX_CYCLE_DAYS = 28;
const weekdays = [
  { value: 1, label: "Lunes", shortLabel: "Lun" },
  { value: 2, label: "Martes", shortLabel: "Mar" },
  { value: 3, label: "Miércoles", shortLabel: "Mié" },
  { value: 4, label: "Jueves", shortLabel: "Jue" },
  { value: 5, label: "Viernes", shortLabel: "Vie" },
  { value: 6, label: "Sábado", shortLabel: "Sáb" },
  { value: 0, label: "Domingo", shortLabel: "Dom" },
];

function makeDay(dayNumber: number, isRestDay: boolean, existing?: RoutineDay): RoutineDay {
  const defaultTitle = isRestDay ? "Descanso" : `Día ${dayNumber}: Entrenamiento`;
  const isDefaultTitle = !existing
    || existing.isRestDay !== isRestDay
    || existing.title === "Descanso"
    || existing.title === `Día ${existing.dayNumber}: Entrenamiento`;

  return {
    id: existing?.id ?? `day-${dayNumber}`,
    dayNumber,
    title: isDefaultTitle ? defaultTitle : existing.title,
    isRestDay,
    exercises: existing?.exercises ?? [],
  };
}

function makeCycleDays(activeDaysCount: number, restDaysCount: number, existing: RoutineDay[] = []): RoutineDay[] {
  return Array.from({ length: activeDaysCount + restDaysCount }, (_, index) =>
    makeDay(index + 1, index >= activeDaysCount, existing[index]),
  );
}

function makeFixedDays(fixedDays: number[], existing: RoutineDay[] = []): RoutineDay[] {
  return fixedDays.map((_, index) => makeDay(index + 1, false, existing[index]));
}

type Props = {
  routine?: Routine;
  onClose: () => void;
  onSave: (configuration: RoutineConfiguration, routineId?: string) => Promise<void>;
};

export default function CreateRoutineModal({ routine, onClose, onSave }: Props) {
  const [name, setName] = useState(routine?.name ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [category, setCategory] = useState<RoutineCategory>(routine?.category ?? "fitness");
  const [scheduleType, setScheduleType] = useState<RoutineScheduleType>(routine?.scheduleType ?? "cycle");
  const [activeDaysCount, setActiveDaysCount] = useState(routine?.activeDaysCount ?? 4);
  const [restDaysCount, setRestDaysCount] = useState(routine?.restDaysCount ?? 3);
  const initialFixedDays = routine?.fixedDays ?? [1, 2, 3, 4];
  const [fixedDays, setFixedDays] = useState(initialFixedDays);
  const [days, setDays] = useState<RoutineDay[]>(() => {
    if (routine?.days.length) return routine.days;
    return routine?.scheduleType === "fixed_days"
      ? makeFixedDays(initialFixedDays)
      : makeCycleDays(4, 3);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const changeCycleCount = (kind: "active" | "rest", rawValue: string) => {
    if (rawValue === "") return;
    const value = Number(rawValue);
    if (!Number.isInteger(value)) return;

    const nextActive = kind === "active"
      ? Math.min(MAX_CYCLE_DAYS, Math.max(1, Math.min(value, MAX_CYCLE_DAYS - restDaysCount)))
      : activeDaysCount;
    const nextRest = kind === "rest"
      ? Math.min(MAX_CYCLE_DAYS - 1, Math.max(0, Math.min(value, MAX_CYCLE_DAYS - nextActive)))
      : restDaysCount;

    setActiveDaysCount(nextActive);
    setRestDaysCount(nextRest);
    setDays((current) => makeCycleDays(nextActive, nextRest, current));
    setError("");
  };

  const changeScheduleType = (nextType: RoutineScheduleType) => {
    if (nextType === scheduleType) return;
    if (nextType === "fixed_days") {
      const nextFixedDays = fixedDays.length > 0 ? fixedDays : [1, 2, 3, 4];
      setFixedDays(nextFixedDays);
      setDays((current) => makeFixedDays(nextFixedDays, current.filter((day) => !day.isRestDay)));
      setActiveDaysCount(nextFixedDays.length);
      setRestDaysCount(7 - nextFixedDays.length);
    } else {
      const nextActiveCount = Math.max(1, days.length);
      const nextRestCount = Math.max(0, Math.min(restDaysCount, MAX_CYCLE_DAYS - nextActiveCount));
      setActiveDaysCount(nextActiveCount);
      setRestDaysCount(nextRestCount);
      setDays((current) => makeCycleDays(nextActiveCount, nextRestCount, current));
    }
    setScheduleType(nextType);
    setError("");
  };

  const toggleFixedDay = (weekday: number) => {
    const nextFixedDays = weekdays
      .filter((day) => day.value === weekday ? !fixedDays.includes(weekday) : fixedDays.includes(day.value))
      .map((day) => day.value);
    const daysByWeekday = new Map<number, RoutineDay>();
    fixedDays.forEach((value, index) => {
      if (days[index]) daysByWeekday.set(value, days[index]);
    });

    setFixedDays(nextFixedDays);
    setDays(nextFixedDays.map((value, index) => makeDay(index + 1, false, daysByWeekday.get(value))));
    setActiveDaysCount(nextFixedDays.length);
    setRestDaysCount(7 - nextFixedDays.length);
    setError("");
  };

  const toggleRestDay = (dayId: string) => {
    const target = days.find((day) => day.id === dayId);
    if (!target) return;
    if (!target.isRestDay && days.filter((day) => !day.isRestDay).length <= 1) {
      setError("El ciclo debe conservar al menos un día activo.");
      return;
    }

    const nextDays = days.map((day) => day.id === dayId
      ? { ...day, isRestDay: !day.isRestDay, title: day.isRestDay ? `Día ${day.dayNumber}: Entrenamiento` : "Descanso" }
      : day);
    setDays(nextDays);
    setActiveDaysCount(nextDays.filter((day) => !day.isRestDay).length);
    setRestDaysCount(nextDays.filter((day) => day.isRestDay).length);
    setError("");
  };

  const reorderDay = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= days.length) return;
    const reordered = [...days];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setDays(reordered.map((day, dayIndex) => {
      const dayNumber = dayIndex + 1;
      const hasDefaultTitle = day.isRestDay
        ? day.title === "Descanso"
        : day.title === `Día ${day.dayNumber}: Entrenamiento`;
      return {
        ...day,
        dayNumber,
        title: hasDefaultTitle && !day.isRestDay ? `Día ${dayNumber}: Entrenamiento` : day.title,
      };
    }));
    setError("");
  };

  const updateDayTitle = (dayId: string, title: string) => {
    setDays((current) => current.map((day) => day.id === dayId ? { ...day, title } : day));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || saving) return;

    const activeCount = scheduleType === "cycle"
      ? days.filter((day) => !day.isRestDay).length
      : fixedDays.length;
    const restCount = scheduleType === "cycle"
      ? days.filter((day) => day.isRestDay).length
      : 7 - fixedDays.length;

    if (activeCount < 1 || (scheduleType === "fixed_days" && fixedDays.length === 0)) {
      setError("Configura al menos un día activo.");
      return;
    }

    const configuration: RoutineConfiguration = {
      name: name.trim(),
      description: description.trim(),
      category,
      scheduleType,
      activeDaysCount: activeCount,
      restDaysCount: restCount,
      days: days.map((day, index) => ({ ...day, dayNumber: index + 1 })),
      ...(scheduleType === "fixed_days" ? { fixedDays: [...fixedDays] } : {}),
    };

    setSaving(true);
    setError("");
    try {
      await onSave(configuration, routine?.id);
      onClose();
    } catch (saveError) {
      console.error("Error al guardar la configuración de Mawina:", saveError);
      setError("No se pudo guardar la rutina. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-modal-title"
        className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#d1a84b]/35 bg-[#151515] p-5 text-white shadow-2xl shadow-black/60 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#d1a84b]">Mawina Kairos · {routine ? "Configuración" : "Nueva rutina"}</p>
            <h2 id="routine-modal-title" className="mt-2 text-xl uppercase tracking-wide text-white sm:text-2xl">
              {routine ? "Editar rutina" : "Diseña tu rutina"}
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar formulario" className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/15 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-7">
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-white/60">Datos generales</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs text-white/65 sm:col-span-2">
                Nombre de la rutina
                <input
                  ref={nameInput}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={100}
                  className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#d1a84b]"
                  placeholder="Ej. Hipertrofia Torso/Pierna"
                />
              </label>
              <label className="block text-xs text-white/65 sm:col-span-2">
                Descripción o enfoque <span className="text-white/35">(opcional)</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={400}
                  rows={2}
                  className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#d1a84b]"
                  placeholder="Enfoque, objetivo o notas del plan"
                />
              </label>
              <label className="block text-xs text-white/65 sm:col-span-2">
                Categoría
                <select value={category} onChange={(event) => setCategory(event.target.value as RoutineCategory)} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#202020] px-4 text-sm text-white outline-none focus:border-[#d1a84b]">
                  <option value="fitness">Entrenamiento físico</option>
                  <option value="habit">Hábitos / Productividad</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-white/60">Esquema de días</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => changeScheduleType("cycle")} aria-pressed={scheduleType === "cycle"} className={`flex min-h-20 items-start gap-3 rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#d1a84b] ${scheduleType === "cycle" ? "border-[#d1a84b]/80 bg-[#d1a84b]/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
                <Dumbbell aria-hidden="true" className="mt-0.5 shrink-0 text-[#d1a84b]" size={18} />
                <span><span className="block text-xs uppercase text-white">Ciclo flexible <span className="text-[#d1a84b]">· Recomendado</span></span><span className="mt-1 block text-[11px] leading-5 text-white/45">Avanza al completar cada bloque, sin días fijos.</span></span>
              </button>
              <button type="button" onClick={() => changeScheduleType("fixed_days")} aria-pressed={scheduleType === "fixed_days"} className={`flex min-h-20 items-start gap-3 rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#d1a84b] ${scheduleType === "fixed_days" ? "border-[#d1a84b]/80 bg-[#d1a84b]/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
                <CalendarDays aria-hidden="true" className="mt-0.5 shrink-0 text-[#d1a84b]" size={18} />
                <span><span className="block text-xs uppercase text-white">Días fijos de la semana</span><span className="mt-1 block text-[11px] leading-5 text-white/45">Programa entrenamientos según el calendario.</span></span>
              </button>
            </div>
          </fieldset>

          {scheduleType === "cycle" ? (
            <fieldset>
              <legend className="text-xs uppercase tracking-wider text-white/60">Duración del ciclo · {days.length} bloques</legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block text-xs text-white/65">
                  Días activos
                  <input type="number" min={1} max={MAX_CYCLE_DAYS - restDaysCount} value={activeDaysCount} onChange={(event) => changeCycleCount("active", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-sm text-white outline-none focus:border-[#d1a84b]" />
                </label>
                <label className="block text-xs text-white/65">
                  Días de descanso
                  <input type="number" min={0} max={MAX_CYCLE_DAYS - activeDaysCount} value={restDaysCount} onChange={(event) => changeCycleCount("rest", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-sm text-white outline-none focus:border-[#d1a84b]" />
                </label>
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className="text-xs uppercase tracking-wider text-white/60">Días de entrenamiento · {fixedDays.length} seleccionados</legend>
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {weekdays.map((weekday) => (
                  <label key={weekday.value} className="cursor-pointer">
                    <input type="checkbox" checked={fixedDays.includes(weekday.value)} onChange={() => toggleFixedDay(weekday.value)} className="peer sr-only" />
                    <span className="flex min-h-11 items-center justify-center rounded-lg border border-white/15 bg-black/20 px-2 text-[10px] text-white/55 transition peer-checked:border-[#d1a84b]/80 peer-checked:bg-[#d1a84b]/15 peer-checked:text-[#f1d58f] peer-focus-visible:ring-2 peer-focus-visible:ring-[#d1a84b]" title={weekday.label}>{weekday.shortLabel}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-white/60">
              {scheduleType === "cycle" ? "Bloques del ciclo · orden y enfoque" : "Días programados · títulos"}
            </legend>
            <p className="mt-1 text-[11px] leading-5 text-white/40">
              {scheduleType === "cycle" ? "Personaliza el nombre, marca descansos y usa las flechas para reordenar el ciclo." : "Asigna un título a cada día. Más adelante podrás añadir ejercicios en su detalle."}
            </p>
            <ol className="mt-3 space-y-2">
              {days.map((day, index) => (
                <li key={day.id} className={`flex min-w-0 items-center gap-2 rounded-xl border p-3 ${day.isRestDay ? "border-white/10 bg-white/[0.03]" : "border-[#d1a84b]/20 bg-[#d1a84b]/[0.04]"}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/25 text-[10px] text-white/55">
                    {day.isRestDay ? <Moon aria-label="Descanso" size={14} /> : day.dayNumber}
                  </span>
                  {scheduleType === "fixed_days" && (
                    <span className="w-10 shrink-0 text-[10px] uppercase text-[#d1a84b]">
                      {weekdays.find((weekday) => weekday.value === fixedDays[index])?.shortLabel}
                    </span>
                  )}
                  <input
                    value={day.title}
                    onChange={(event) => updateDayTitle(day.id, event.target.value)}
                    disabled={day.isRestDay}
                    required={!day.isRestDay}
                    maxLength={100}
                    aria-label={`Título del día ${day.dayNumber}`}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-transparent bg-black/20 px-3 text-xs text-white outline-none focus:border-[#d1a84b] disabled:text-white/40"
                  />
                  {scheduleType === "cycle" ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => reorderDay(index, -1)} disabled={index === 0} aria-label={`Mover día ${day.dayNumber} antes`} className="flex size-9 items-center justify-center rounded-lg border border-white/10 text-white/55 transition hover:bg-white/10 disabled:opacity-25">
                        <ArrowUp aria-hidden="true" size={14} />
                      </button>
                      <button type="button" onClick={() => reorderDay(index, 1)} disabled={index === days.length - 1} aria-label={`Mover día ${day.dayNumber} después`} className="flex size-9 items-center justify-center rounded-lg border border-white/10 text-white/55 transition hover:bg-white/10 disabled:opacity-25">
                        <ArrowDown aria-hidden="true" size={14} />
                      </button>
                      <button type="button" onClick={() => toggleRestDay(day.id)} aria-label={day.isRestDay ? `Marcar día ${day.dayNumber} como activo` : `Marcar día ${day.dayNumber} como descanso`} className={`min-h-9 rounded-lg border px-2 text-[9px] uppercase transition ${day.isRestDay ? "border-white/15 text-white/55 hover:bg-white/10" : "border-[#d1a84b]/35 text-[#e2c47d] hover:bg-[#d1a84b]/10"}`}>
                        {day.isRestDay ? "Hacer activo" : "Descanso"}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </fieldset>

          {error && <p role="alert" className="rounded-xl border border-red-300/30 bg-red-950/30 p-3 text-xs leading-5 text-red-100">{error}</p>}

          <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-white/15 px-5 py-3 text-xs uppercase text-white/65 transition hover:bg-white/5 disabled:opacity-40">Cancelar</button>
            <button type="submit" disabled={!name.trim() || saving || (scheduleType === "fixed_days" && fixedDays.length === 0)} className="min-h-11 rounded-xl bg-[#d1a84b] px-6 py-3 text-xs font-bold uppercase text-[#17130b] transition hover:bg-[#e6c46f] disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Guardando..." : routine ? "Guardar cambios" : "Crear rutina"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

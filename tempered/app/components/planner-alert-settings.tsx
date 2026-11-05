"use client";

import { useState } from "react";
import {
  isPlannerAlertThresholds,
  PLANNER_ALERT_THRESHOLDS_EVENT,
  plannerAlertStorageKey,
  type PlannerAlertThresholds,
} from "@/lib/planner-health";

export default function PlannerAlertSettings({
  userId,
  thresholds,
}: {
  userId: string;
  thresholds: PlannerAlertThresholds;
}) {
  const [draft, setDraft] = useState(thresholds);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isPlannerAlertThresholds(draft)) {
      setError("Los umbrales deben ser enteros entre 1 y 100 y estar en orden creciente (precaución < peligro < crítico).");
      setNotice("");
      return;
    }
    try {
      window.localStorage.setItem(plannerAlertStorageKey(userId), JSON.stringify(draft));
      window.dispatchEvent(new CustomEvent(PLANNER_ALERT_THRESHOLDS_EVENT, { detail: draft }));
      setError("");
      setNotice("Umbrales guardados en este dispositivo y sincronizados con el panel Isorropia.");
    } catch (storageError) {
      console.error("No se pudieron guardar los umbrales de alerta del Planificador:", storageError);
      setError("No se pudieron guardar las preferencias. Comprueba el almacenamiento del navegador e inténtalo de nuevo.");
      setNotice("");
    }
  };

  return (
    <details className="mt-6 border border-white/15 bg-black/35">
      <summary className="cursor-pointer px-4 py-3 text-xs uppercase tracking-wider text-white/75 hover:text-white">
        Ajustes de alertas de endeudamiento
      </summary>
      <form onSubmit={save} className="border-t border-white/10 p-4 sm:p-5">
        <p className="text-xs leading-5 text-white/55">
          Define cuándo quieres recibir avisos sobre el porcentaje comprometido de tu próximo ingreso. Los cambios se guardan en este dispositivo y se comparten con el panel Isorropia.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {([
            { key: "caution", label: "Precaución", color: "text-amber-200" },
            { key: "danger", label: "Peligro", color: "text-orange-200" },
            { key: "critical", label: "Crítico", color: "text-red-200" },
          ] as const).map((field) => (
            <label key={field.key} className={`text-xs uppercase ${field.color}`}>
              Nivel {field.label} · %
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                required
                value={draft[field.key]}
                onChange={(inputEvent) => setDraft((current) => ({
                  ...current,
                  [field.key]: inputEvent.target.value === "" ? 0 : Number(inputEvent.target.value),
                }))}
                className="mt-2 min-h-11 w-full rounded-lg border border-white/20 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36]"
              />
            </label>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-red-200">{error}</p>}
        {!error && !isPlannerAlertThresholds(draft) && (
          <p className="mt-3 text-xs text-amber-200">Usa valores enteros de 1 a 100 y ordénalos de menor a mayor.</p>
        )}
        {notice && <p role="status" className="mt-3 text-xs text-emerald-200">{notice}</p>}
        <button type="submit" className="mt-4 min-h-10 rounded-lg border border-[#ddab36]/45 px-4 py-2 text-xs font-semibold uppercase text-[#ddab36] hover:bg-[#ddab36]/10">
          Guardar umbrales
        </button>
      </form>
    </details>
  );
}

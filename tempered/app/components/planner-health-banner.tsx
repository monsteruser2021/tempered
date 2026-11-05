"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  formatPlannerAlertMoney,
  plannerAlertPresentation,
  type NextIncomeAssessment,
} from "@/lib/planner-health";

export default function PlannerHealthBanner({
  assessment,
  compact = false,
}: {
  assessment: NextIncomeAssessment | null;
  compact?: boolean;
}) {
  if (!assessment || (!assessment.level && !assessment.hasMissingDebts)) return null;

  const presentation = plannerAlertPresentation(assessment.level ?? "critical");
  const headline = assessment.hasMissingDebts && !assessment.level
    ? "Verificación requerida"
    : presentation.label;
  const message = assessment.hasMissingDebts
    ? "No se pudieron verificar todas las deudas del próximo ingreso. Revisa las asignaciones antes de asumir nuevos compromisos."
    : presentation.message;

  return (
    <aside role="alert" className={`border p-4 sm:p-5 ${presentation.classes}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className={`mt-0.5 shrink-0 ${presentation.accent}`} size={compact ? 18 : 21} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`text-xs font-bold uppercase tracking-[0.14em] sm:text-sm ${presentation.accent}`}>
              Alerta de salud financiera · {headline}
            </h2>
            {(!assessment.hasMissingDebts || assessment.level) && (
              <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold">
                {assessment.percentage.toFixed(0)}% comprometido{assessment.hasMissingDebts ? " conocido" : ""}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold leading-6">{message}</p>
          <p className="mt-2 text-xs leading-5 opacity-85">
            Próximo ingreso: <strong>{assessment.income.title}</strong> · {assessment.income.estimatedDate}
            {" · "}Comprometido {assessment.hasMissingDebts ? "verificado hasta ahora " : ""}
            {formatPlannerAlertMoney(assessment.committed, assessment.income.currency)}
            {assessment.hasMissingDebts
              ? " · Dinero libre real no calculable hasta verificar las deudas vinculadas."
              : ` · Libre ${formatPlannerAlertMoney(assessment.free, assessment.income.currency)}`}
          </p>
          {compact && (
            <Link href="/planificador" className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-current/35 px-3 py-2 text-[10px] font-semibold uppercase hover:bg-black/15 focus:outline-none focus:ring-2 focus:ring-current">
              Revisar Planificador
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}

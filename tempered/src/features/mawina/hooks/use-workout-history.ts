"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getWorkoutHistoryPage,
  getWorkoutMetrics,
  type WorkoutHistoryPage,
} from "../services/mawina.service";
import type { WorkoutMetrics, WorkoutSession } from "../types/mawina.types";

type WorkoutHistoryResult = {
  userId: string;
  sessions: WorkoutSession[];
  cursor: WorkoutHistoryPage["nextCursor"];
  hasMore: boolean;
  metrics: WorkoutMetrics | null;
  error: string;
};

export function useWorkoutHistory(userId: string | null) {
  const [result, setResult] = useState<WorkoutHistoryResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingMoreRef = useRef(false);
  const currentResult = result?.userId === userId ? result : null;

  const reload = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    try {
      const [page, metrics] = await Promise.all([
        getWorkoutHistoryPage(userId),
        getWorkoutMetrics(userId),
      ]);
      setResult({
        userId,
        sessions: page.sessions,
        cursor: page.nextCursor,
        hasMore: page.hasMore,
        metrics,
        error: "",
      });
    } catch (loadError) {
      console.error("Error al cargar las métricas y el historial de Mawina:", loadError);
      setResult((previous) => ({
        userId,
        sessions: previous?.userId === userId ? previous.sessions : [],
        cursor: previous?.userId === userId ? previous.cursor : null,
        hasMore: previous?.userId === userId ? previous.hasMore : false,
        metrics: previous?.userId === userId ? previous.metrics : null,
        error: "No se pudieron cargar las métricas y el historial de sesiones.",
      }));
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const [page, metrics] = await Promise.all([
          getWorkoutHistoryPage(userId),
          getWorkoutMetrics(userId),
        ]);
        if (active) {
          setResult({
            userId,
            sessions: page.sessions,
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            metrics,
            error: "",
          });
        }
      } catch (loadError) {
        console.error("Error al cargar las métricas y el historial de Mawina:", loadError);
        if (active) {
          setResult({
            userId,
            sessions: [],
            cursor: null,
            hasMore: false,
            metrics: null,
            error: "No se pudieron cargar las métricas y el historial de sesiones.",
          });
        }
      }
    })();
    return () => { active = false; };
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!userId || !currentResult?.hasMore || !currentResult.cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getWorkoutHistoryPage(userId, currentResult.cursor);
      setResult((previous) => {
        if (!previous || previous.userId !== userId) return previous;
        const existingIds = new Set(previous.sessions.map((session) => session.id));
        const nextSessions = page.sessions.filter((session) => !existingIds.has(session.id));
        return {
          ...previous,
          sessions: [...previous.sessions, ...nextSessions],
          cursor: page.nextCursor,
          hasMore: page.hasMore,
          error: "",
        };
      });
    } catch (loadError) {
      console.error("Error al cargar otra página del historial de Mawina:", loadError);
      setResult((previous) => previous?.userId === userId
        ? { ...previous, error: "No se pudo cargar la siguiente página del historial." }
        : previous);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [currentResult, userId]);

  return {
    sessions: currentResult?.sessions ?? [],
    metrics: currentResult?.metrics ?? null,
    loading: Boolean(userId && !currentResult),
    loadingMore,
    refreshing,
    hasMore: currentResult?.hasMore ?? false,
    error: currentResult?.error ?? "",
    reload,
    loadMore,
  };
}

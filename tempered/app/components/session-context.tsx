"use client";

import { onAuthStateChanged } from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type SessionContextValue = {
  userId: string | null;
  authenticated: boolean;
  loading: boolean;
};

const SessionContext = createContext<SessionContextValue>({ userId: null, authenticated: false, loading: true });

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "permission-denied";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [firebaseAuthenticated, setFirebaseAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authChangeId = 0;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const currentChangeId = ++authChangeId;
      setFirebaseAuthenticated(Boolean(user));
      setLoading(true);
      setUserId(null);

      if (!user) {
        document.cookie = "tempered_user_id=; Max-Age=0; path=/";
        setLoading(false);
        return;
      }

      void (async () => {
        try {
          const userRef = doc(db, "users", user.uid);
          const userSnapshot = await getDoc(userRef);
          if (!userSnapshot.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              authUid: user.uid,
              email: user.email,
              displayName: user.displayName,
              createdAt: serverTimestamp(),
            });
          }
        } catch (error) {
          if (isPermissionDenied(error)) {
            console.warn("No se pudo sincronizar el perfil por permisos; se continuará con la sesión autenticada.", error);
          } else {
            console.error("No se pudo sincronizar el perfil de Tempered:", error);
          }
        } finally {
          if (active && currentChangeId === authChangeId) {
            setUserId(user.uid);
            document.cookie = `tempered_user_id=${encodeURIComponent(user.uid)}; path=/; SameSite=Lax`;
            setLoading(false);
          }
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <SessionContext.Provider value={{ userId, authenticated: firebaseAuthenticated, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

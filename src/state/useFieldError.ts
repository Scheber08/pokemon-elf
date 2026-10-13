import { useCallback, useEffect, useRef, useState } from 'react';

interface FieldError {
  message: string;
  /** Zählt die Fehlversuche – jeder fokussiert das Feld und sagt die Meldung neu an */
  attempt: number;
}

/**
 * Meldung direkt an einem Eingabefeld (z. B. abgelehnter Spielername).
 *
 * fail(message) zeigt die Meldung und fokussiert das Feld – erst nach dem Rendern, damit
 * aria-invalid/aria-describedby beim Fokus schon stehen. Die Meldung gehört in ein Element mit
 * role="alert" und key={error.attempt}: So wird sie bei jedem Fehlversuch neu angesagt, auch
 * wenn der Fokus schon im Feld steht (Absenden mit Enter). clear() nimmt sie zurück (Tippen).
 */
export function useFieldError<T extends HTMLElement = HTMLInputElement>() {
  const ref = useRef<T>(null);
  const [error, setError] = useState<FieldError | null>(null);
  const attemptRef = useRef(0);
  const attempt = error?.attempt;

  useEffect(() => {
    if (attempt != null) ref.current?.focus();
  }, [attempt]);

  const fail = useCallback((message: string) => setError({ message, attempt: ++attemptRef.current }), []);
  const clear = useCallback(() => setError(null), []);

  return { ref, error, fail, clear };
}

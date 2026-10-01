import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';

import type { Db } from '../db/driver';
import { openDb } from '../db/expo';

export interface AsyncState<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const run = useRef(0);

  const load = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => id === run.current && setState({ data, loading: false }),
      (e) => id === run.current && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

export function useDb(): Db | undefined {
  const [db, setDb] = useState<Db>();
  useEffect(() => {
    openDb().then(setDb);
  }, []);
  return db;
}

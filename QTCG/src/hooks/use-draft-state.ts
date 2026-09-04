import { useEffect, useState, useCallback } from 'react';
import { getGetDraftStateQueryKey, useGetDraftState, useSaveDraftState } from '@workspace/api-client-react';
import type { DraftState, DraftStateInput } from '@workspace/api-client-react';

const LOCAL_STORAGE_KEY = 'qspn_draft_state_backup';

export function useDraftStatePoller() {
  const [isOffline, setIsOffline] = useState(false);
  
  const { data: serverState, isError } = useGetDraftState({
    query: {
      queryKey: getGetDraftStateQueryKey(),
      refetchInterval: 3000,
      retry: 1,
    }
  });

  const saveMutation = useSaveDraftState();
  const [localState, setLocalState] = useState<DraftState | null>(null);

  // Sync to local state when server state changes and is newer
  useEffect(() => {
    if (serverState) {
      setIsOffline(false);
      setLocalState(prev => {
        if (!prev || new Date(serverState.updatedAt).getTime() > new Date(prev.updatedAt).getTime()) {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serverState));
          return serverState;
        }
        return prev;
      });
    }
  }, [serverState]);

  // Load from local storage initially if we have no state
  useEffect(() => {
    if (!localState) {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setLocalState(parsed);
        } catch (e) {
          console.error("Failed to parse local draft state", e);
        }
      }
    }
  }, [localState]);

  // Handle offline status
  useEffect(() => {
    if (isError) {
      setIsOffline(true);
    }
  }, [isError]);

  const updateState = useCallback((updater: (prev: DraftState) => DraftStateInput) => {
    if (!localState) return;
    
    const newStateInput = updater(localState);
    newStateInput.updatedAt = new Date().toISOString();
    
    // Optimistic update
    const newLocalState = newStateInput as DraftState;
    setLocalState(newLocalState);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newLocalState));

    saveMutation.mutate({ data: newStateInput }, {
      onSuccess: () => {
        setIsOffline(false);
      },
      onError: () => {
        setIsOffline(true);
      }
    });
  }, [localState, saveMutation]);

  return {
    state: localState,
    isOffline,
    updateState,
    isSaving: saveMutation.isPending,
  };
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Player {
  discord_id: string;
  gamertag: string;
  position: string;
  school?: string;
  college?: string;
  archetype?: string;
  drafted_by?: string | null;
  pick_number?: number | null;
  drafted_at?: number | null;
  hype_video_url?: string;
  entrance_audio_url?: string;
  media_url?: string;
  rank_score?: number;
  overall?: number;
  rating?: number;
  [key: string]: any;
}

export interface DraftSlot {
  pick: number;
  team: string;
  round: number;
}

export interface DraftPick extends DraftSlot {
  player: string;
  player_id: string;
  timestamp: number;
  source: string;
}

export interface ServerDraftState {
  revision: number;
  status: string;
  teams: string[];
  coaches: Record<string, string>;
  players: Record<string, Player>;
  order: DraftSlot[];
  picks: DraftPick[];
  current_pick: number;
  pick_seconds: number;
  deadline_at: number | null;
  paused_remaining: number | null;
  protected_picks: number[];
  trades: any[];
  audit_log: any[];
  promo: any | null;
  server_time: number;
  access: "admin" | "coach" | "player";
  my_team: string | null;
  strategies: Record<string, { targets: string[]; notes: string; updated_at: number }>;
}

export function useDraftState() {
  return useQuery<ServerDraftState>({
    queryKey: ['draft-state'],
    queryFn: async () => {
      const session = localStorage.getItem('qcl-session');
      if (!session) throw new Error("No session");
      const res = await fetch(`/api/draft/state?session=${encodeURIComponent(session)}`);
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Unauthorized" : "Fetch failed");
      }
      return res.json();
    },
    refetchInterval: 2500,
  });
}

export function useDraftAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const session = localStorage.getItem('qcl-session');
      const res = await fetch(`/api/draft/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, session })
      });
      if (!res.ok) {
         const err = await res.json().catch(() => ({}));
         throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.draft) {
        queryClient.setQueryData(['draft-state'], data.draft);
      }
    }
  });
}

import { useEffect, useState } from 'react';
import { useDraftState } from '@/lib/api';
import { Clock } from 'lucide-react';

export default function Header() {
  const { data: state } = useDraftState();
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (state.status === 'paused' && state.paused_remaining) {
        setTimeLeft(state.paused_remaining * 1000);
      } else if (state.deadline_at) {
        const serverLocalDiff = state.server_time * 1000 - Date.now();
        const deadlineMs = state.deadline_at * 1000;
        const remaining = Math.max(0, deadlineMs - (Date.now() + serverLocalDiff));
        setTimeLeft(remaining);
      } else {
        setTimeLeft(0);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [state]);

  const formatTime = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isLowTime = timeLeft < 10000 && timeLeft > 0;
  
  if (!state) return null;

  const recent = [...state.picks].reverse().slice(0, 3);
  const currentTurn = state.order[state.current_pick];
  const round = currentTurn ? currentTurn.round : (state.picks[state.picks.length - 1]?.round || 1);
  const pickNo = currentTurn ? currentTurn.pick : (state.picks[state.picks.length - 1]?.pick || 0);

  return (
    <div className="h-20 bg-background border-b border-border flex items-center justify-between px-6 md:px-8 shrink-0 relative z-10 shadow-sm">
      <div className="flex items-center gap-8 md:gap-12">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">On the Clock</span>
          <div className={`font-mono text-3xl font-bold flex items-center gap-3 tracking-tighter ${isLowTime ? 'text-destructive animate-pulse' : 'text-primary'}`}>
            <Clock size={24} className="opacity-80" />
            {state.status === 'paused' ? 'PAUSED' : formatTime(timeLeft)}
          </div>
        </div>
        
        <div className="w-px h-10 bg-border hidden sm:block" />
        
        <div className="hidden sm:flex flex-col">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Round / Pick</span>
          <div className="font-mono text-2xl font-bold text-foreground tracking-tighter">
            {round} <span className="text-muted-foreground font-normal">/</span> {pickNo}
          </div>
        </div>

        {currentTurn && (
          <>
            <div className="w-px h-10 bg-border hidden lg:block" />
            <div className="hidden lg:flex flex-col">
               <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Up Next</span>
               <div className="font-bold text-lg font-mono tracking-tighter">{currentTurn.team}</div>
            </div>
          </>
        )}
      </div>

      <div className="hidden lg:flex items-center gap-4 flex-1 justify-end pr-32">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">Recent Selections:</div>
        <div className="flex items-center gap-3 overflow-hidden">
          {recent.length === 0 ? <span className="text-sm font-mono text-muted-foreground/50 italic">Awaiting first pick...</span> : recent.map((pick) => {
            const p = Object.values(state.players).find(pl => pl.discord_id === pick.player_id || pl.gamertag === pick.player);
            return (
              <div key={`${pick.pick}-${pick.team}`} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-md text-sm shrink-0 shadow-sm">
                <span className="font-bold font-mono tracking-tight">{pick.team}</span>
                <span className="text-muted-foreground font-mono text-xs truncate max-w-[120px]">{p?.gamertag || pick.player}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

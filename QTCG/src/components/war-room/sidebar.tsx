import { useState, useEffect, useRef } from 'react';
import { useDraftState, useDraftAction } from '@/lib/api';
import { GripVertical, Save } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

export default function Sidebar() {
  const { data: state } = useDraftState();
  const saveStrategy = useDraftAction();
  
  const teamId = state?.my_team;
  const serverStrategy = teamId ? state?.strategies?.[teamId] : null;

  const [notes, setNotes] = useState(() => {
    return localStorage.getItem('qspn_local_notes') || serverStrategy?.notes || '';
  });
  const [board, setBoard] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('qspn_local_board') || 'null') || serverStrategy?.targets || [];
    } catch {
      return [];
    }
  });

  const notesRef = useRef(notes);
  const boardRef = useRef(board);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (serverStrategy?.notes && !notesRef.current) {
      setNotes(serverStrategy.notes);
      notesRef.current = serverStrategy.notes;
    }
    if (serverStrategy?.targets && boardRef.current.length === 0) {
      setBoard(serverStrategy.targets);
      boardRef.current = serverStrategy.targets;
    }
  }, [serverStrategy]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (notesRef.current !== notes || JSON.stringify(boardRef.current) !== JSON.stringify(board)) {
        setIsSaving(true);
        localStorage.setItem('qspn_local_notes', notes);
        localStorage.setItem('qspn_local_board', JSON.stringify(board));
        
        saveStrategy.mutate(
          { action: 'strategy', team: teamId, notes, targets: board },
          { 
            onSettled: () => setIsSaving(false),
            onSuccess: () => {
              notesRef.current = notes;
              boardRef.current = board;
            }
          }
        );
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [notes, board, teamId, saveStrategy]);

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  if (!state) return null;

  const handleDragStart = (idx: number) => setDraggedIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const newBoard = [...board];
    const item = newBoard.splice(draggedIdx, 1)[0];
    newBoard.splice(idx, 0, item);
    setDraggedIdx(idx);
    setBoard(newBoard);
  };
  const handleDragEnd = () => {
    setDraggedIdx(null);
  };

  const getPlayer = (id: string) => Object.values(state.players).find(p => p.discord_id === id || p.gamertag === id);

  const myPicks = state.picks.filter(p => p.team === teamId);
  const maxSlots = 10;
  
  const displayBoard = board.map(pid => getPlayer(pid)).filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-card relative">
      <div className="p-5 border-b border-border bg-background/50 flex items-center gap-4 shrink-0">
        <div className="w-10 h-10 rounded bg-primary flex items-center justify-center font-bold text-primary-foreground shadow-lg text-lg uppercase">
          {teamId ? teamId.substring(0, 3) : state.access === 'admin' ? 'ADM' : 'SPC'}
        </div>
        <div>
          <div className="font-bold text-sm tracking-widest text-primary uppercase">
            {teamId ? `WAR ROOM - ${teamId}` : state.access === 'admin' ? "MASTER CONTROL" : "SPECTATOR"}
          </div>
          <div className="text-xs text-muted-foreground font-mono uppercase mt-0.5">
            {state.access}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 flex flex-col gap-8">
          {teamId || state.access === 'admin' ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  <span>Bench Notes</span>
                  {isSaving && <span className="text-secondary animate-pulse flex items-center gap-1"><Save size={12}/> Saving...</span>}
                </div>
                <Textarea 
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="bg-background border-border resize-none h-32 font-mono text-sm focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary"
                  placeholder="Jot down synergies and rotation strategy..."
                />
              </div>

              <div className="space-y-3">
                <div className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground flex flex-col">
                  Big Board Targets
                  <span className="text-[10px] opacity-60 normal-case font-sans mt-0.5">Drag & Drop tactical order</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {displayBoard.map((p, idx) => {
                    if (!p) return null;
                    const isDrafted = !!p.drafted_by;
                    const id = p.discord_id || p.gamertag;
                    return (
                      <div 
                        key={id}
                        draggable={!isDrafted}
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-3 p-3 rounded-md text-sm bg-background border transition-all
                          ${isDrafted ? 'opacity-30 border-border cursor-not-allowed' : 'border-border/50 cursor-grab active:cursor-grabbing hover:border-primary/50'}
                          ${draggedIdx === idx ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}
                        `}
                      >
                        <div className="w-5 text-center font-mono text-xs font-bold text-muted-foreground">
                          {(idx + 1).toString().padStart(2, '0')}
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 shadow-[0_0_8px_rgba(212,175,55,0.6)]" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate flex items-center gap-2">
                            {p.gamertag || 'Unknown'}
                            {isDrafted && <span className="text-[9px] text-destructive uppercase tracking-widest font-mono border border-destructive/30 px-1 rounded">{p.drafted_by}</span>}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground uppercase mt-0.5 truncate">
                            {p.position} • {p.school || p.college || 'N/A'}
                          </div>
                        </div>
                        <div className="text-xs font-mono font-bold text-muted-foreground shrink-0">{p.overall || p.rank_score || p.rating || '--'} OVR</div>
                        {!isDrafted && <GripVertical size={16} className="text-muted-foreground/30 shrink-0 ml-1" />}
                      </div>
                    );
                  })}
                  {displayBoard.length === 0 && (
                    <div className="text-xs text-muted-foreground italic text-center p-4 border border-dashed border-border rounded">
                      Pin players from the board to track them here.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground text-center pt-10 font-mono">
              Spectators cannot edit strategies.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-5 border-t border-border bg-background shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.2)] relative z-10">
        <div className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4">
          {teamId ? 'Current Picks' : 'Overall Progress'} ({teamId ? myPicks.length : state.picks.length})
        </div>
        {teamId && (
          <div className="flex flex-wrap gap-2.5">
            {Array.from({ length: maxSlots }).map((_, i) => {
              const pick = myPicks[i];
              const p = pick ? Object.values(state.players).find(pl => pl.discord_id === pick.player_id || pl.gamertag === pick.player) : null;
              return (
                <div 
                  key={i} 
                  className={`w-[calc(20%-0.5rem)] aspect-square rounded-full border-2 flex items-center justify-center text-xs font-mono transition-colors
                    ${p ? 'border-primary bg-primary/10 text-primary font-bold shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'border-border border-dashed text-muted-foreground/30'}
                  `}
                  title={p?.gamertag || p?.discord_id || `Slot ${i + 1}`}
                >
                  {p ? (p.gamertag?.[0] || '?') : `${i+1}`}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

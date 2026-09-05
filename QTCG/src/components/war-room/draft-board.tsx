import { useState } from 'react';
import { useDraftState, useDraftAction } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Search, Trophy, Pin, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function DraftBoard() {
  const { data: state } = useDraftState();
  const doAction = useDraftAction();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!state) return null;

  const playersList = Object.values(state.players);

  const available = playersList
    .filter(p => !p.drafted_by)
    .filter(p => 
      (p.gamertag || '').toLowerCase().includes(search.toLowerCase()) || 
      (p.school || p.college || '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
       const aRank = a.rank_score ?? a.overall ?? a.rating ?? 0;
       const bRank = b.rank_score ?? b.overall ?? b.rating ?? 0;
       return bRank - aRank; // Descending if overall
    });

  const myTeam = state.my_team;
  const isAdmin = state.access === 'admin';
  const currentTurn = state.order[state.current_pick];
  const isOnClock = currentTurn && state.status === 'active' && (isAdmin || myTeam === currentTurn.team);

  const handleDraft = () => {
    if (!selectedId || !isOnClock || doAction.isPending) return;
    
    doAction.mutate({
      action: 'pick',
      player_id: selectedId
    }, {
      onSuccess: () => {
        setSelectedId(null);
        toast({ title: 'Pick Locked In!', description: 'Your selection has been registered.' });
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    });
  };

  const handlePin = (playerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const board = JSON.parse(localStorage.getItem('qspn_local_board') || '[]');
      if (!board.includes(playerId)) {
        const newBoard = [...board, playerId];
        localStorage.setItem('qspn_local_board', JSON.stringify(newBoard));
        toast({ title: 'Added to Big Board', duration: 2000 });
        if (myTeam) {
           const notes = localStorage.getItem('qspn_local_notes') || '';
           doAction.mutate({ action: 'strategy', team: myTeam, notes, targets: newBoard });
        }
      }
    } catch (e) {
      console.log(e);
    }
  };

  const selectedProspect = playersList.find(p => p.discord_id === selectedId || p.gamertag === selectedId);

  return (
    <div className="flex flex-col h-full bg-background relative p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl md:text-2xl font-bold uppercase tracking-widest text-foreground font-mono">Available Players</h2>
        <div className="relative w-64 md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input 
            className="pl-9 bg-card border-border h-10 font-mono text-sm focus-visible:ring-primary" 
            placeholder="Search prospects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        <ScrollArea className="flex-1 h-full pr-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-32">
            {available.map((p, i) => {
              const pid = p.discord_id || p.gamertag;
              return (
                <div 
                  key={pid}
                  onClick={() => setSelectedId(pid)}
                  className={`bg-card rounded-lg border-2 p-5 cursor-pointer transition-all duration-200 hover:-translate-y-1 relative group
                    ${selectedId === pid 
                      ? 'border-primary shadow-[0_10px_30px_rgba(212,175,55,0.15)] bg-card/90'
                      : 'border-border hover:border-border/80 hover:shadow-lg'}
                  `}
                >
                  <button 
                    onClick={(e) => handlePin(pid, e)}
                    className="absolute top-3 right-3 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-secondary transition-all"
                  >
                    <Pin size={16} />
                  </button>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex flex-col">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Rank</div>
                      <div className="text-xl font-mono font-bold">{(i+1).toString().padStart(2, '0')}</div>
                    </div>
                    <div className="text-xs font-mono font-bold px-3 py-1.5 rounded bg-secondary/10 text-secondary border border-secondary/20">
                      {p.overall || p.rank_score || p.rating || '--'} OVR
                    </div>
                  </div>
                  
                  <div className="font-bold text-xl mb-1 truncate tracking-tight">{p.gamertag || 'Unknown'}</div>
                  <div className="text-sm font-mono text-muted-foreground mb-5 uppercase">
                    {p.position} • {p.school || p.college || 'N/A'}
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    {[p.archetype].filter(Boolean).map((t, idx) => (
                      <span key={idx} className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded bg-background text-foreground/80 border border-border">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {selectedId && selectedProspect && (
        <div className="absolute bottom-8 left-8 right-8 bg-card/95 backdrop-blur-xl border border-primary/50 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-5 flex items-center justify-between animate-in slide-in-from-bottom-8">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-primary/20 rounded-full flex items-center justify-center text-primary shadow-[0_0_15px_rgba(212,175,55,0.3)]">
              <Trophy size={28} />
            </div>
            <div>
              <div className="text-xs font-mono text-primary uppercase tracking-widest mb-1">Make The Call</div>
              <div className="text-3xl font-black tracking-tight">{selectedProspect.gamertag}</div>
            </div>
          </div>
          
          <Button 
            size="lg" 
            className={`h-16 px-16 text-xl font-bold uppercase tracking-widest transition-all ${!isOnClock ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(212,175,55,0.4)]'}`}
            disabled={!isOnClock || doAction.isPending}
            onClick={handleDraft}
          >
            {doAction.isPending ? <Loader2 className="animate-spin" /> : 'Lock Pick'}
          </Button>
          {!isOnClock && (
            <div className="absolute -top-3 right-10 bg-destructive text-destructive-foreground text-[10px] px-2 py-1 rounded font-mono font-bold tracking-widest uppercase">
              Not Your Turn
            </div>
          )}
        </div>
      )}
    </div>
  );
}

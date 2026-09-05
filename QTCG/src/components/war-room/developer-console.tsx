import { useDraftState, useDraftAction } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, Server, Database, Wifi, Pause, Play, FastForward, Undo, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function DeveloperConsole() {
  const { data: state, dataUpdatedAt } = useDraftState();
  const doAction = useDraftAction();
  const { toast } = useToast();
  
  if (!state) return null;

  const handleAdmin = (action: string, extra = {}) => {
    doAction.mutate({ action, ...extra }, {
      onSuccess: () => toast({ title: `Executed: ${action}` }),
      onError: (err) => toast({ title: 'Error', description: err.message, variant: 'destructive' })
    });
  };

  const handleExport = async () => {
    const session = localStorage.getItem('qcl-session');
    try {
      const res = await fetch(`/api/draft/players?session=${encodeURIComponent(session || '')}`);
      if (!res.ok) {
         throw new Error("Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qspn_draft_players.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0C10] p-8 font-mono">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-border">
        <h2 className="text-xl font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-3">
          <Server className="text-primary" size={20} /> Master Control
        </h2>
        <div className="flex items-center gap-3 text-secondary text-sm font-bold animate-pulse">
          <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,210,185,0.8)]" />
          SYSTEM NOMINAL
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
            Presence <Activity size={14}/>
          </div>
          <div className="text-4xl font-bold text-foreground tracking-tighter">
            {state.teams.length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">Active Franchises</div>
        </div>
        
        <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
            Data Pool <Database size={14}/>
          </div>
          <div className="text-4xl font-bold text-foreground tracking-tighter">
            {Object.values(state.players).filter(p => !p.drafted_by).length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">Available Players</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
            Sync Time <Wifi size={14}/>
          </div>
          <div className="text-xl font-bold text-secondary tracking-tighter truncate">
            {new Date(dataUpdatedAt).toLocaleTimeString()}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">Last Polled</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center justify-between">
            Draft State
          </div>
          <div className="text-4xl font-bold text-primary tracking-tighter">
            {state.picks.length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">Total Picks Made</div>
        </div>
      </div>

      {state.access === 'admin' && (
        <div className="flex gap-4 mb-8 bg-card border border-border p-4 rounded-xl">
          <Button variant="outline" className="flex-1 border-primary/50 hover:bg-primary/20" onClick={() => handleAdmin('pause')} disabled={doAction.isPending}>
            {state.status === 'paused' ? <><Play className="mr-2" size={16}/> Resume Clock</> : <><Pause className="mr-2" size={16}/> Pause Clock</>}
          </Button>
          <Button variant="outline" className="flex-1 border-secondary/50 hover:bg-secondary/20" onClick={() => handleAdmin('advance')} disabled={doAction.isPending}>
            <FastForward className="mr-2" size={16}/> Force Advance
          </Button>
          <Button variant="outline" className="flex-1 border-destructive/50 hover:bg-destructive/20" onClick={() => handleAdmin('undo')} disabled={doAction.isPending}>
            <Undo className="mr-2" size={16}/> Undo Last Pick
          </Button>
          <Button variant="outline" className="flex-1 border-border hover:bg-white/10" onClick={handleExport}>
            <Download className="mr-2" size={16}/> Export Players JSON
          </Button>
        </div>
      )}

      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Event Log</h3>
      <ScrollArea className="flex-1 bg-black border border-border rounded-xl p-6 shadow-inner">
        <div className="flex flex-col gap-3 text-xs leading-relaxed">
          {[...state.audit_log].reverse().map((log, i) => (
            <div key={i} className="flex gap-6 border-b border-border/40 pb-3 hover:bg-white/5 p-1 -mx-1 rounded transition-colors">
              <span className="text-muted-foreground w-24 shrink-0 font-mono opacity-60">
                {new Date(log.at * 1000).toLocaleTimeString()}
              </span>
              <span className="text-secondary shrink-0 font-bold tracking-widest uppercase">[{log.action}]</span>
              <span className="text-foreground">
                {JSON.stringify(log.details)}
              </span>
            </div>
          ))}
          <div className="flex gap-6 border-b border-border/40 pb-3 opacity-50 p-1 -mx-1">
            <span className="text-primary shrink-0 font-bold tracking-widest">[SYS_INIT]</span>
            <span className="text-foreground">
              Draft instance loaded. Revision: {state.revision}
            </span>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

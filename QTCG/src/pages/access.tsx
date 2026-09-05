import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useDraftState } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { MonitorPlay } from 'lucide-react';

export default function AccessScreen() {
  const [, setLocation] = useLocation();
  const { data: state, error, isLoading } = useDraftState();
  const hasSession = !!localStorage.getItem('qcl-session');

  const handleEnterWarRoom = () => {
    setLocation('/war-room');
  };

  const handleEnterDirector = () => {
    setLocation('/director');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full border border-border bg-card p-10 rounded-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-primary" />
        <h1 className="text-5xl font-black font-sans text-primary mb-1 tracking-tighter">QTCG</h1>
        <h2 className="text-xl text-foreground font-mono mb-10 opacity-60 uppercase tracking-widest">Draft War Room</h2>
        
        <div className="space-y-6">
          {!hasSession ? (
            <div className="space-y-4 text-center">
              <p className="text-muted-foreground font-mono text-sm">Please log in via the QTCG Hub to access the draft board.</p>
              <Button 
                className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all uppercase tracking-widest"
                onClick={() => window.location.href = '/'}
              >
                Return to QTCG
              </Button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground font-mono uppercase animate-pulse">
              Authenticating...
            </div>
          ) : error ? (
            <div className="space-y-4 text-center">
              <p className="text-destructive font-mono text-sm">Session expired or unauthorized.</p>
              <Button 
                className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all uppercase tracking-widest"
                onClick={() => { window.location.href = '/'; }}
              >
                Return to QTCG
              </Button>
            </div>
          ) : (
            <>
              <div className="bg-background border border-border p-4 rounded-lg flex flex-col gap-1 items-center">
                <div className="text-xs font-mono uppercase text-muted-foreground tracking-widest">Logged in as</div>
                <div className="text-lg font-bold text-foreground capitalize">{state?.my_team ? `Coach of ${state.my_team}` : state?.access === 'admin' ? 'Commissioner' : 'Spectator'}</div>
              </div>
              <Button 
                className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all uppercase tracking-widest"
                onClick={handleEnterWarRoom}
              >
                Enter War Room
              </Button>

              <div className="pt-6 border-t border-border/50 mt-8">
                <Button 
                  variant="outline"
                  className="w-full h-14 text-secondary hover:text-secondary-foreground hover:bg-secondary border-secondary/20 transition-all font-mono uppercase tracking-widest flex items-center gap-3"
                  onClick={handleEnterDirector}
                >
                  <MonitorPlay size={18} />
                  Director Mode
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

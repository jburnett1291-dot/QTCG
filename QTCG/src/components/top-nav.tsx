import { Link, useLocation } from 'wouter';
import { useDraftState } from '@/lib/api';
import { Lock, Settings, LayoutDashboard, TestTube, Activity } from 'lucide-react';
import logo from '@assets/Logo_2_1788594844031.png';

export function TopNav() {
  const [location] = useLocation();
  const { data: state, isLoading } = useDraftState();
  
  const isAdmin = state?.access === 'admin';

  return (
    <div className="h-12 bg-background border-b border-border flex items-center px-4 justify-between shrink-0 font-mono text-xs uppercase tracking-widest relative z-50 shadow-md">
      <div className="flex items-center gap-6 h-full">
        {/* Brand Mark */}
        <div className="flex items-center gap-3 pr-4 border-r border-border h-full opacity-90 hover:opacity-100 transition-opacity">
          <img src={logo} alt="QCL Logo" className="w-8 h-8 object-contain drop-shadow-md" />
          <span className="font-bold text-primary tracking-tighter">Command Center</span>
        </div>
        
        {/* Navigation Links */}
        <div className="flex items-center h-full">
          <a href="/" className="flex items-center gap-2 h-full px-4 text-muted-foreground hover:text-primary hover:bg-muted/50 transition-colors border-r border-border">
            <Activity size={14} />
            QTCG
          </a>
          
          <Link href="/war-room" className={`flex items-center gap-2 h-full px-4 transition-colors border-r border-border ${location.startsWith('/war-room') || location === '/coach' ? 'text-primary bg-primary/10 border-b-2 border-b-primary font-bold' : 'text-muted-foreground hover:text-primary hover:bg-muted/50'}`}>
            <LayoutDashboard size={14} />
            War Room
          </Link>

          {isLoading ? (
            <div className="flex items-center gap-2 h-full px-4 text-muted-foreground/40 border-r border-border">
              <span className="animate-pulse">Loading...</span>
            </div>
          ) : isAdmin ? (
            <Link href="/director" className={`flex items-center gap-2 h-full px-4 transition-colors border-r border-border ${location === '/director' ? 'text-primary bg-primary/10 border-b-2 border-b-primary font-bold' : 'text-muted-foreground hover:text-primary hover:bg-muted/50'}`}>
              <Settings size={14} />
              Dev Mode
            </Link>
          ) : (
            <div className="flex items-center gap-2 h-full px-4 text-muted-foreground/40 cursor-not-allowed border-r border-border" title="Locked: Administrator Access Required">
              <Lock size={14} className="opacity-50" />
              Dev Mode
            </div>
          )}

          {isAdmin ? (
            <a href="/draft?mode=test" className="flex items-center gap-2 h-full px-4 text-muted-foreground hover:text-primary hover:bg-muted/50 transition-colors">
              <TestTube size={14} />
              Test Mode
            </a>
          ) : (
            <div className="flex items-center gap-2 h-full px-4 text-muted-foreground/40 cursor-not-allowed" title="Locked: Administrator Access Required">
              <Lock size={14} className="opacity-50" />
              Test Mode
            </div>
          )}
        </div>
      </div>
      
      {state && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground/60 hidden sm:inline">Status:</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${state.status === 'live' ? 'bg-green-500/20 text-green-500 border border-green-500/30' : state.status === 'paused' ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' : 'bg-primary/20 text-primary border border-primary/30'}`}>
            {state.status}
          </span>
        </div>
      )}
    </div>
  );
}

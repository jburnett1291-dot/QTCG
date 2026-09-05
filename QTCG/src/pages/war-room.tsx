import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useDraftState } from '@/lib/api';
import Sidebar from '@/components/war-room/sidebar';
import Header from '@/components/war-room/header';
import DraftBoard from '@/components/war-room/draft-board';
import DirectorDeck from '@/components/war-room/director-deck';
import DeveloperConsole from '@/components/war-room/developer-console';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Code2, MonitorPlay, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function WarRoomLayout({ forceMode }: { forceMode?: 'coach' | 'director' }) {
  const { data: state, isLoading, error } = useDraftState();
  const [, setLocation] = useLocation();
  
  const defaultMode = forceMode || (state?.access === 'admin' ? 'developer' : 'coach');
  const [mode, setMode] = useState<'coach' | 'director' | 'developer'>(defaultMode);

  useEffect(() => {
    if (forceMode) setMode(forceMode);
  }, [forceMode]);

  if (isLoading) {
    return <div className="h-full w-full bg-background text-foreground flex items-center justify-center font-mono animate-pulse uppercase tracking-widest">Loading War Room...</div>;
  }

  if (error || !state) {
    return (
      <div className="h-full w-full bg-background text-foreground flex flex-col items-center justify-center font-mono gap-4">
        <div className="text-destructive">CONNECTION LOST</div>
        <Button onClick={() => setLocation('/')}>Return to Access</Button>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={25} minSize={20} maxSize={35} className="flex flex-col border-r border-border h-full">
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle className="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize hidden md:flex" />
        <ResizablePanel defaultSize={75} className="flex flex-col relative bg-background h-full">
          <Header />
          
          {/* Main Area */}
          <div className="flex-1 overflow-hidden relative">
            {mode === 'coach' && <DraftBoard />}
            {mode === 'director' && <DirectorDeck />}
            {mode === 'developer' && <DeveloperConsole />}
          </div>

          {/* Mode Switcher */}
          {!forceMode && state?.access === 'admin' && (
            <div className="absolute top-3 right-4 z-50 flex items-center gap-1 bg-card/80 backdrop-blur-md border border-border p-1 rounded-lg shadow-lg">
              <button
                onClick={() => setMode('coach')}
                className={cn("px-4 py-2 rounded-md text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 transition-colors", mode === 'coach' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Users size={14} /> Board
              </button>
              <button
                onClick={() => setMode('director')}
                className={cn("px-4 py-2 rounded-md text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 transition-colors", mode === 'director' ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <MonitorPlay size={14} /> Director
              </button>
              <button
                onClick={() => setMode('developer')}
                className={cn("px-4 py-2 rounded-md text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 transition-colors", mode === 'developer' ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Code2 size={14} /> Dev
              </button>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

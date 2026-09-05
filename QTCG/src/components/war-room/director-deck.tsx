import { useState } from 'react';
import { useDraftState, useDraftAction } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Play, Tv, Eye, Layers, XSquare } from 'lucide-react';

export default function DirectorDeck() {
  const { data: state } = useDraftState();
  const doAction = useDraftAction();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  
  if (!state) return null;

  const topAvailable = Object.values(state.players)
    .filter(p => !p.drafted_by)
    .sort((a,b) => {
       const aRank = a.rank_score ?? a.overall ?? a.rating ?? 0;
       const bRank = b.rank_score ?? b.overall ?? b.rating ?? 0;
       return bRank - aRank;
    })
    .slice(0, 8);

  const previewProspect = previewId ? Object.values(state.players).find(p => p.discord_id === previewId || p.gamertag === previewId) : null;
  const livePromo = state.promo;
  const liveProspect = livePromo ? Object.values(state.players).find(p => p.gamertag === livePromo.player) : null;

  const handleClearPromo = () => {
    doAction.mutate({ action: 'clear_promo' });
  };

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="grid grid-cols-2 gap-6 h-[50%] shrink-0">
        <div className="flex flex-col border border-border rounded-xl bg-card overflow-hidden relative shadow-lg">
          <div className="bg-background px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-secondary font-bold font-mono text-sm tracking-widest uppercase">
              <Eye size={16} /> Preview Monitor
            </div>
            {previewProspect && (
              <div className="font-mono text-xs text-muted-foreground">{previewProspect.gamertag} • Ready</div>
            )}
          </div>
          <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
            {previewProspect ? (
              <div className="text-center">
                {previewProspect.media_url || previewProspect.hype_video_url ? (
                  <video src={previewProspect.media_url || previewProspect.hype_video_url} className="absolute inset-0 w-full h-full object-cover opacity-50" autoPlay loop muted playsInline />
                ) : (
                  <div className="text-center animate-pulse z-10 relative">
                    <Play size={64} className="text-secondary/40 mx-auto mb-4" />
                    <div className="font-mono text-sm text-secondary/60 uppercase tracking-widest">No Video Source</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="font-mono text-muted-foreground/30 uppercase tracking-widest flex flex-col items-center gap-4">
                <Play size={48} />
                Idle
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col border-2 border-primary/40 rounded-xl bg-card overflow-hidden relative shadow-[0_0_30px_rgba(212,175,55,0.15)]">
          <div className="bg-primary/10 px-4 py-3 border-b border-primary/20 flex items-center justify-between shrink-0 z-20">
            <div className="flex items-center gap-2 text-primary font-bold font-mono text-sm tracking-widest uppercase animate-pulse">
              <Tv size={16} /> Program Out
            </div>
            {livePromo && (
              <div className="font-mono text-xs text-primary/80 font-bold">{livePromo.team} Pick</div>
            )}
          </div>
          <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
            {livePromo ? (
              <>
                {livePromo.media_url || liveProspect?.hype_video_url ? (
                  <video src={livePromo.media_url || liveProspect?.hype_video_url} className="absolute inset-0 w-full h-full object-cover" autoPlay loop playsInline />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-black bg-cover bg-center" />
                )}
                
                <div className="relative z-10 text-center animate-in zoom-in-95 duration-500 bg-black/60 p-8 rounded-2xl backdrop-blur-md border border-white/10">
                   <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter drop-shadow-2xl">{livePromo.player}</h2>
                   <div className="text-primary font-mono font-bold mt-4 text-2xl drop-shadow-lg tracking-widest">HIGHLIGHT REEL</div>
                </div>

                {livePromo.entrance_audio_url && (
                   <audio src={livePromo.entrance_audio_url} autoPlay />
                )}
              </>
            ) : (
              <div className="font-mono text-muted-foreground/30 uppercase tracking-widest">Black</div>
            )}

            {activeOverlay === 'stats' && liveProspect && (
              <div className="absolute bottom-8 left-8 right-8 bg-card/90 backdrop-blur-md border border-border p-5 rounded-lg flex justify-around animate-in slide-in-from-bottom-4 shadow-2xl z-20">
                <div className="text-center">
                  <div className="text-xs text-secondary font-mono uppercase tracking-widest mb-1">Position</div>
                  <div className="text-4xl font-bold text-white tracking-tighter">{liveProspect.position}</div>
                </div>
                <div className="w-px h-full bg-border" />
                <div className="text-center">
                  <div className="text-xs text-secondary font-mono uppercase tracking-widest mb-1">Overall</div>
                  <div className="text-4xl font-bold text-white tracking-tighter">{liveProspect.overall || liveProspect.rank_score || '--'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-6 min-h-0">
        <div className="flex-1 flex flex-col bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground mb-4">Media Bin <span className="opacity-50 text-xs normal-case">(Top Available)</span></h3>
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
              {topAvailable.map(p => {
                const pid = p.discord_id || p.gamertag;
                return (
                  <div 
                    key={pid}
                    onClick={() => setPreviewId(pid)}
                    className={`aspect-video rounded-md bg-background border relative cursor-pointer group overflow-hidden transition-all
                      ${previewId === pid ? 'border-primary shadow-[0_0_15px_rgba(212,175,55,0.3)] scale-[1.02]' : 'border-border hover:border-primary/50'}
                    `}
                  >
                    {p.media_url || p.hype_video_url ? (
                      <video src={p.media_url || p.hype_video_url} className="absolute inset-0 w-full h-full object-cover opacity-30" muted />
                    ) : null}
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/20 group-hover:text-secondary/50 transition-colors">
                      <Play size={28} />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm p-2 border-t border-white/10">
                      <div className="text-[10px] font-bold text-white truncate">{p.gamertag || 'Unknown'}</div>
                      <div className="text-[9px] font-mono text-secondary uppercase mt-0.5">{p.position} • {p.school || p.college || 'N/A'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="w-72 flex flex-col gap-4">
          <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
            <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <Layers size={14} /> Local Overlays
            </h3>
            <Button 
              variant={activeOverlay === 'stats' ? 'default' : 'outline'}
              className={`w-full justify-start font-mono text-xs h-10 ${activeOverlay === 'stats' ? 'bg-secondary text-secondary-foreground hover:bg-secondary/90 border-transparent' : 'bg-background hover:bg-accent/10 border-border'}`}
              onClick={() => setActiveOverlay(activeOverlay === 'stats' ? null : 'stats')}
            >
              [F1] Player Stats
            </Button>
          </div>
          
          <div className="mt-auto space-y-3">
            <Button 
              className="w-full h-16 text-lg font-black font-mono uppercase tracking-widest bg-destructive hover:bg-destructive/90 text-white shadow-[0_0_30px_rgba(255,0,0,0.2)] transition-all active:scale-95 disabled:opacity-50"
              onClick={handleClearPromo}
              disabled={!livePromo || doAction.isPending}
            >
              <XSquare className="mr-2" size={20} /> Clear Promo
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

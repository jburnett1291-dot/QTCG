import { useEffect, useRef, useState } from "react";
import { useDraftStatePoller } from "@/hooks/use-draft-state";

export default function DirectorPage() {
  const { state, isOffline } = useDraftStatePoller();
  const [takeover, setTakeover] = useState<{ pick: any, prospect: any, team: any } | null>(null);
  
  // Track previous picks to detect new ones
  const lastPickCount = useRef<number | null>(null);

  useEffect(() => {
    if (!state) return;

    if (lastPickCount.current === null) {
      lastPickCount.current = state.picks.length;
      return;
    }

    if (state.picks.length > lastPickCount.current) {
      if (state.director.enabled && state.director.autoShow) {
        // Show the latest pick
        const latestPick = state.picks[state.picks.length - 1];
        const prospect = state.prospects.find(p => p.id === latestPick.prospectId);
        const team = state.teams.find(t => t.id === latestPick.teamId);
        
        if (prospect && team) {
          setTakeover({ pick: latestPick, prospect, team });
          
          setTimeout(() => {
            setTakeover(null);
          }, state.director.durationSeconds * 1000);
        }
      }
    }
    lastPickCount.current = state.picks.length;
  }, [state?.picks, state?.director.autoShow, state?.director.durationSeconds, state?.prospects, state?.teams]);

  if (!state) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-white text-4xl font-bold font-sans tracking-widest uppercase animate-pulse">
          Standing By...
        </div>
      </div>
    );
  }

  // Generate main board data
  // We'll show the top 12 available prospects
  const topAvailable = [...state.prospects]
    .filter(p => p.status === 'available')
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 12);

  const recentPicks = [...state.picks].reverse().slice(0, 5);

  return (
    <div className="h-screen w-screen bg-[#0a0f1a] overflow-hidden text-white font-sans relative">
      {/* Header */}
      <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between px-12 z-10 border-b border-white/10">
        <div className="flex items-center gap-6">
          <div className="text-primary font-bold text-5xl tracking-tighter">QSPN</div>
          <div className="h-8 w-px bg-white/20"></div>
          <div className="text-2xl font-semibold tracking-widest text-white/90 uppercase">{state.eventName}</div>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="text-sm text-white/50 tracking-widest uppercase">Current Round</div>
            <div className="text-4xl font-bold text-accent">{state.currentRound}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-white/50 tracking-widest uppercase">Current Pick</div>
            <div className="text-4xl font-bold text-accent">{state.currentPick}</div>
          </div>
        </div>
      </div>

      {/* Main Board */}
      <div className="absolute inset-0 pt-32 px-12 pb-12 flex gap-8">
        {/* Left: Top Available */}
        <div className="flex-1 flex flex-col">
          <h2 className="text-xl font-bold text-white/80 uppercase tracking-widest mb-6 border-b border-white/20 pb-2">
            Top Available Prospects
          </h2>
          <div className="grid grid-cols-2 gap-4 flex-1 content-start">
            {topAvailable.map((prospect, i) => (
              <div key={prospect.id} className="bg-white/5 border border-white/10 rounded overflow-hidden flex items-stretch">
                <div className="w-12 bg-white/10 flex items-center justify-center font-mono font-bold text-xl text-white/50">
                  {i + 1}
                </div>
                <div className="flex-1 p-3">
                  <div className="font-bold text-xl leading-none mb-1">{prospect.name}</div>
                  <div className="text-sm text-white/60 font-mono">
                    {prospect.position} • {prospect.school} • Grade: {prospect.grade}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Recent Picks */}
        <div className="w-[450px] flex flex-col">
          <h2 className="text-xl font-bold text-white/80 uppercase tracking-widest mb-6 border-b border-white/20 pb-2">
            Recent Selections
          </h2>
          <div className="flex flex-col gap-4">
            {recentPicks.length === 0 ? (
              <div className="text-white/40 italic">No picks made yet.</div>
            ) : (
              recentPicks.map(pick => {
                const prospect = state.prospects.find(p => p.id === pick.prospectId);
                const team = state.teams.find(t => t.id === pick.teamId);
                if (!prospect || !team) return null;
                return (
                  <div key={pick.id} className="bg-white/5 border border-white/10 rounded flex relative overflow-hidden">
                    <div 
                      className="absolute inset-0 opacity-10" 
                      style={{ backgroundColor: team.color }}
                    />
                    <div 
                      className="w-16 flex flex-col items-center justify-center font-bold relative z-10"
                      style={{ backgroundColor: team.color }}
                    >
                      <span className="text-sm opacity-80">R{pick.round}</span>
                      <span className="text-2xl leading-none">P{pick.pick}</span>
                    </div>
                    <div className="p-4 flex-1 relative z-10">
                      <div className="text-accent text-sm font-bold tracking-widest mb-1">
                        {team.city} {team.name}
                      </div>
                      <div className="font-bold text-xl">{prospect.name}</div>
                      <div className="text-sm text-white/60 font-mono">
                        {prospect.position} • {prospect.school}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Takeover Animation */}
      {takeover && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 animate-in fade-in zoom-in duration-500">
          <div className="absolute inset-0 opacity-20" style={{ backgroundColor: takeover.team.color }}>
            {/* Background Texture could go here */}
          </div>
          
          <div className="relative z-10 max-w-5xl w-full p-12 text-center">
            <div className="mb-8 animate-in slide-in-from-bottom-10 fade-in delay-100 duration-700">
              <div className="inline-block px-6 py-2 rounded-full border-2 text-xl font-bold tracking-widest uppercase mb-4 shadow-lg shadow-black/50"
                   style={{ borderColor: takeover.team.color, backgroundColor: 'black', color: takeover.team.color }}>
                With Pick {takeover.pick.overall} (Round {takeover.pick.round})
              </div>
              <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tight mb-2 text-white">
                The {takeover.team.city} {takeover.team.name}
              </h1>
              <h2 className="text-2xl text-white/70 tracking-widest uppercase">Select</h2>
            </div>
            
            <div className="py-12 animate-in slide-in-from-bottom-10 fade-in delay-300 duration-700">
              <div className="text-7xl md:text-9xl font-black text-accent uppercase tracking-tighter leading-none mb-6 drop-shadow-2xl">
                {takeover.prospect.name}
              </div>
              <div className="flex items-center justify-center gap-6 text-3xl font-mono text-white/90">
                <span className="bg-primary px-4 py-1 rounded">{takeover.prospect.position}</span>
                <span>{takeover.prospect.school}</span>
              </div>
            </div>

            <div className="flex justify-center gap-4 mt-8 animate-in slide-in-from-bottom-10 fade-in delay-500 duration-700">
              {takeover.prospect.traits.map((trait: string, i: number) => (
                <div key={i} className="px-4 py-2 border border-white/20 rounded-full text-white/80 font-bold uppercase tracking-wider text-sm bg-white/5">
                  {trait}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import * as React from "react"
import { useDraftStatePoller } from "@/hooks/use-draft-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Activity, Radio, Download, Upload, Plus, Edit2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { getExportDraftJsonQueryKey, useExportDraftJson } from "@workspace/api-client-react"

export default function WarRoomPage() {
  const { state, updateState, isOffline, isSaving } = useDraftStatePoller();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const exportQuery = useExportDraftJson({
    query: {
      queryKey: getExportDraftJsonQueryKey(),
      enabled: false,
    },
  });

  // Local component states
  const [activeProspectTab, setActiveProspectTab] = React.useState("available");
  const [prospectSearch, setProspectSearch] = React.useState("");
  
  // Pick Submission
  const [selectedProspectId, setSelectedProspectId] = React.useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = React.useState<string>("");

  // Quick activity
  const [botMessage, setBotMessage] = React.useState("");

  if (!state) {
    return <div className="min-h-screen flex items-center justify-center text-secondary font-bold">LOADING PROTOCOLS...</div>;
  }

  const handlePickSubmit = () => {
    if (!selectedProspectId || !selectedTeamId) return;

    updateState((prev) => {
      const prospect = prev.prospects.find(p => p.id === selectedProspectId);
      const team = prev.teams.find(t => t.id === selectedTeamId);
      
      if (!prospect || !team) return prev;

      const newPick = {
        id: crypto.randomUUID(),
        round: prev.currentRound,
        pick: prev.currentPick,
        overall: ((prev.currentRound - 1) * prev.teams.length) + prev.currentPick,
        teamId: team.id,
        prospectId: prospect.id,
        selectedAt: new Date().toISOString()
      };

      let nextPick = prev.currentPick + 1;
      let nextRound = prev.currentRound;
      if (nextPick > prev.teams.length) {
        nextPick = 1;
        nextRound += 1;
      }

      return {
        ...prev,
        currentPick: nextPick,
        currentRound: nextRound,
        picks: [...prev.picks, newPick],
        prospects: prev.prospects.map(p => 
          p.id === selectedProspectId ? { ...p, status: 'drafted' } : p
        ),
        activity: [{
          id: crypto.randomUUID(),
          type: 'pick' as const,
          message: `${team.city} selects ${prospect.name} (${prospect.position}, ${prospect.school})`,
          source: 'commish',
          createdAt: new Date().toISOString()
        }, ...prev.activity].slice(0, 50)
      };
    });

    setSelectedProspectId("");
    setSelectedTeamId("");
  };

  const handleBotSubmit = () => {
    if (!botMessage.trim()) return;
    updateState((prev) => ({
      ...prev,
      activity: [{
        id: crypto.randomUUID(),
        type: 'bot' as const,
        message: botMessage,
        source: 'qspn-insider',
        createdAt: new Date().toISOString()
      }, ...prev.activity].slice(0, 50)
    }));
    setBotMessage("");
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);
          updateState(() => parsed);
        } catch (err) {
          alert("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    }
  };

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    const exportState = result.data ?? state;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportState, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `qspn-draft-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const filteredProspects = state.prospects
    .filter(p => p.status === activeProspectTab)
    .filter(p => p.name.toLowerCase().includes(prospectSearch.toLowerCase()) || 
                 p.school.toLowerCase().includes(prospectSearch.toLowerCase()))
    .sort((a, b) => a.rank - b.rank);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground h-screen overflow-hidden">
      {/* Top Nav Bar */}
      <header className="h-14 bg-secondary text-secondary-foreground flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-black text-2xl tracking-tighter text-primary">QSPN</div>
          <div className="h-4 w-px bg-secondary-foreground/20" />
          <div className="font-bold tracking-widest uppercase text-sm">Draft War Room</div>
          <Badge variant="outline" className="ml-2 bg-secondary-foreground/10 border-transparent text-secondary-foreground/70">
            {state.eventName}
          </Badge>
        </div>
        
        <div className="flex items-center gap-4">
          {isOffline && (
            <div className="flex items-center gap-2 text-accent text-xs font-bold animate-pulse">
              <AlertCircle size={14} />
              LOCAL MODE
            </div>
          )}
          <div className="text-xs font-mono text-secondary-foreground/50">
            {isSaving ? 'SAVING...' : 'SYNCED'}
          </div>
          <Button variant="outline" size="sm" className="h-8 bg-transparent border-secondary-foreground/20 hover:bg-secondary-foreground/10 hover:text-white" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} className="mr-2" /> Import JSON
          </Button>
          <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
          <Button variant="outline" size="sm" className="h-8 bg-transparent border-secondary-foreground/20 hover:bg-secondary-foreground/10 hover:text-white" onClick={handleExport}>
            <Download size={14} className="mr-2" /> Export
          </Button>
          <Button variant="default" size="sm" className="h-8 font-bold" onClick={() => window.open('/director', '_blank')}>
            <Radio size={14} className="mr-2" /> Director View
          </Button>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="flex-1 p-4 grid grid-cols-12 gap-4 overflow-hidden h-[calc(100vh-3.5rem)]">
        
        {/* Left Column: Teams & Settings */}
        <div className="col-span-3 flex flex-col gap-4 overflow-hidden">
          <Card className="flex flex-col flex-1 overflow-hidden border-2">
            <CardHeader className="py-4 border-b bg-muted/50">
              <div className="flex items-center justify-between">
                <CardTitle>Teams</CardTitle>
                <AddTeamDialog updateState={updateState} />
              </div>
            </CardHeader>
            <ScrollArea className="flex-1">
              <div className="p-4 flex flex-col gap-2">
                {state.teams.map(team => (
                  <div key={team.id} className="flex items-center justify-between p-2 rounded border bg-card hover:bg-accent/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: team.color }} />
                      <div>
                        <div className="font-bold text-sm leading-none">{team.city} {team.name}</div>
                        <div className="text-xs text-muted-foreground font-mono mt-1">GM: {team.gm}</div>
                      </div>
                    </div>
                    <div className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                      {team.abbreviation}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>

          <Card className="border-2 border-primary/20 shrink-0">
            <CardHeader className="py-3 border-b bg-primary/5">
              <CardTitle className="text-sm">Director Settings</CardTitle>
            </CardHeader>
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-show" className="cursor-pointer">Auto-Show Picks</Label>
                <Switch 
                  id="auto-show" 
                  checked={state.director.autoShow}
                  onCheckedChange={(c) => updateState(p => ({ ...p, director: { ...p.director, autoShow: c } }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Highlight Duration (s)</Label>
                <Input 
                  type="number" 
                  min={3} max={60} 
                  value={state.director.durationSeconds}
                  onChange={(e) => updateState(p => ({ ...p, director: { ...p.director, durationSeconds: parseInt(e.target.value) || 10 } }))}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center Column: Prospects */}
        <Card className="col-span-5 flex flex-col overflow-hidden border-2 shadow-md">
          <CardHeader className="py-4 border-b bg-muted/50 pb-0 space-y-4">
            <div className="flex items-center justify-between">
              <CardTitle>Draft Board</CardTitle>
              <AddProspectDialog updateState={updateState} />
            </div>
            <Tabs value={activeProspectTab} onValueChange={setActiveProspectTab} className="w-full">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="available">Available</TabsTrigger>
                <TabsTrigger value="drafted">Drafted</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="pb-4">
              <Input 
                placeholder="Search prospects..." 
                value={prospectSearch}
                onChange={e => setProspectSearch(e.target.value)}
                className="bg-white"
              />
            </div>
          </CardHeader>
          <ScrollArea className="flex-1 bg-muted/20">
            <div className="p-4 flex flex-col gap-2">
              {filteredProspects.map(prospect => (
                <div key={prospect.id} className="flex items-center gap-3 p-3 rounded-md border bg-card hover:border-primary/50 transition-colors shadow-sm relative overflow-hidden group">
                  <div className="w-10 text-center shrink-0">
                    <div className="text-xs text-muted-foreground font-mono uppercase">Rank</div>
                    <div className="font-black text-lg text-secondary">{prospect.rank}</div>
                  </div>
                  <div className="w-px h-10 bg-border shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-lg leading-none truncate">{prospect.name}</div>
                      <Badge variant={prospect.status === 'drafted' ? 'drafted' : 'available'} className="shrink-0 text-[10px]">
                        {prospect.position}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground font-mono truncate mt-1 flex items-center gap-2">
                      <span>{prospect.school}</span>
                      <span>•</span>
                      <span>Grade: <span className="font-bold text-foreground">{prospect.grade}</span></span>
                    </div>
                  </div>
                  
                  {/* Hover Actions */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 bg-card pl-4">
                    <EditProspectDialog prospect={prospect} updateState={updateState} />
                  </div>
                </div>
              ))}
              {filteredProspects.length === 0 && (
                <div className="text-center py-12 text-muted-foreground font-mono text-sm uppercase">
                  No prospects found matching criteria
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Right Column: Submission & Activity */}
        <div className="col-span-4 flex flex-col gap-4 overflow-hidden">
          
          {/* Submit Pick */}
          <Card className="border-2 border-primary shrink-0 shadow-lg">
            <CardHeader className="py-4 border-b bg-primary text-primary-foreground">
              <CardTitle className="flex items-center justify-between text-primary-foreground">
                <span>Submit Pick</span>
                <span className="font-mono text-sm bg-black/20 px-2 py-1 rounded">
                  R{state.currentRound} P{state.currentPick}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>Team on the Clock</Label>
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger className="bg-white border-2">
                    <SelectValue placeholder="Select Team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {state.teams.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.city} {t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Selected Prospect</Label>
                <Select value={selectedProspectId} onValueChange={setSelectedProspectId}>
                  <SelectTrigger className="bg-white border-2">
                    <SelectValue placeholder="Select Prospect..." />
                  </SelectTrigger>
                  <SelectContent>
                    {state.prospects.filter(p => p.status === 'available').sort((a,b) => a.rank - b.rank).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.rank}. {p.name} - {p.position}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                className="w-full font-black text-lg py-6 shadow-md" 
                size="lg"
                disabled={!selectedTeamId || !selectedProspectId}
                onClick={handlePickSubmit}
              >
                LOCK IN PICK
              </Button>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="flex flex-col flex-1 overflow-hidden border-2">
            <CardHeader className="py-3 border-b bg-muted/50 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity size={16} /> Activity Feed
              </CardTitle>
            </CardHeader>
            <div className="p-3 border-b bg-card">
              <div className="flex gap-2">
                <Input 
                  placeholder="Bot announcement..." 
                  value={botMessage}
                  onChange={e => setBotMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBotSubmit()}
                  className="font-sans text-sm h-8"
                />
                <Button size="sm" className="h-8 px-3" onClick={handleBotSubmit}>Send</Button>
              </div>
            </div>
            <ScrollArea className="flex-1 bg-muted/10">
              <div className="p-3 flex flex-col gap-3">
                {state.activity.map(act => (
                  <div key={act.id} className="text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        {new Date(act.createdAt).toLocaleTimeString()}
                      </span>
                      <Badge variant={act.type === 'pick' ? 'default' : act.type === 'bot' ? 'secondary' : 'outline'} className="text-[9px] py-0 px-1">
                        {act.type}
                      </Badge>
                    </div>
                    <div className={cn(
                      "font-medium leading-tight",
                      act.type === 'pick' && "font-bold text-primary",
                      act.type === 'bot' && "text-secondary font-mono text-xs"
                    )}>
                      {act.message}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>

        </div>
      </div>
    </div>
  );
}

function AddProspectDialog({ updateState }: { updateState: any }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState({
    name: "", position: "QB", school: "", rank: 1, grade: 90.0, traits: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateState((prev: any) => ({
      ...prev,
      prospects: [...prev.prospects, {
        id: crypto.randomUUID(),
        name: data.name,
        position: data.position,
        school: data.school,
        rank: Number(data.rank),
        grade: Number(data.grade),
        traits: data.traits.split(',').map(s => s.trim()).filter(Boolean),
        status: 'available',
        highlightUrl: ''
      }].sort((a, b) => a.rank - b.rank)
    }));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="outline" className="h-6 w-6 rounded-full"><Plus size={12} /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Prospect</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={data.name} onChange={e => setData({...data, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>School</Label>
              <Input required value={data.school} onChange={e => setData({...data, school: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Select value={data.position} onValueChange={v => setData({...data, position: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['QB','RB','WR','TE','OT','G','C','DE','DT','LB','CB','S','K','P'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rank</Label>
              <Input type="number" required value={data.rank} onChange={e => setData({...data, rank: parseInt(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Grade</Label>
              <Input type="number" step="0.1" required value={data.grade} onChange={e => setData({...data, grade: parseFloat(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Traits (comma sep)</Label>
              <Input value={data.traits} onChange={e => setData({...data, traits: e.target.value})} />
            </div>
          </div>
          <Button type="submit" className="w-full">Save Prospect</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProspectDialog({ prospect, updateState }: { prospect: any, updateState: any }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState({
    name: prospect.name, 
    position: prospect.position, 
    school: prospect.school, 
    rank: prospect.rank, 
    grade: prospect.grade, 
    traits: prospect.traits.join(', '),
    status: prospect.status
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateState((prev: any) => ({
      ...prev,
      prospects: prev.prospects.map((p: any) => p.id === prospect.id ? {
        ...p,
        name: data.name,
        position: data.position,
        school: data.school,
        rank: Number(data.rank),
        grade: Number(data.grade),
        traits: data.traits.split(',').map((s: string) => s.trim()).filter(Boolean),
        status: data.status
      } : p).sort((a: any, b: any) => a.rank - b.rank)
    }));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8"><Edit2 size={14} /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Prospect</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={data.name} onChange={e => setData({...data, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>School</Label>
              <Input required value={data.school} onChange={e => setData({...data, school: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={data.status} onValueChange={v => setData({...data, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="drafted">Drafted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rank</Label>
              <Input type="number" required value={data.rank} onChange={e => setData({...data, rank: parseInt(e.target.value)})} />
            </div>
          </div>
          <Button type="submit" className="w-full">Update Prospect</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddTeamDialog({ updateState }: { updateState: any }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState({
    city: "", name: "", abbreviation: "", gm: "", color: "#000000"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateState((prev: any) => ({
      ...prev,
      teams: [...prev.teams, {
        id: crypto.randomUUID(),
        city: data.city,
        name: data.name,
        abbreviation: data.abbreviation.toUpperCase(),
        gm: data.gm,
        color: data.color
      }]
    }));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="outline" className="h-6 w-6 rounded-full"><Plus size={12} /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Team</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input required value={data.city} onChange={e => setData({...data, city: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={data.name} onChange={e => setData({...data, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Abbreviation</Label>
              <Input required maxLength={3} value={data.abbreviation} onChange={e => setData({...data, abbreviation: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>GM Name</Label>
              <Input required value={data.gm} onChange={e => setData({...data, gm: e.target.value})} />
            </div>
            <div className="space-y-2 col-span-2 flex items-center gap-4">
              <Label>Primary Color</Label>
              <Input type="color" required value={data.color} onChange={e => setData({...data, color: e.target.value})} className="w-16 h-10 p-1" />
            </div>
          </div>
          <Button type="submit" className="w-full">Save Team</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
(function () {
  const API_ORIGIN =
    location.hostname === "localhost" || location.hostname.endsWith(".replit.dev")
      ? ""
      : "https://qspn-draft-war-room.replit.app";
  const apiFetch = (path, options) => fetch(`${API_ORIGIN}${path}`, options);
  const session = () =>
    sessionStorage.getItem("qspn-admin-session") ||
    localStorage.getItem("qcl-session") ||
    "";
  let state = null;
  let running = false;
  let timer = null;
  let speedSeconds = 4;

  function normalizeState(raw) {
    if (!raw) return raw;
    if (Array.isArray(raw.prospects)) return raw;
    const prospects = Object.values(raw.players || {}).map((player) => ({
      id: String(player.discord_id || player.gamertag),
      name: player.gamertag || "Unknown",
      position: player.position || "—",
      school: player.school || player.college || "—",
      rank: Number(player.rank || 9999),
      grade: Number(player.overall || player.ovr || 0),
      status: player.drafted_by ? "drafted" : "available",
    }));
    const teams = (raw.teams || []).map((team, index) => ({
      id: String(team),
      city: "",
      name: String(team),
      abbreviation: String(team).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(),
      gm: raw.coaches?.[team] || `Test GM ${index + 1}`,
      color: `hsl(${(index * 47) % 360} 68% 52%)`,
    }));
    const picks = (raw.picks || []).map((pick, index) => ({
      id: pick.event_id || `pick-${pick.pick || index + 1}`,
      overall: Number(pick.pick || index + 1),
      round: Number(pick.round || Math.floor(index / Math.max(teams.length, 1)) + 1),
      pick: Number(pick.round_pick || index % Math.max(teams.length, 1) + 1),
      teamId: String(pick.team || ""),
      prospectId: String(pick.player_id || ""),
      selectedAt: new Date(Number(pick.timestamp || 0) * 1000).toISOString(),
    }));
    return { ...raw, prospects, teams, picks };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, handler) {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }

  function mountTab() {
    if (document.querySelector(".qspn-test-tab")) return;
    const anchor =
      document.querySelector(".qspn-director-tab") ||
      [...document.querySelectorAll("button, a")].find(
        (node) => node.textContent.trim().toUpperCase() === "WAR ROOM",
      );
    if (!anchor?.parentElement) return;
    const tab = button("TEST MODE", "qspn-test-tab is-locked", () => {
      if (state?.access !== "admin") {
        if (window.qspnRequestPinAccess) {
          window.qspnRequestPinAccess().then((unlocked) => {
            if (unlocked) {
              poll().then(() => {
                mountPanel();
                document.querySelector(".qspn-test-panel")?.classList.add("is-open");
              });
            }
          });
        }
        return;
      }
      mountPanel();
      document.querySelector(".qspn-test-panel")?.classList.add("is-open");
    });
    anchor.parentElement.appendChild(tab);
  }

  function updateTab() {
    const tab = document.querySelector(".qspn-test-tab");
    if (!tab) return;
    const authorized = state?.access === "admin";
    tab.classList.toggle("is-locked", !authorized);
    tab.classList.toggle("is-running", authorized && running);
    tab.textContent = running ? "TEST: RUNNING" : "TEST MODE";
    tab.title = authorized
      ? "Open the 300-player draft simulation"
      : "Locked — bot owner or approved draft admin access required.";
  }

  async function api(path, body) {
    const response = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, session: session() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Test Mode request failed");
    return result;
  }

  async function loadTestLeague() {
    pause();
    const result = await api("/api/draft/test/setup", {});
    state = { ...normalizeState(result.state), access: "admin", director_mode: true };
    render();
  }

  async function step() {
    const result = await api("/api/draft/test/step", {});
    state = { ...normalizeState(result.state), access: "admin", director_mode: true };
    render();
    if (result.complete) pause();
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(async () => {
      try {
        await step();
      } catch (error) {
        pause();
        alert(error.message);
        return;
      }
      schedule();
    }, speedSeconds * 1000);
  }

  function start() {
    if (!state?.prospects?.length) {
      loadTestLeague().then(start).catch((error) => alert(error.message));
      return;
    }
    running = true;
    updateTab();
    render();
    step().then(schedule).catch((error) => {
      pause();
      alert(error.message);
    });
  }

  function pause() {
    running = false;
    clearTimeout(timer);
    timer = null;
    updateTab();
    render();
  }

  function mountPanel() {
    if (document.querySelector(".qspn-test-panel")) return;
    const panel = el("section", "qspn-test-panel");
    panel.innerHTML = `
      <div class="qspn-test-shell">
        <header class="qspn-test-header">
          <div>
            <div class="qspn-test-eyebrow">QSPN BROADCAST LAB</div>
            <h1>Draft Test Mode</h1>
            <p>300 fictional prospects · 25 fictional GMs · live Director takeovers</p>
          </div>
          <button class="qspn-test-close" type="button" aria-label="Close Test Mode">CLOSE</button>
        </header>
        <div class="qspn-test-controls">
          <button data-action="load">LOAD / RESET 300</button>
          <button data-action="start" class="primary">START SIMULATION</button>
          <button data-action="pause">PAUSE</button>
          <button data-action="step">NEXT PICK</button>
          <label>
            <span>SPEED <strong data-speed-label>4s</strong></span>
            <input data-speed type="range" min="1" max="20" value="4">
          </label>
        </div>
        <div class="qspn-test-stats"></div>
        <div class="qspn-test-grid">
          <section><h2>Final Picks</h2><div class="qspn-test-picks"></div></section>
          <section><h2>Players Left</h2><div class="qspn-test-remaining"></div></section>
          <section><h2>25 Teams & GMs</h2><div class="qspn-test-teams"></div></section>
        </div>
      </div>`;
    panel.querySelector(".qspn-test-close").onclick = () => {
      panel.classList.remove("is-open");
    };
    panel.querySelector('[data-action="load"]').onclick = () =>
      loadTestLeague().catch((error) => alert(error.message));
    panel.querySelector('[data-action="start"]').onclick = start;
    panel.querySelector('[data-action="pause"]').onclick = pause;
    panel.querySelector('[data-action="step"]').onclick = () =>
      step().catch((error) => alert(error.message));
    const slider = panel.querySelector("[data-speed]");
    slider.addEventListener("input", () => {
      speedSeconds = Number(slider.value);
      panel.querySelector("[data-speed-label]").textContent = `${speedSeconds}s`;
      if (running) schedule();
    });
    document.body.appendChild(panel);
    render();
  }

  function render() {
    updateTab();
    const panel = document.querySelector(".qspn-test-panel");
    if (!panel) return;
    const prospects = state?.prospects || [];
    const picks = state?.picks || [];
    const teams = state?.teams || [];
    const remaining = prospects
      .filter((player) => player.status === "available")
      .sort((a, b) => a.rank - b.rank);
    const pct = prospects.length ? Math.round((picks.length / prospects.length) * 100) : 0;
    panel.querySelector(".qspn-test-stats").innerHTML = `
      <div><span>STATUS</span><strong>${running ? "RUNNING" : "PAUSED"}</strong></div>
      <div><span>PICKS COMPLETE</span><strong>${picks.length}</strong></div>
      <div><span>PLAYERS LEFT</span><strong>${remaining.length}</strong></div>
      <div><span>PROGRESS</span><strong>${pct}%</strong></div>`;
    panel.querySelector(".qspn-test-picks").innerHTML = [...picks]
      .reverse()
      .slice(0, 100)
      .map((pick) => {
        const player = prospects.find((item) => item.id === pick.prospectId);
        const team = teams.find((item) => item.id === pick.teamId);
        return `<article><b>#${pick.overall}</b><div><strong>${player?.name || "Unknown"}</strong><span>${team?.abbreviation || "—"} · ${player?.position || "—"} · ${player?.school || "—"}</span></div></article>`;
      })
      .join("") || '<div class="qspn-test-empty">Load the test league to begin.</div>';
    panel.querySelector(".qspn-test-remaining").innerHTML = remaining
      .slice(0, 100)
      .map((player) => `<article><b>${player.rank}</b><div><strong>${player.name}</strong><span>${player.position} · ${player.school} · ${player.grade}</span></div></article>`)
      .join("") || '<div class="qspn-test-empty">All 300 players have been selected.</div>';
    panel.querySelector(".qspn-test-teams").innerHTML = teams
      .map((team) => `<article><i style="background:${team.color}"></i><div><strong>${team.city} ${team.name}</strong><span>${team.abbreviation} · GM ${team.gm}</span></div></article>`)
      .join("") || '<div class="qspn-test-empty">No test teams loaded.</div>';
  }

  async function poll() {
    mountTab();
    if (!session()) return;
    try {
      const response = await apiFetch(
        `/api/draft/state?session=${encodeURIComponent(session())}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      state = normalizeState(await response.json());
      updateTab();
      render();
    } catch (_) {}
  }

  mountTab();
  setInterval(mountTab, 500);
  poll();
  setInterval(poll, 1500);
})();
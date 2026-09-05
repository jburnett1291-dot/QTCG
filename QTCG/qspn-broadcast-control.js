(function () {
  const session = () =>
    sessionStorage.getItem("qspn-admin-session") ||
    localStorage.getItem("qcl-session") ||
    "";
  const api = async (path, options) => {
    const response = await fetch(path, options);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      throw new Error("Discord API mapping is not configured for /api");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Broadcast request failed");
    return result;
  };
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);

  let draft = null;
  let control = null;
  let previousVersion = null;

  function playerFor(id) {
    return draft?.prospects?.find((player) => player.id === id);
  }
  function teamFor(id) {
    return draft?.teams?.find((team) => team.id === id);
  }

  function mountStage() {
    if (document.querySelector(".qspn-broadcast-stage")) return;
    const stage = document.createElement("section");
    stage.className = "qspn-broadcast-stage";
    stage.innerHTML = `
      <div class="qspn-broadcast-frame">
        <header><span>QSPN DRAFT LIVE</span><b data-stage-title></b></header>
        <div class="qspn-broadcast-content"></div>
      </div>`;
    document.body.appendChild(stage);
  }

  function recentPicks() {
    const picks = [...(draft?.picks || [])].reverse().slice(0, 8);
    return picks.length
      ? `<div class="qspn-board-list">${picks.map((pick) => {
          const player = playerFor(pick.prospectId);
          const team = teamFor(pick.teamId);
          return `<article><b>#${esc(pick.overall)}</b><i style="background:${esc(team?.color || "#475569")}"></i><div><strong>${esc(player?.name || "Selection pending")}</strong><span>${esc(team ? `${team.city} ${team.name}` : pick.teamId)} · ${esc(player?.position || "—")} · ${esc(player?.school || "—")}</span></div></article>`;
        }).join("")}</div>`
      : '<div class="qspn-board-empty">The draft is ready. No picks have been submitted.</div>';
  }

  function bestAvailable() {
    const players = [...(draft?.prospects || [])]
      .filter((player) => player.status === "available")
      .sort((a, b) => a.rank - b.rank || b.grade - a.grade)
      .slice(0, 12);
    return `<div class="qspn-best-grid">${players.map((player) =>
      `<article><b>${esc(player.rank)}</b><div><strong>${esc(player.name)}</strong><span>${esc(player.position)} · ${esc(player.school)}</span></div><em>${esc(player.grade)}</em></article>`
    ).join("")}</div>`;
  }

  function teamNeeds() {
    const selectedId = control?.broadcast?.selectedTeamId;
    const team = teamFor(selectedId);
    const needs = control?.teamNeeds?.[selectedId] || [];
    if (!team) return '<div class="qspn-board-empty">The Director has not selected a team.</div>';
    return `
      <div class="qspn-needs-heading"><i style="background:${esc(team.color)}"></i><div><span>ON THE CLOCK</span><h2>${esc(team.city)} ${esc(team.name)}</h2><p>GM ${esc(team.gm)}</p></div></div>
      <div class="qspn-needs-list">${needs.length ? needs
        .sort((a, b) => Number(a.priority) - Number(b.priority))
        .map((need) => `<article><b>${esc(need.priority)}</b><strong>${esc(need.position)}</strong><span>${esc(need.note || "Priority position")}</span></article>`)
        .join("") : '<div class="qspn-board-empty">No team-needs submission is loaded.</div>'}</div>`;
  }

  function renderStage() {
    const enabled = Boolean(draft?.director_mode ?? draft?.director?.enabled);
    if (!enabled || !control?.broadcast) {
      document.querySelector(".qspn-broadcast-stage")?.remove();
      return;
    }
    mountStage();
    const stage = document.querySelector(".qspn-broadcast-stage");
    const panel = control.broadcast.panel;
    const title = {
      recentPicks: "RECENT PICKS",
      bestAvailable: "BEST AVAILABLE",
      teamNeeds: "TEAM NEEDS",
    }[panel] || "DRAFT CENTRAL";
    stage.querySelector("[data-stage-title]").textContent = title;
    stage.querySelector(".qspn-broadcast-content").innerHTML =
      panel === "bestAvailable" ? bestAvailable() :
      panel === "teamNeeds" ? teamNeeds() : recentPicks();
    stage.classList.toggle("with-coach-sidebar", Boolean(control.coach));
  }

  function mountCoachSidebar() {
    const coach = control?.coach;
    const existing = document.querySelector(".qspn-coach-sidebar");
    if (!coach) {
      existing?.remove();
      return;
    }
    const sidebar = existing || document.createElement("aside");
    sidebar.className = "qspn-coach-sidebar";
    const team = teamFor(coach.teamId);
    const teamPicks = [...(draft?.picks || [])]
      .filter((pick) => pick.teamId === coach.teamId).reverse().slice(0, 5);
    sidebar.innerHTML = `
      <header><span>PRIVATE WAR ROOM</span><h2>${esc(team?.abbreviation || coach.teamId)} · ${esc(coach.coachName || "Coach")}</h2></header>
      <section><h3>Latest Picks</h3>${teamPicks.length ? teamPicks.map((pick) => {
        const player = playerFor(pick.prospectId);
        return `<article><b>#${esc(pick.overall)}</b><span>${esc(player?.name || pick.prospectId)}</span></article>`;
      }).join("") : "<p>No selections yet.</p>"}</section>
      <section><h3>My Notes</h3>${(coach.playerNotes || []).slice(0, 8).map((note) => {
        const player = playerFor(note.prospectId);
        return `<article><strong>${esc(player?.name || note.prospectId)}</strong><span>${esc(note.note)}</span></article>`;
      }).join("") || "<p>No player notes submitted.</p>"}</section>
      <section><h3>My Mock</h3>${(coach.mockPicks || []).slice(0, 8).map((pick) => {
        const player = playerFor(pick.prospectId);
        return `<article><b>${pick.overall ? `#${esc(pick.overall)}` : "—"}</b><span>${esc(player?.name || pick.prospectId)}</span></article>`;
      }).join("") || "<p>No mock picks submitted.</p>"}</section>`;
    if (!existing) document.body.appendChild(sidebar);
  }

  async function setPanel(panel, selectedTeamId) {
    const result = await api("/api/draft/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: session(), panel, selectedTeamId }),
    });
    control.broadcast = result.broadcast;
    renderDirectorDock();
    renderStage();
  }

  function importSubmissions() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const parsed = JSON.parse(await input.files[0].text());
        const submissions = Array.isArray(parsed) ? parsed : parsed.submissions;
        const result = await api("/api/draft/submissions/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: session(), submissions }),
        });
        alert(`${result.imported} coach submissions loaded.`);
        await poll();
      } catch (error) {
        alert(error.message);
      }
    };
    input.click();
  }

  function renderDirectorDock() {
    const existing = document.querySelector(".qspn-director-dock");
    if (control?.access !== "admin") {
      existing?.remove();
      return;
    }
    const dock = existing || document.createElement("aside");
    dock.className = "qspn-director-dock";
    const selected = control.broadcast?.selectedTeamId || "";
    dock.innerHTML = `
      <div><span>DIRECTOR OUTPUT</span><strong>${esc(control.broadcast?.panel || "recentPicks")}</strong></div>
      <button data-panel="recentPicks">Recent Picks</button>
      <button data-panel="bestAvailable">Best Available</button>
      <button data-panel="teamNeeds">Team Needs</button>
      <select aria-label="Team for needs view"><option value="">Select team…</option>${(draft?.teams || []).map((team) =>
        `<option value="${esc(team.id)}" ${team.id === selected ? "selected" : ""}>${esc(team.abbreviation)} · ${esc(team.city)} ${esc(team.name)}</option>`
      ).join("")}</select>
      <button data-import>Import Coach Templates</button>`;
    dock.querySelectorAll("[data-panel]").forEach((button) => {
      button.classList.toggle("active", button.dataset.panel === control.broadcast?.panel);
      button.onclick = () => setPanel(
        button.dataset.panel,
        dock.querySelector("select").value || null,
      ).catch((error) => alert(error.message));
    });
    dock.querySelector("select").onchange = () => {
      if (control.broadcast?.panel === "teamNeeds") {
        setPanel("teamNeeds", dock.querySelector("select").value || null)
          .catch((error) => alert(error.message));
      }
    };
    dock.querySelector("[data-import]").onclick = importSubmissions;
    if (!existing) document.body.appendChild(dock);
  }

  async function poll() {
    if (!session()) return;
    try {
      const [draftResult, controlResult] = await Promise.all([
        api(`/api/draft/state?session=${encodeURIComponent(session())}`, { cache: "no-store" }),
        api(`/api/draft/control?session=${encodeURIComponent(session())}`, { cache: "no-store" }),
      ]);
      draft = draftResult;
      control = controlResult;
      if (previousVersion !== control.broadcast?.version) previousVersion = control.broadcast?.version;
      renderStage();
      mountCoachSidebar();
      renderDirectorDock();
    } catch (_) {}
  }

  poll();
  setInterval(poll, 1500);
})();
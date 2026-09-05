(function () {
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a");
    if (link && link.textContent.trim().toUpperCase() === "WAR ROOM") {
      event.preventDefault();
      window.location.href = "/warroom/war-room";
    }
  }, true);

  const apiFetch = (path, options) => fetch(path, options);
  const isDraft = location.pathname.replace(/\/+$/, "").endsWith("/draft");
  if (isDraft) document.documentElement.classList.add("qspn-war-room-polish");
  const session = () =>
    sessionStorage.getItem("qspn-admin-session") ||
    localStorage.getItem("qcl-session") ||
    "";
  let lastPromoId = null;
  let clearTimer = null;
  let latestState = null;
  let lastPickCount = null;

  function button(label, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = "qspn-tool-button";
    element.addEventListener("click", onClick);
    return element;
  }

  async function exportPlayers() {
    const response = await apiFetch(
      `/api/draft/players?session=${encodeURIComponent(session())}`,
    );
    if (!response.ok) throw new Error((await response.json()).error || "Export failed");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "qspn_draft_players.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importPlayers(file) {
    const payload = JSON.parse(await file.text());
    const response = await apiFetch("/api/draft/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, session: session() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    alert(`${result.synced} player records pushed to the draft JSON file.`);
    location.reload();
  }

  async function setDirectorMode(enabled) {
    const response = await apiFetch("/api/draft/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_director_mode",
        enabled,
        session: session(),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Director Mode update failed");
    latestState = result.draft;
    updateDirectorTab();
  }

  async function requestPinAccess() {
    const existing = document.querySelector(".qspn-pin-dialog");
    if (existing) return false;
    return await new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "qspn-pin-dialog";
      overlay.innerHTML = `
        <form class="qspn-pin-card">
          <div class="qspn-pin-eyebrow">RESTRICTED CONTROL</div>
          <h2>Enter access PIN</h2>
          <p>Unlock Director Mode and Test Mode for this session.</p>
          <input type="password" name="pin" autocomplete="one-time-code" required autofocus>
          <div class="qspn-pin-error" role="alert"></div>
          <div class="qspn-pin-actions">
            <button type="button" data-cancel>Cancel</button>
            <button type="submit">Unlock</button>
          </div>
        </form>`;
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector("[data-cancel]").onclick = () => finish(false);
      overlay.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const input = overlay.querySelector('input[name="pin"]');
        const error = overlay.querySelector(".qspn-pin-error");
        error.textContent = "";
        try {
          const response = await apiFetch("/api/draft/pin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: input.value }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "PIN unlock failed");
          sessionStorage.setItem("qspn-admin-session", result.session);
          await pollDraftState();
          finish(true);
        } catch (requestError) {
          error.textContent = requestError.message;
          input.select();
        }
      };
      document.body.appendChild(overlay);
      setTimeout(() => overlay.querySelector("input")?.focus(), 0);
    });
  }
  window.qspnRequestPinAccess = requestPinAccess;

  function mountAdminTools() {
    if (!isDraft || latestState?.access !== "admin") return;
    if (document.querySelector(".qspn-draft-tools")) return;
    const tools = document.createElement("aside");
    tools.className = "qspn-draft-tools";
    tools.append(
      button("EXPORT PLAYERS JSON", () => {
        exportPlayers().catch((error) => alert(error.message));
      }),
      button("PUSH PLAYERS JSON", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
          if (input.files?.[0]) {
            importPlayers(input.files[0]).catch((error) => alert(error.message));
          }
        };
        input.click();
      }),
    );
    document.body.appendChild(tools);
  }

  function mountDirectorTab() {
    if (document.querySelector(".qspn-director-tab")) return;
    const warRoom = [...document.querySelectorAll("button, a")].find(
      (element) => element.textContent.trim().toUpperCase() === "WAR ROOM",
    );
    if (!warRoom) return;
    const tab = button("DEV MODE", () => {
      if (latestState?.access !== "admin") {
        requestPinAccess().then((unlocked) => {
          if (unlocked) setDirectorMode(!latestState?.director_mode);
        });
        return;
      }
      setDirectorMode(!latestState?.director_mode).catch((error) => alert(error.message));
    });
    tab.className = "qspn-director-tab";
    warRoom.parentElement?.appendChild(tab);
    updateDirectorTab();
  }

  function updateDirectorTab() {
    const tab = document.querySelector(".qspn-director-tab");
    if (!tab) return;
    const authorized = latestState?.access === "admin";
    const enabled = Boolean(
      latestState?.director_mode ?? latestState?.director?.enabled,
    );
    tab.classList.toggle("is-active", authorized && enabled);
    tab.classList.toggle("is-locked", !authorized);
    tab.textContent = authorized && enabled ? "DEV: LIVE" : "DEV MODE";
    tab.setAttribute("aria-pressed", String(authorized && enabled));
    tab.setAttribute("aria-disabled", String(!authorized));
    tab.title = !authorized
      ? "Locked — bot owner or approved draft admin access required."
      : enabled
        ? "Director Mode is live for every Activity viewer. Click to disable."
        : "Enable broadcast takeovers for every Activity viewer.";
  }

  async function pollDraftState() {
    if (!session()) return;
    try {
      const response = await apiFetch(
        `/api/draft/state?session=${encodeURIComponent(session())}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const state = await response.json();
      latestState = state;
      mountDirectorTab();
      mountAdminTools();
      updateDirectorTab();

      if (!(state.director_mode ?? state.director?.enabled)) {
        document.querySelector(".qspn-director-takeover")?.remove();
        return;
      }
      const nodeDirectorEnabled = state.director?.enabled && state.director?.autoShow;
      if (lastPickCount === null) lastPickCount = state.picks?.length || 0;
      if (nodeDirectorEnabled && (state.picks?.length || 0) > lastPickCount) {
        const pick = state.picks[state.picks.length - 1];
        const player = state.prospects?.find((item) => item.id === pick.prospectId);
        const team = state.teams?.find((item) => item.id === pick.teamId);
        if (player && team) {
          showTakeover({
            event_id: pick.id,
            pick: pick.overall,
            team: `${team.city} ${team.name}`,
            player: player.name,
          }, player);
        }
      }
      lastPickCount = state.picks?.length || 0;

      const promo = state.promo;
      if (!promo || promo.event_id === lastPromoId) return;
      lastPromoId = promo.event_id;

      const player = Object.values(state.players || {}).find(
        (item) =>
          String(item.discord_id || "") === String(promo.player_id || "") ||
          String(item.gamertag || "") === String(promo.player || ""),
      );
      showTakeover(promo, player || {});
    } catch (_) {
      // The existing Activity owns its connection/error UI.
    }
  }

  function showTakeover(promo, player) {
    document.querySelector(".qspn-director-takeover")?.remove();
    const overlay = document.createElement("section");
    overlay.className = "qspn-director-takeover";
    overlay.innerHTML = `
      <div class="qspn-director-kicker">QSPN DRAFT • PICK #${promo.pick}</div>
      <div class="qspn-director-team">${promo.team}</div>
      <div class="qspn-director-selects">SELECTS</div>
      <h1>${promo.player}</h1>
      <div class="qspn-director-meta">
        ${[player.position, player.archetype, player.college || player.school]
          .filter(Boolean)
          .map((value) => `<span>${value}</span>`)
          .join("")}
      </div>
      ${
        promo.media_url
          ? `<video src="${promo.media_url}" autoplay controls playsinline></video>`
          : ""
      }
    `;
    document.body.appendChild(overlay);
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => overlay.remove(), 12000);
  }

  mountDirectorTab();
  setInterval(mountDirectorTab, 500);
  pollDraftState();
  setInterval(pollDraftState, 1500);
})();
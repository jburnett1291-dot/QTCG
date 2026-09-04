(function () {
  const isDraft = location.pathname.replace(/\/+$/, "").endsWith("/draft");
  if (!isDraft) return;

  const session = () => localStorage.getItem("qcl-session") || "";
  const director = new URLSearchParams(location.search).get("director") === "1";
  let lastPromoId = null;
  let clearTimer = null;

  function button(label, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = "qspn-tool-button";
    element.addEventListener("click", onClick);
    return element;
  }

  async function exportPlayers() {
    const response = await fetch(
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
    const response = await fetch("/api/draft/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, session: session() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    alert(`${result.synced} player records pushed to the draft JSON file.`);
    location.reload();
  }

  function mountTools() {
    if (document.querySelector(".qspn-draft-tools")) return;
    const tools = document.createElement("aside");
    tools.className = "qspn-draft-tools";
    tools.append(
      button("DIRECTOR MODE", () => {
        window.open(`${location.pathname}?director=1`, "qspn-director");
      }),
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

  async function pollDirector() {
    if (!session()) return;
    try {
      const response = await fetch(
        `/api/draft/state?session=${encodeURIComponent(session())}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const state = await response.json();
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

  mountTools();
  if (director) {
    document.documentElement.classList.add("qspn-director-mode");
    pollDirector();
    setInterval(pollDirector, 1500);
  }
})();
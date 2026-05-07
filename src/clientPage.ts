export const clientPageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flight Tracker Console</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #17211b;
        --muted: #657067;
        --line: #d9e1d8;
        --paper: #fbfaf6;
        --panel: #ffffff;
        --field: #f3f5ef;
        --accent: #0f766e;
        --accent-strong: #115e59;
        --warn: #a54821;
        --good: #1f7a3a;
        --shadow: 0 22px 70px rgba(26, 39, 30, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(135deg, rgba(15, 118, 110, 0.11), transparent 34%),
          linear-gradient(315deg, rgba(181, 121, 56, 0.12), transparent 38%),
          var(--paper);
        color: var(--ink);
        font-family: "Aptos", "Segoe UI", sans-serif;
      }

      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0 44px;
      }

      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 24px;
      }

      h1,
      h2 {
        margin: 0;
        line-height: 1.05;
      }

      h1 {
        font-size: clamp(2rem, 5vw, 4.5rem);
        max-width: 780px;
      }

      h2 {
        font-size: 1.15rem;
      }

      p {
        color: var(--muted);
        margin: 8px 0 0;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.8);
        padding: 10px 12px;
        border-radius: 999px;
        font-weight: 700;
        white-space: nowrap;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--warn);
      }

      .dot.ok {
        background: var(--good);
      }

      .grid {
        display: grid;
        grid-template-columns: 0.9fr 1.1fr;
        gap: 18px;
      }

      .panel {
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        padding: 18px;
      }

      .stack {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 7px;
        font-size: 0.83rem;
        font-weight: 800;
        color: #344139;
        text-transform: uppercase;
      }

      input,
      select,
      textarea {
        width: 100%;
        min-height: 44px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--field);
        color: var(--ink);
        font: inherit;
        padding: 10px 12px;
      }

      textarea {
        min-height: 96px;
        resize: vertical;
      }

      button {
        min-height: 44px;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 800;
        padding: 10px 14px;
        cursor: pointer;
      }

      button:hover {
        background: var(--accent-strong);
      }

      button.secondary {
        background: #26332b;
      }

      button.ghost {
        color: var(--ink);
        background: transparent;
        border: 1px solid var(--line);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .two {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .three {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .notice {
        min-height: 42px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: #f7f2e7;
        color: #4b4232;
        padding: 11px 12px;
        font-weight: 650;
      }

      .notice.error {
        background: #fff0e8;
        color: #8b3214;
      }

      .notice.ok {
        background: #ecf8ef;
        color: #1f6b35;
      }

      .watch-list {
        display: grid;
        gap: 12px;
      }

      .watch-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 14px;
        display: grid;
        gap: 12px;
      }

      .watch-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .route {
        font-size: 1.35rem;
        font-weight: 900;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .chip {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 5px 8px;
        background: #f8faf5;
      }

      .empty {
        border: 1px dashed var(--line);
        border-radius: 8px;
        padding: 22px;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.55);
      }

      code {
        word-break: break-all;
      }

      @media (max-width: 820px) {
        header,
        .watch-top {
          align-items: stretch;
          flex-direction: column;
        }

        .grid,
        .two,
        .three {
          grid-template-columns: 1fr;
        }

        main {
          width: min(100% - 20px, 1120px);
          padding-top: 20px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Flight Tracker Console</h1>
          <p>Use your live backend to create and inspect flight watches.</p>
        </div>
        <div class="status-pill">
          <span id="authDot" class="dot"></span>
          <span id="authText">Disconnected</span>
        </div>
      </header>

      <div class="grid">
        <section class="panel stack" aria-labelledby="loginTitle">
          <div>
            <h2 id="loginTitle">Google Login</h2>
            <p>Paste the access_token, id_token, Bearer token, or token JSON from OAuth Playground.</p>
          </div>
          <label>
            Google access token
            <textarea id="googleToken" autocomplete="off" spellcheck="false"></textarea>
          </label>
          <div class="actions">
            <button id="loginButton" type="button">Connect</button>
            <button id="logoutButton" class="ghost" type="button">Clear session</button>
            <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer">
              <button class="secondary" type="button">OAuth Playground</button>
            </a>
          </div>
          <div id="loginNotice" class="notice">Ready.</div>
          <div>
            <h2>Backend token</h2>
            <p><code id="tokenPreview">No token stored.</code></p>
          </div>
        </section>

        <section class="panel stack" aria-labelledby="watchTitle">
          <div>
            <h2 id="watchTitle">Create Watch</h2>
            <p>Track a route and let the scheduler collect price snapshots.</p>
          </div>
          <form id="watchForm" class="stack">
            <div class="two">
              <label>
                Origin
                <input id="origin" maxlength="3" required value="GRU" />
              </label>
              <label>
                Destination
                <input id="destination" maxlength="3" required value="LHR" />
              </label>
            </div>
            <div class="two">
              <label>
                Departure date
                <input id="departureDate" type="date" required />
              </label>
              <label>
                Return date
                <input id="returnDate" type="date" />
              </label>
            </div>
            <div class="three">
              <label>
                Adults
                <input id="adults" type="number" min="1" max="9" value="1" required />
              </label>
              <label>
                Cabin
                <select id="cabinClass">
                  <option value="ECONOMY">Economy</option>
                  <option value="BUSINESS">Business</option>
                  <option value="FIRST">First</option>
                </select>
              </label>
              <label>
                Currency
                <input id="currency" maxlength="3" value="BRL" required />
              </label>
            </div>
            <div class="two">
              <label>
                Alert threshold %
                <input id="thresholdPercent" type="number" min="1" max="50" value="10" required />
              </label>
              <label>
                Alert on price rise
                <select id="alertOnRise">
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
            </div>
            <div class="actions">
              <button type="submit">Create watch</button>
              <button id="refreshButton" class="ghost" type="button">Refresh watches</button>
            </div>
          </form>
          <div id="watchNotice" class="notice">Create up to 3 watches on the free plan.</div>
        </section>
      </div>

      <section class="panel stack" style="margin-top: 18px" aria-labelledby="savedTitle">
        <div class="watch-top">
          <div>
            <h2 id="savedTitle">Saved Watches</h2>
            <p>Latest snapshots appear after the scheduler has checked the route.</p>
          </div>
          <button id="reloadButton" class="ghost" type="button">Reload</button>
        </div>
        <div id="watchList" class="watch-list">
          <div class="empty">Connect first, then create a watch.</div>
        </div>
      </section>
    </main>

    <script>
      const authDot = document.getElementById("authDot");
      const authText = document.getElementById("authText");
      const tokenPreview = document.getElementById("tokenPreview");
      const loginNotice = document.getElementById("loginNotice");
      const watchNotice = document.getElementById("watchNotice");
      const watchList = document.getElementById("watchList");
      const googleToken = document.getElementById("googleToken");
      const today = new Date();
      today.setDate(today.getDate() + 45);
      document.getElementById("departureDate").value = today.toISOString().slice(0, 10);

      let authToken = localStorage.getItem("flightTrackerAuthToken") || "";

      function setNotice(element, message, type) {
        element.textContent = message;
        element.className = "notice" + (type ? " " + type : "");
      }

      function updateAuthUi() {
        const connected = Boolean(authToken);
        authDot.className = "dot" + (connected ? " ok" : "");
        authText.textContent = connected ? "Connected" : "Disconnected";
        tokenPreview.textContent = connected ? authToken.slice(0, 32) + "..." : "No token stored.";
      }

      function toIsoDate(dateValue) {
        return new Date(dateValue + "T00:00:00.000Z").toISOString();
      }

      async function api(path, options) {
        const request = options || {};
        const headers = Object.assign({ "Content-Type": "application/json" }, request.headers || {});
        if (authToken) headers.Authorization = "Bearer " + authToken;

        const response = await fetch(path, Object.assign({}, request, { headers }));
        const text = await response.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          const message = data && data.error ? data.error : "Request failed with " + response.status;
          throw new Error(message);
        }

        return data;
      }

      function extractGoogleToken(rawValue) {
        const raw = rawValue.trim();
        if (!raw) return "";

        try {
          const parsed = JSON.parse(raw);
          if (parsed.access_token) return String(parsed.access_token).trim();
          if (parsed.id_token) return String(parsed.id_token).trim();
          if (parsed.googleToken) return String(parsed.googleToken).trim();
          if (parsed.token) return String(parsed.token).trim();
        } catch {}

        const jsonTokenMatch = raw.match(/"(access_token|id_token)"\s*:\s*"([^"]+)"/i);
        if (jsonTokenMatch) return jsonTokenMatch[2].trim();

        const keyValueMatch = raw.match(/\b(access_token|id_token)\b\s*[:=]\s*["']?([^"',\s}]+)/i);
        if (keyValueMatch) return keyValueMatch[2].trim();

        const bearerMatch = raw.match(/^Bearer\s+(.+)$/i);
        if (bearerMatch) return bearerMatch[1].trim();

        return raw.replace(/^["']|["']$/g, "").trim();
      }

      async function login() {
        const token = extractGoogleToken(googleToken.value);
        if (!token) {
          setNotice(loginNotice, "Paste a Google token first.", "error");
          return;
        }

        try {
          setNotice(loginNotice, "Connecting...");
          const result = await api("/v1/auth/google", {
            method: "POST",
            body: JSON.stringify({ googleToken: token })
          });
          authToken = result.authToken;
          localStorage.setItem("flightTrackerAuthToken", authToken);
          googleToken.value = "";
          updateAuthUi();
          setNotice(loginNotice, "Connected as user " + result.userId + ".", "ok");
          await loadWatches();
        } catch (error) {
          setNotice(loginNotice, error.message, "error");
        }
      }

      async function logout() {
        if (authToken) {
          try {
            await api("/v1/auth/logout", { method: "POST" });
          } catch {}
        }
        authToken = "";
        localStorage.removeItem("flightTrackerAuthToken");
        updateAuthUi();
        watchList.innerHTML = '<div class="empty">Connect first, then create a watch.</div>';
        setNotice(loginNotice, "Session cleared.");
      }

      function watchPayload() {
        const returnDate = document.getElementById("returnDate").value;
        const payload = {
          origin: document.getElementById("origin").value.trim().toUpperCase(),
          destination: document.getElementById("destination").value.trim().toUpperCase(),
          departureDate: toIsoDate(document.getElementById("departureDate").value),
          adults: Number(document.getElementById("adults").value),
          cabinClass: document.getElementById("cabinClass").value,
          thresholdPercent: Number(document.getElementById("thresholdPercent").value),
          alertOnRise: document.getElementById("alertOnRise").value === "true",
          currency: document.getElementById("currency").value.trim().toUpperCase()
        };
        if (returnDate) payload.returnDate = toIsoDate(returnDate);
        return payload;
      }

      async function createWatch(event) {
        event.preventDefault();
        if (!authToken) {
          setNotice(watchNotice, "Connect before creating a watch.", "error");
          return;
        }

        try {
          setNotice(watchNotice, "Creating watch...");
          const created = await api("/v1/watches", {
            method: "POST",
            body: JSON.stringify(watchPayload())
          });
          setNotice(watchNotice, "Created watch " + created.id + ".", "ok");
          await loadWatches();
        } catch (error) {
          setNotice(watchNotice, error.message, "error");
        }
      }

      async function loadWatches() {
        if (!authToken) {
          watchList.innerHTML = '<div class="empty">Connect first, then create a watch.</div>';
          return;
        }

        try {
          const watches = await api("/v1/watches");
          if (!watches.length) {
            watchList.innerHTML = '<div class="empty">No watches yet.</div>';
            return;
          }
          watchList.innerHTML = watches.map(renderWatch).join("");
        } catch (error) {
          watchList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        }
      }

      function renderWatch(watch) {
        const date = new Date(watch.departureDate).toLocaleDateString();
        const price = watch.currentPrice ? watch.currency + " " + watch.currentPrice : "No price yet";
        return [
          '<article class="watch-card">',
          '<div class="watch-top">',
          '<div>',
          '<div class="route">' + escapeHtml(watch.origin) + ' -> ' + escapeHtml(watch.destination) + '</div>',
          '<div class="meta">',
          '<span class="chip">' + escapeHtml(date) + '</span>',
          '<span class="chip">' + escapeHtml(watch.cabinClass) + '</span>',
          '<span class="chip">' + escapeHtml(String(watch.adults)) + ' adult(s)</span>',
          '<span class="chip">' + escapeHtml(price) + '</span>',
          '</div>',
          '</div>',
          '<div class="actions">',
          '<button class="ghost" type="button" data-action="check-price" data-watch-id="' + escapeHtml(watch.id) + '">Check price</button>',
          '<button class="ghost" type="button" data-action="delete-watch" data-watch-id="' + escapeHtml(watch.id) + '">Delete</button>',
          '</div>',
          '</div>',
          '<code>' + escapeHtml(watch.id) + '</code>',
          '</article>'
        ].join("");
      }

      async function deleteWatch(id) {
        try {
          await api("/v1/watches/" + encodeURIComponent(id), { method: "DELETE" });
          setNotice(watchNotice, "Watch deleted.", "ok");
          await loadWatches();
        } catch (error) {
          setNotice(watchNotice, error.message, "error");
        }
      }

      async function checkPrice(id) {
        try {
          const result = await api("/v1/prices/" + encodeURIComponent(id) + "/current");
          setNotice(watchNotice, "Latest price: " + result.currency + " " + result.price + ".", "ok");
        } catch (error) {
          setNotice(watchNotice, error.message, "error");
        }
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      document.getElementById("loginButton").addEventListener("click", login);
      document.getElementById("logoutButton").addEventListener("click", logout);
      document.getElementById("watchForm").addEventListener("submit", createWatch);
      document.getElementById("refreshButton").addEventListener("click", loadWatches);
      document.getElementById("reloadButton").addEventListener("click", loadWatches);
      watchList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const id = button.dataset.watchId;
        if (button.dataset.action === "check-price") checkPrice(id);
        if (button.dataset.action === "delete-watch") deleteWatch(id);
      });

      updateAuthUi();
      loadWatches();
    </script>
  </body>
</html>`;

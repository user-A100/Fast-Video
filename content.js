(() => {
  if (window.__betterSpeedControllerLoaded) return;
  window.__betterSpeedControllerLoaded = true;

  const BILI_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 8, 16];
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 16;
  const hostname = location.hostname;
  const isBilibili = hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");

  class SpeedController {
    constructor() {
      this.currentSpeed = 1;
      this.lockedSpeed = null;
      this.siteSpeeds = {};
      this.videos = new Set();
      this.programmaticVideos = new WeakSet();
      this.lastCustomSpeed = null;
      this.settleTimers = [];
      this.videoIdentity = isBilibili ? this.getBilibiliVideoIdentity() : null;
      this.pendingBiliReset = isBilibili;
      this.domObserver = null;
      this.init();
    }

    async init() {
      const result = await chrome.storage.sync.get(["siteSpeeds"]);
      this.siteSpeeds = result.siteSpeeds || {};
      this.lockedSpeed = isBilibili ? null : this.normaliseSpeed(this.siteSpeeds[hostname]);
      if (this.lockedSpeed !== null) this.currentSpeed = this.lockedSpeed;

      this.injectStyles();
      this.scan();
      this.observeDom();
      this.listenForMessages();

      if (isBilibili) {
        this.enhanceBilibiliMenus();
        this.navigationTimer = setInterval(() => this.checkBilibiliNavigation(), 500);
      }
    }

    normaliseSpeed(value) {
      const speed = Number(value);
      return Number.isFinite(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED ? speed : null;
    }

    formatSpeed(speed) {
      return `${Number(speed.toFixed(2))}×`;
    }

    getMediaElements(root = document) {
      const media = new Set();
      const visit = (scope) => {
        if (scope?.matches?.("video, audio, bwp-video") && typeof scope.playbackRate === "number") media.add(scope);
        scope?.querySelectorAll?.("video, audio, bwp-video").forEach((element) => {
          if (typeof element.playbackRate === "number") media.add(element);
        });
        scope?.querySelectorAll?.("*").forEach((element) => {
          if (element.shadowRoot) visit(element.shadowRoot);
        });
      };
      visit(root);
      return [...media];
    }

    scan(root = document) {
      this.getMediaElements(root).forEach((video) => this.attachVideo(video));
      if (isBilibili) this.enhanceBilibiliMenus(root);
    }

    attachVideo(video) {
      if (this.videos.has(video)) return;
      this.videos.add(video);

      if (isBilibili) {
        this.setVideoSpeed(video, this.pendingBiliReset ? 1 : this.currentSpeed);
        this.pendingBiliReset = false;
      } else if (this.lockedSpeed !== null) {
        this.setVideoSpeed(video, this.lockedSpeed);
      } else if (Number.isFinite(video.playbackRate)) {
        this.currentSpeed = video.playbackRate;
      }

      video.addEventListener("ratechange", () => {
        if (this.programmaticVideos.has(video)) {
          this.programmaticVideos.delete(video);
          return;
        }

        if (this.lockedSpeed !== null && !isBilibili && video.playbackRate !== this.lockedSpeed) {
          this.setVideoSpeed(video, this.lockedSpeed);
          return;
        }

        this.currentSpeed = video.playbackRate;
        this.updateBilibiliMenuState();
        this.reportSpeed();
      }, true);

      video.addEventListener("loadedmetadata", () => {
        if (this.lockedSpeed !== null && !isBilibili) {
          this.setVideoSpeed(video, this.lockedSpeed);
        } else if (isBilibili) {
          this.setVideoSpeed(video, this.currentSpeed);
        }
      }, true);

      video.addEventListener("play", () => {
        if (this.lockedSpeed !== null && !isBilibili) this.setVideoSpeed(video, this.lockedSpeed);
      }, true);

      this.reportSpeed();
    }

    setVideoSpeed(video, speed) {
      if (!video || video.playbackRate === speed) return;
      this.programmaticVideos.add(video);
      if ("defaultPlaybackRate" in video) video.defaultPlaybackRate = speed;
      video.playbackRate = speed;
    }

    applyToAllMedia(speed) {
      const media = this.getMediaElements();
      media.forEach((element) => {
        this.attachVideo(element);
        this.setVideoSpeed(element, speed);
      });
      return media.length;
    }

    syncNativeBilibiliOption(speed) {
      if (!isBilibili || speed > 2) return;
      for (const host of this.findBilibiliMenus()) {
        const candidates = [...host.querySelectorAll("*:not(.vsc-bili-menu):not(.vsc-bili-menu *)")];
        const option = candidates.find((element) => {
          if (element.children.length > 0) return false;
          const value = Number.parseFloat(element.textContent?.replace(/[×x]/gi, "").trim());
          return value === speed;
        });
        option?.click();
      }
    }

    settleBilibiliSpeed(speed) {
      this.settleTimers.forEach(clearTimeout);
      this.settleTimers = [];
      [0, 60, 180, 420, 780].forEach((delay) => {
        const timer = setTimeout(() => {
          this.currentSpeed = speed;
          this.applyToAllMedia(speed);
          this.updateBilibiliMenuState();
        }, delay);
        this.settleTimers.push(timer);
      });
    }

    setSpeedOnce(speed, broadcast = true) {
      const validSpeed = this.normaliseSpeed(speed);
      if (validSpeed === null) return false;
      this.currentSpeed = validSpeed;
      if (isBilibili) {
        this.syncNativeBilibiliOption(validSpeed);
        this.settleBilibiliSpeed(validSpeed);
        if (broadcast) {
          chrome.runtime.sendMessage({ action: "broadcastSpeed", speed: validSpeed }).catch(() => {});
        }
      } else {
        this.applyToAllMedia(validSpeed);
      }
      this.updateBilibiliMenuState();
      this.reportSpeed();
      return true;
    }

    async setSiteLock(speed) {
      if (isBilibili) return { success: false, reason: "bilibili-player-controls" };
      const validSpeed = speed === null ? null : this.normaliseSpeed(speed);
      if (speed !== null && validSpeed === null) return { success: false, reason: "invalid-speed" };

      if (validSpeed === null) {
        delete this.siteSpeeds[hostname];
        this.lockedSpeed = null;
      } else {
        this.siteSpeeds[hostname] = validSpeed;
        this.lockedSpeed = validSpeed;
        this.setSpeedOnce(validSpeed);
      }
      await chrome.storage.sync.set({ siteSpeeds: this.siteSpeeds });
      return { success: true, lockedSpeed: this.lockedSpeed };
    }

    observeDom() {
      this.domObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) this.scan(node);
          });
        }
      });
      this.domObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    getBilibiliVideoIdentity() {
      const path = location.pathname;
      const video = path.match(/\/video\/(BV[\w]+|av\d+)/i);
      if (video) return `video:${video[1].toLowerCase()}`;
      const episode = path.match(/\/(bangumi|cheese)\/play\/((?:ep|ss)\d+)/i);
      if (episode) return `${episode[1].toLowerCase()}:${episode[2].toLowerCase()}`;
      return `${path}:${new URLSearchParams(location.search).get("bvid") || ""}`;
    }

    checkBilibiliNavigation() {
      const identity = this.getBilibiliVideoIdentity();
      if (identity === this.videoIdentity) return;
      this.videoIdentity = identity;
      this.currentSpeed = 1;
      this.lastCustomSpeed = null;
      this.pendingBiliReset = true;
      this.applyToAllMedia(1);
      this.updateBilibiliMenuState();
      this.reportSpeed();
    }

    findBilibiliMenus(root = document) {
      const selectors = [
        ".bpx-player-ctrl-playbackrate-menu",
        ".bilibili-player-video-btn-speed-menu",
        "[class*='playbackrate'][class*='menu']"
      ];
      const candidates = new Set();
      for (const selector of selectors) {
        if (root.matches?.(selector)) candidates.add(root);
        root.querySelectorAll?.(selector).forEach((menu) => candidates.add(menu));
      }
      return [...candidates].filter((menu) => !menu.closest(".vsc-bili-menu"));
    }

    enhanceBilibiliMenus(root = document) {
      if (!isBilibili) return;
      this.findBilibiliMenus(root).forEach((host) => {
        if (host.dataset.vscEnhanced === "true") return;
        host.dataset.vscEnhanced = "true";
        host.classList.add("vsc-bili-host");
        host.append(this.buildBilibiliMenu());
      });
      this.updateBilibiliMenuState();
    }

    buildBilibiliMenu() {
      const menu = document.createElement("div");
      menu.className = "vsc-bili-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "播放速度");

      const speedList = document.createElement("div");
      speedList.className = "vsc-speed-list";
      BILI_SPEEDS.forEach((speed) => speedList.append(this.buildSpeedButton(speed)));
      menu.append(speedList);

      const recent = document.createElement("button");
      recent.type = "button";
      recent.className = "vsc-speed-item vsc-custom-recent";
      recent.hidden = true;
      recent.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.lastCustomSpeed !== null) this.setSpeedOnce(this.lastCustomSpeed);
      });
      menu.append(recent);

      const custom = document.createElement("form");
      custom.className = "vsc-custom-form";
      custom.innerHTML = `
        <label><span>自定义</span><input type="number" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.01" inputmode="decimal" placeholder="2.75" aria-label="自定义倍速"></label>
        <button type="submit">应用</button>
        <small aria-live="polite"></small>
      `;
      custom.addEventListener("click", (event) => event.stopPropagation());
      custom.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = custom.querySelector("input");
        const hint = custom.querySelector("small");
        const speed = this.normaliseSpeed(input.value);
        if (speed === null) {
          hint.textContent = "请输入 0.25–16";
          input.setAttribute("aria-invalid", "true");
          return;
        }
        input.removeAttribute("aria-invalid");
        hint.textContent = "";
        this.lastCustomSpeed = speed;
        this.setSpeedOnce(speed);
        input.value = "";
        this.updateBilibiliMenuState();
      });
      menu.append(custom);
      return menu;
    }

    buildSpeedButton(speed) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vsc-speed-item";
      button.dataset.speed = String(speed);
      button.setAttribute("role", "menuitemradio");
      button.textContent = this.formatSpeed(speed);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setSpeedOnce(speed);
      });
      return button;
    }

    updateBilibiliMenuState() {
      if (!isBilibili) return;
      document.querySelectorAll(".vsc-speed-item[data-speed]").forEach((button) => {
        const active = Number(button.dataset.speed) === this.currentSpeed;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      document.querySelectorAll(".vsc-custom-recent").forEach((button) => {
        button.hidden = this.lastCustomSpeed === null || BILI_SPEEDS.includes(this.lastCustomSpeed);
        if (!button.hidden) {
          button.textContent = `最近使用 ${this.formatSpeed(this.lastCustomSpeed)}`;
          button.classList.toggle("is-active", this.currentSpeed === this.lastCustomSpeed);
        }
      });
      document.querySelectorAll(".bpx-player-ctrl-playbackrate-result, .bilibili-player-video-btn-speed-name").forEach((label) => {
        label.textContent = this.currentSpeed === 1 ? "倍速" : this.formatSpeed(this.currentSpeed);
      });
    }

    injectStyles() {
      if (!isBilibili || document.getElementById("vsc-bili-styles")) return;
      const style = document.createElement("style");
      style.id = "vsc-bili-styles";
      style.textContent = `
        .vsc-bili-host[data-vsc-enhanced="true"] { width: 118px !important; max-height: min(70vh, 560px) !important; overflow-y: auto !important; padding: 6px !important; box-sizing: border-box !important; }
        .vsc-bili-host[data-vsc-enhanced="true"] > :not(.vsc-bili-menu) { display: none !important; }
        .vsc-bili-menu { color: #fff; font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
        .vsc-speed-list { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
        .vsc-speed-item { width: 100%; min-height: 30px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font: inherit; white-space: nowrap; }
        .vsc-speed-item:hover, .vsc-speed-item:focus-visible { background: rgba(255,255,255,.14); outline: none; }
        .vsc-speed-item.is-active { color: #fb7299; font-weight: 700; background: rgba(251,114,153,.13); }
        .vsc-custom-recent { margin-top: 4px; color: #fb7299; }
        .vsc-custom-form { margin-top: 5px; padding-top: 7px; border-top: 1px solid rgba(255,255,255,.15); }
        .vsc-custom-form label { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 5px; }
        .vsc-custom-form label span { font-size: 12px; opacity: .82; }
        .vsc-custom-form input { width: 100%; min-width: 0; height: 26px; box-sizing: border-box; border: 1px solid rgba(255,255,255,.28); border-radius: 5px; padding: 0 5px; background: rgba(0,0,0,.24); color: #fff; font: inherit; }
        .vsc-custom-form input:focus { border-color: #fb7299; outline: 2px solid rgba(251,114,153,.22); }
        .vsc-custom-form input[aria-invalid="true"] { border-color: #ff4d4f; }
        .vsc-custom-form button { width: 100%; height: 27px; margin-top: 5px; border: 0; border-radius: 5px; background: #fb7299; color: #fff; cursor: pointer; font: inherit; font-weight: 650; }
        .vsc-custom-form button:hover { background: #ff85ad; }
        .vsc-custom-form small { display: block; min-height: 13px; margin-top: 2px; color: #ffb3b5; font-size: 11px; text-align: center; }
        @media (prefers-reduced-motion: no-preference) { .vsc-speed-item, .vsc-custom-form button { transition: background-color .12s ease, color .12s ease; } }
      `;
      document.documentElement.append(style);
    }

    getState() {
      return {
        speed: this.currentSpeed,
        hostname,
        isBilibili,
        lockedSpeed: this.lockedSpeed
      };
    }

    reportSpeed() {
      chrome.runtime.sendMessage({
        action: "speedChanged",
        speed: this.currentSpeed,
        isBilibili
      }).catch(() => {});
    }

    listenForMessages() {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === "getState") {
          sendResponse(this.getState());
          return;
        }
        if (message.action === "setSpeed") {
          sendResponse({ success: this.setSpeedOnce(message.speed), ...this.getState() });
          return;
        }
        if (message.action === "applyBroadcastSpeed") {
          sendResponse({ success: this.setSpeedOnce(message.speed, false), ...this.getState() });
          return;
        }
        if (message.action === "syncDisplayedSpeed") {
          const speed = this.normaliseSpeed(message.speed);
          if (speed !== null) {
            this.currentSpeed = speed;
            this.updateBilibiliMenuState();
          }
          sendResponse({ success: speed !== null });
          return;
        }
        if (message.action === "setSiteLock") {
          this.setSiteLock(message.speed).then(sendResponse);
          return true;
        }
      });
    }
  }

  new SpeedController();
})();

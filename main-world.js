(() => {
  if (window.__fastVideoMainWorldLoaded) return;
  window.__fastVideoMainWorldLoaded = true;

  const CONTROL_EVENT = "fast-video:set-playback-guard";
  const proto = globalThis.HTMLMediaElement?.prototype;
  if (!proto) return;

  let enforcedSpeed = null;
  let aggressiveGuard = false;
  const originals = new Map();
  const guardedGetters = new Map();
  const guardedSetters = new Map();
  const guardedMedia = new Set();

  const normalise = (value) => {
    const speed = Number(value);
    return Number.isFinite(speed) && speed >= 0.25 && speed <= 16 ? speed : null;
  };

  for (const property of ["playbackRate", "defaultPlaybackRate"]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor?.get || !descriptor?.set) continue;
    originals.set(property, descriptor);
    const guardedGetter = function () {
      return enforcedSpeed === null ? descriptor.get.call(this) : enforcedSpeed;
    };
    const guardedSetter = function (value) {
      const requested = normalise(value);
      return descriptor.set.call(this, enforcedSpeed === null || requested === enforcedSpeed ? value : enforcedSpeed);
    };
    guardedGetters.set(property, guardedGetter);
    guardedSetters.set(property, guardedSetter);
    Object.defineProperty(proto, property, {
      ...descriptor,
      get: guardedGetter,
      set: guardedSetter
    });
  }

  const getMedia = () => {
    const media = new Set();
    const visit = (root) => {
      root?.querySelectorAll?.("video, audio").forEach((element) => media.add(element));
      root?.querySelectorAll?.("*").forEach((element) => {
        if (element.shadowRoot) visit(element.shadowRoot);
      });
    };
    visit(document);
    return media;
  };

  const protectMediaInstance = (media) => {
    if (!aggressiveGuard || guardedMedia.has(media)) return;
    for (const property of ["playbackRate", "defaultPlaybackRate"]) {
      const own = Object.getOwnPropertyDescriptor(media, property);
      if (own?.configurable === false) continue;
      try {
        Object.defineProperty(media, property, {
          configurable: false,
          enumerable: true,
          get: guardedGetters.get(property),
          set: guardedSetters.get(property)
        });
      } catch {}
    }
    guardedMedia.add(media);
  };

  const correctMedia = (media, speed) => {
    const defaultDescriptor = originals.get("defaultPlaybackRate");
    const playbackDescriptor = originals.get("playbackRate");
    try {
      if (defaultDescriptor?.get.call(media) !== speed) defaultDescriptor?.set.call(media, speed);
    } catch {}
    try {
      if (playbackDescriptor?.get.call(media) !== speed) playbackDescriptor?.set.call(media, speed);
    } catch {}
  };

  const apply = (speed) => {
    getMedia().forEach((media) => {
      protectMediaInstance(media);
      correctMedia(media, speed);
    });
  };

  const restorePrototypeGuards = () => {
    for (const [property, original] of originals) {
      const current = Object.getOwnPropertyDescriptor(proto, property);
      const guardedSetter = guardedSetters.get(property);
      if (current?.set === guardedSetter || current?.configurable === false) continue;
      try {
        Object.defineProperty(proto, property, {
          ...original,
          get: guardedGetters.get(property),
          set: guardedSetter
        });
      } catch {}
    }
  };

  document.addEventListener(CONTROL_EVENT, (event) => {
    const speed = event.detail?.enabled === true ? normalise(event.detail.speed) : null;
    aggressiveGuard = event.detail?.aggressive === true;
    enforcedSpeed = speed;
    if (speed !== null) apply(speed);
  });

  document.addEventListener("ratechange", (event) => {
    if (!aggressiveGuard || enforcedSpeed === null) return;
    if (event.target instanceof HTMLMediaElement) correctMedia(event.target, enforcedSpeed);
  }, true);

  const correctEachFrame = () => {
    if (aggressiveGuard && enforcedSpeed !== null) {
      for (const media of guardedMedia) {
        if (!media.isConnected) {
          guardedMedia.delete(media);
          continue;
        }
        correctMedia(media, enforcedSpeed);
      }
    }
    requestAnimationFrame(correctEachFrame);
  };
  requestAnimationFrame(correctEachFrame);

  // Some players keep a reference to the native setter or replace the prototype
  // after startup. Reassert only while compatibility enforcement is active.
  setInterval(() => {
    if (enforcedSpeed === null) return;
    restorePrototypeGuards();
    apply(enforcedSpeed);
  }, 80);
})();

let runtimeListener;
let removedListener;
const sentMessages = [];

globalThis.chrome = {
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  runtime: {
    onMessage: { addListener: (listener) => { runtimeListener = listener; } }
  },
  tabs: {
    sendMessage: async (tabId, message) => { sentMessages.push({ tabId, message }); },
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: (listener) => { removedListener = listener; } }
  }
};

await import("../background.js");

runtimeListener({ action: "broadcastYuketangSpeed", speed: 4 }, { tab: { id: 42 } }, () => {});
await new Promise((resolve) => setTimeout(resolve, 0));
if (sentMessages[0]?.tabId !== 42 || sentMessages[0]?.message.action !== "applyYuketangSpeed" || sentMessages[0]?.message.speed !== 4) {
  throw new Error("雨课堂模式未广播到标签页 iframe");
}

let state;
runtimeListener({ action: "getYuketangTabSpeed" }, { tab: { id: 42 } }, (response) => { state = response; });
if (!state?.active || state.speed !== 4) throw new Error("后加载 iframe 未恢复雨课堂倍速状态");

removedListener(42);
runtimeListener({ action: "getYuketangTabSpeed" }, { tab: { id: 42 } }, (response) => { state = response; });
if (state?.active) throw new Error("标签页关闭后雨课堂状态未清理");

console.log("Background tests passed: Yuketang iframe broadcast and late-frame state.");

const tabSpeeds = new Map();
const yuketangTabSpeeds = new Map();

function paintBadge(tabId, speed) {
  if (!Number.isFinite(speed)) return;
  const text = speed === 1 ? "" : speed.toFixed(speed % 1 === 0 ? 0 : 2);
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: speed > 2 ? "#fb7299" : speed < 1 ? "#1684fc" : "#00aeec"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  if (message.action === "getYuketangTabSpeed") {
    sendResponse({ active: yuketangTabSpeeds.has(sender.tab.id), speed: yuketangTabSpeeds.get(sender.tab.id) ?? 1 });
    return;
  }

  if (message.action === "clearYuketangTab") {
    yuketangTabSpeeds.delete(sender.tab.id);
    return;
  }

  if (message.action === "broadcastSpeed") {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "applyBroadcastSpeed",
      speed: message.speed
    }).catch(() => {});
    return;
  }

  if (message.action === "broadcastYuketangSpeed") {
    yuketangTabSpeeds.set(sender.tab.id, message.speed);
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "applyYuketangSpeed",
      speed: message.speed
    }).catch(() => {});
    return;
  }

  if (message.action !== "speedChanged") return;
  tabSpeeds.set(sender.tab.id, message.speed);
  paintBadge(sender.tab.id, message.speed);
  if (message.isBilibili) {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "syncDisplayedSpeed",
      speed: message.speed
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (tabSpeeds.has(tabId)) paintBadge(tabId, tabSpeeds.get(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSpeeds.delete(tabId);
  yuketangTabSpeeds.delete(tabId);
});

const QUICK_SPEEDS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 8];
let state = { speed: 1, hostname: "", isBilibili: false, lockedSpeed: null };
let activeTabId = null;

function formatSpeed(speed) {
  return `${Number(Number(speed).toFixed(2))}×`;
}

async function send(message) {
  if (activeTabId === null) return null;
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) throw error;
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
    await new Promise((resolve) => setTimeout(resolve, 80));
    return chrome.tabs.sendMessage(activeTabId, message);
  }
}

function render() {
  document.getElementById("speed").textContent = formatSpeed(state.speed);
  document.getElementById("hostname").textContent = state.hostname || "此页面无法控制";

  const status = document.getElementById("status");
  const locked = state.lockedSpeed !== null;
  status.textContent = state.isBilibili ? "播放器控制" : locked ? "已锁定" : "自由调速";
  status.classList.toggle("locked", locked);

  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === state.speed);
  });

  const lockButton = document.getElementById("lock-button");
  const lockHelp = document.getElementById("lock-help");
  if (state.isBilibili) {
    lockButton.disabled = true;
    lockButton.textContent = "由播放器控制";
    lockButton.classList.remove("danger");
    lockHelp.textContent = "B 站不会被插件锁定。";
  } else if (locked) {
    lockButton.disabled = false;
    lockButton.textContent = "解除锁定";
    lockButton.classList.add("danger");
    lockHelp.textContent = `持续固定为 ${formatSpeed(state.lockedSpeed)}。`;
  } else {
    lockButton.disabled = false;
    lockButton.textContent = "锁定当前速度";
    lockButton.classList.remove("danger");
    lockHelp.textContent = "只有明确锁定后，插件才会持续固定速度。";
  }
}

async function setSpeed(speed) {
  const response = await send({ action: "setSpeed", speed });
  if (response) state = { ...state, ...response };
  render();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    document.getElementById("hostname").textContent = "此页面无法控制";
    return;
  }
  activeTabId = tab.id;

  const speedGrid = document.getElementById("quick-speeds");
  QUICK_SPEEDS.forEach((speed) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.speed = String(speed);
    button.textContent = formatSpeed(speed);
    button.addEventListener("click", () => setSpeed(speed));
    speedGrid.append(button);
  });

  state = await send({ action: "getState" }) || state;
  render();

  document.getElementById("custom-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("custom-speed");
    const error = document.getElementById("error");
    const speed = Number(input.value);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 16) {
      error.textContent = "请输入 0.25–16 之间的倍速";
      input.focus();
      return;
    }
    error.textContent = "";
    await setSpeed(speed);
    input.value = "";
  });

  document.getElementById("lock-button").addEventListener("click", async () => {
    if (state.isBilibili) return;
    const speed = state.lockedSpeed === null ? state.speed : null;
    const response = await send({ action: "setSiteLock", speed });
    if (response?.success) state.lockedSpeed = response.lockedSpeed;
    render();
  });
}

init().catch((error) => {
  document.getElementById("hostname").textContent = `无法连接：${error.message}`;
});

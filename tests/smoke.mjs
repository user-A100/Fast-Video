import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentScript = path.join(root, "content.js");

async function makePage(browser, url, storedSiteSpeeds = {}) {
  const page = await browser.newPage();
  await page.addInitScript((siteSpeeds) => {
    const listeners = [];
    globalThis.__runtimeListeners = listeners;
    globalThis.chrome = {
      storage: {
        sync: {
          get: async () => ({ siteSpeeds }),
          set: async ({ siteSpeeds: next }) => { siteSpeeds = next; }
        }
      },
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async () => ({})
      }
    };
    globalThis.__sendToContent = (message) => new Promise((resolve) => {
      const listener = listeners[0];
      const keepAlive = listener(message, {}, resolve);
      if (keepAlive !== true) setTimeout(() => resolve(undefined), 0);
    });
  }, storedSiteSpeeds);
  await page.route("**/*", async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>test</title>" });
    } else {
      await route.abort();
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

const browser = await chromium.launch({ headless: true });
try {
  const bili = await makePage(browser, "https://www.bilibili.com/video/BV1TEST123");
  await bili.setContent(`
    <video></video>
    <div class="bpx-player-ctrl-playbackrate-menu"><div>2.0x</div><div>1.0x</div></div>
    <span class="bpx-player-ctrl-playbackrate-result">倍速</span>
  `);
  await bili.addScriptTag({ path: contentScript });
  await bili.waitForSelector(".vsc-bili-menu");

  const speedCount = await bili.locator(".vsc-speed-item[data-speed]").count();
  if (speedCount !== 12) throw new Error(`B站预设倍速数量错误：${speedCount}`);

  await bili.locator("video").evaluate((video) => {
    const simulatePlayerWriteBack = () => {
      if (video.playbackRate !== 4) return;
      video.removeEventListener("ratechange", simulatePlayerWriteBack);
      setTimeout(() => { video.playbackRate = 1; }, 20);
    };
    video.addEventListener("ratechange", simulatePlayerWriteBack);
  });
  await bili.locator('.vsc-speed-item[data-speed="4"]').click();
  await bili.waitForTimeout(900);
  if (await bili.locator("video").evaluate((video) => video.playbackRate) !== 4) {
    throw new Error("B站 4× 点击未生效");
  }

  await bili.locator(".vsc-custom-form input").fill("2.75");
  await bili.locator(".vsc-custom-form button").click();
  await bili.waitForTimeout(900);
  if (await bili.locator("video").evaluate((video) => video.playbackRate) !== 2.75) {
    throw new Error("B站自定义 2.75× 未生效");
  }
  if (!(await bili.locator(".vsc-custom-recent").isVisible())) {
    throw new Error("最近使用的自定义倍速未显示");
  }

  await bili.locator("video").evaluate((video) => { video.playbackRate = 1.5; });
  await bili.waitForTimeout(30);
  if (await bili.locator("video").evaluate((video) => video.playbackRate) !== 1.5) {
    throw new Error("B站原生 ratechange 仍被锁定");
  }

  const biliLock = await bili.evaluate(() => __sendToContent({ action: "setSiteLock", speed: 3 }));
  if (biliLock?.success !== false) throw new Error("B站不应允许网站锁定");
  await bili.close();

  const generic = await makePage(browser, "https://example.com/video");
  await generic.setContent("<video></video>");
  await generic.addScriptTag({ path: contentScript });
  await generic.waitForTimeout(30);
  await generic.locator("video").evaluate((video) => { video.playbackRate = 1.75; });
  await generic.waitForTimeout(30);
  if (await generic.locator("video").evaluate((video) => video.playbackRate) !== 1.75) {
    throw new Error("普通网站自由调速失败");
  }

  const genericLock = await generic.evaluate(() => __sendToContent({ action: "setSiteLock", speed: 3 }));
  if (genericLock?.success !== true) throw new Error("普通网站显式锁定失败");
  await generic.locator("video").evaluate((video) => { video.playbackRate = 1; });
  await generic.waitForTimeout(30);
  if (await generic.locator("video").evaluate((video) => video.playbackRate) !== 3) {
    throw new Error("普通网站锁定后没有恢复固定倍速");
  }
  await generic.close();

  console.log("Smoke tests passed: Bilibili menu/custom/native control and generic explicit lock.");
} finally {
  await browser.close();
}

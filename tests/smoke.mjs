import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentScript = path.join(root, "content.js");
const mainWorldScript = path.join(root, "main-world.js");

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
  await page.evaluate(() => {
    globalThis.__nativePlaybackRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    globalThis.__nativeDefaultPlaybackRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "defaultPlaybackRate");
  });
  await page.addScriptTag({ path: mainWorldScript });
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
  const invalidationErrors = [];
  generic.on("pageerror", (error) => invalidationErrors.push(error.message));
  await generic.evaluate(() => {
    chrome.runtime.sendMessage = () => { throw new Error("Extension context invalidated."); };
    document.querySelector("video").dispatchEvent(new Event("ratechange"));
  });
  await generic.waitForTimeout(30);
  if (invalidationErrors.some((message) => /Extension context invalidated/i.test(message))) {
    throw new Error("扩展重新加载后仍抛出上下文失效错误");
  }
  await generic.close();

  const yuketang = await makePage(browser, "https://pro.yuketang.cn/v2/web/xcloud/video-student/test");
  await yuketang.setContent("<video></video>");
  await yuketang.addScriptTag({ path: contentScript });
  await yuketang.waitForTimeout(30);
  const supportedState = await yuketang.evaluate(() => __sendToContent({ action: "setSpeed", speed: 3.5 }));
  if (!supportedState?.success || supportedState.speed !== 3.5) throw new Error("雨课堂 3.5× 设置失败");
  const supportedRate = await yuketang.locator("video").evaluate((video) => __nativePlaybackRate.get.call(video));
  if (supportedRate !== 3.5) throw new Error(`雨课堂真实速率不是 3.5×：${supportedRate}`);

  const rejectedState = await yuketang.evaluate(() => __sendToContent({ action: "setSpeed", speed: 4 }));
  if (rejectedState?.success !== false || rejectedState.speed !== 3.5) throw new Error("雨课堂不应接受 4×");
  await yuketang.locator("video").evaluate((video) => { __nativePlaybackRate.set.call(video, 1); });
  await yuketang.waitForTimeout(160);
  const restoredRate = await yuketang.locator("video").evaluate((video) => __nativePlaybackRate.get.call(video));
  if (restoredRate !== 3.5) throw new Error(`雨课堂强制回写后未恢复 3.5×：${restoredRate}`);
  await yuketang.close();

  const embeddedPlayer = await makePage(browser, "https://player.example.com/embed/lesson");
  await embeddedPlayer.setContent("<video></video>");
  await embeddedPlayer.addScriptTag({ path: contentScript });
  await embeddedPlayer.evaluate(() => __sendToContent({ action: "applyYuketangSpeed", speed: 4 }));
  await embeddedPlayer.waitForTimeout(30);
  const embeddedRate = await embeddedPlayer.locator("video").evaluate((video) => __nativePlaybackRate.get.call(video));
  if (embeddedRate !== 3.5) throw new Error(`第三方 iframe 未限制到 3.5×：${embeddedRate}`);
  await embeddedPlayer.close();
  console.log("Smoke tests passed: Bilibili, generic lock, and Yuketang write-back guard.");
} finally {
  await browser.close();
}

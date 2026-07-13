import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "tests", "artifacts", "popup.png");
fs.mkdirSync(path.dirname(output), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 620 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    globalThis.chrome = {
      tabs: {
        query: async () => [{ id: 1, url: "https://www.bilibili.com/video/BV1DEMO" }],
        sendMessage: async (_id, message) => message.action === "getState"
          ? { speed: 2.75, hostname: "www.bilibili.com", isBilibili: true, lockedSpeed: null }
          : { success: true, speed: message.speed, hostname: "www.bilibili.com", isBilibili: true, lockedSpeed: null }
      },
      scripting: { executeScript: async () => {} }
    };
  });
  await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
  await page.waitForSelector("#quick-speeds button");
  await page.screenshot({ path: output, fullPage: true });
  console.log(output);
} finally {
  await browser.close();
}

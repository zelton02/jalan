import { chromium } from "playwright-core";

const EXE = "/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell";
const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const text = () => page.locator("body").innerText();

await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
console.log("SEARCH:", (await text()).split("\n").slice(0, 6).join(" | "));

// 1. default text search
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
console.log("RESULTS:", (await text()).replace(/\n+/g, " | "));

await page.locator(".route").first().click();
await page.waitForSelector(".screen--journey", { timeout: 5000 });
console.log("JOURNEY:", (await text()).replace(/\n+/g, " | ").slice(0, 700));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-journey.png", fullPage: true });

// 2. coordinate search → multiple alternatives
await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
const inputs = page.locator(".field__input");
await inputs.nth(0).fill("3.041707,101.80142");
await inputs.nth(1).fill("3.13442,101.68625");
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
const routes = await page.locator(".route").count();
console.log("ALTERNATIVES:", routes, "|", (await text()).replace(/\n+/g, " | ").slice(0, 500));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-results.png", fullPage: true });

if (routes > 1) {
  await page.locator(".route").nth(1).click();
  await page.waitForSelector(".screen--journey", { timeout: 5000 });
  console.log("ALT JOURNEY:", (await text()).replace(/\n+/g, " | ").slice(0, 400));
}

// 3. schedule: tomorrow 07:00 via the datetime input
await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
await page.locator(".field__input").nth(0).fill("3.041707,101.80142");
await page.locator(".field__input").nth(1).fill("3.13442,101.68625");
const tomorrow = new Date(Date.now() + 86400000).toLocaleString("sv-SE").slice(0, 10);
await page.locator('input[type="datetime-local"]').fill(`${tomorrow}T07:00`);
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
console.log("SCHEDULED:", (await text()).replace(/\n+/g, " | ").slice(0, 420));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-schedule.png", fullPage: true });

// 4. geolocation button must fail gracefully, not crash
await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
await page.locator("button", { hasText: "lokasi" }).click();
await page.waitForTimeout(1500);
console.log("GEO:", (await text()).replace(/\n+/g, " | ").slice(0, 300));

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();

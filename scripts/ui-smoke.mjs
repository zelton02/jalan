import { chromium } from "playwright-core";

const BASE = "https://zhng.tech";
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

await page.goto(BASE, { waitUntil: "networkidle" });
console.log("SEARCH:", (await text()).split("\n").slice(0, 6).join(" | "));

// 1. default text search
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
console.log("RESULTS:", (await text()).replace(/\n+/g, " | "));

await page.locator(".route").first().click();
await page.waitForSelector(".screen--journey", { timeout: 5000 });
await page.waitForSelector(".map .leaflet-tile", { timeout: 8000 });
console.log("MAP:", await page.locator(".map img.leaflet-tile").count(), "tiles ·", await page.locator(".map path.leaflet-interactive").count(), "paths");
console.log("JOURNEY:", (await text()).replace(/\n+/g, " | ").slice(0, 700));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-journey.png", fullPage: true });

// 2. coordinate search → multiple alternatives
await page.goto(BASE, { waitUntil: "networkidle" });
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
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".field__input").nth(0).fill("3.041707,101.80142");
await page.locator(".field__input").nth(1).fill("3.13442,101.68625");
const tomorrow = new Date(Date.now() + 86400000).toLocaleString("sv-SE").slice(0, 10);
await page.locator('input[type="datetime-local"]').fill(`${tomorrow}T07:00`);
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
console.log("SCHEDULED:", (await text()).replace(/\n+/g, " | ").slice(0, 420));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-schedule.png", fullPage: true });

// 4. geolocation button must fail gracefully, not crash
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "lokasi" }).click();
await page.waitForTimeout(1500);
console.log("GEO:", (await text()).replace(/\n+/g, " | ").slice(0, 300));

// 4b. suggestions: typing a stop name opens the list, picking fills the field
await page.goto(BASE, { waitUntil: "networkidle" });
const fromInput = page.locator(".field__input").first();
await fromInput.click();
await fromInput.fill("mid valley");
await page.waitForSelector(".suggest__item", { timeout: 8000 });
const suggestCount = await page.locator(".suggest__item").count();
const placeRows = await page
  .locator(".suggest__item", { hasText: "TEMPAT" })
  .count()
  .catch(() => 0);
await page.locator(".suggest__item").first().click();
await page.waitForTimeout(200);
console.log("SUGGEST:", suggestCount, "items |", placeRows, "places |", await fromInput.inputValue());

// 5. stop board: search a stop, then read its departures
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "Jadual hentian" }).click();
await page.locator(".field__input").fill("KJ477");
await page.waitForSelector(".stop-hit", { timeout: 8000 });
await page.locator(".stop-hit").first().click();
await page.waitForSelector(".dep", { timeout: 8000 });
console.log("BOARD:", (await text()).replace(/\n+/g, " | ").slice(0, 500));
await page.screenshot({ path: "/root/projects/jalan/pr-assets/board-departures.png", fullPage: true });

// 6. saved place: star the From field, reload, chip must survive
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".field__input").nth(0).fill("3.041707,101.80142");
await page.locator('button[aria-label="Simpan sebagai Rumah"]').click();
console.log("SAVED:", await page.locator(".chip").allInnerTexts());
await page.reload({ waitUntil: "networkidle" });
console.log("SAVED AFTER RELOAD:", await page.locator(".chip").allInnerTexts());
console.log("RECENT:", await page.locator(".recent--button").allInnerTexts());

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();

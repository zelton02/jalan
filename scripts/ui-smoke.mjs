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

await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
console.log("SEARCH:", (await page.locator("body").innerText()).split("\n").slice(0, 6).join(" | "));

// default inputs are Sungai Long / KL Sentral
await page.locator("button", { hasText: "Cari laluan" }).click();
await page.waitForSelector(".route", { timeout: 20000 });
console.log("RESULTS:", (await page.locator("body").innerText()).replace(/\n+/g, " | "));

await page.locator(".route").click();
await page.waitForSelector(".screen--journey", { timeout: 5000 });
console.log("JOURNEY:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 900));

await page.screenshot({ path: "/root/projects/jalan/pr-assets/router-journey.png", fullPage: true });
console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();

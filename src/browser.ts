import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type StartOptions = {
  url: string;
  width: number;
  height: number;
  maxSteps: number;
  headless: boolean;
};

type ActionKind = "click" | "fill" | "check" | "select";

type PublicAction = {
  id: string;
  kind: ActionKind;
  label: string;
  role?: string;
};

type IssuedAction = PublicAction & {
  locator: Locator;
};

type Signal = {
  type: "console" | "pageerror" | "requestfailed" | "http" | "overflow";
  message: string;
  at: string;
};

type ActionLog = {
  step: number;
  actionId: string;
  kind: ActionKind;
  label: string;
  value?: string;
  ok: boolean;
  error?: string;
  at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  return nowIso().replace(/[:.]/g, "-");
}

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private runDir?: string;
  private maxSteps = 30;
  private steps = 0;
  private issued = new Map<string, IssuedAction>();
  private signals: Signal[] = [];
  private actionLog: ActionLog[] = [];

  async start(options: StartOptions) {
    await this.closeBrowserOnly();

    this.maxSteps = options.maxSteps;
    this.steps = 0;
    this.signals = [];
    this.actionLog = [];
    this.issued.clear();

    this.runDir = path.resolve(".gremlin", "runs", runId());
    await mkdir(this.runDir, { recursive: true });

    this.browser = await chromium.launch({ headless: options.headless });
    this.context = await this.browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });

    this.page = await this.context.newPage();
    this.attachSignals(this.page);

    const response = await this.page.goto(options.url, {
      waitUntil: "domcontentloaded",
    });

    return {
      runDir: this.runDir,
      url: this.page.url(),
      status: response?.status() ?? null,
      viewport: { width: options.width, height: options.height },
      maxSteps: this.maxSteps,
    };
  }

  async observe() {
    const page = this.requirePage();
    this.issued.clear();

    const root = page.locator("body");
    const aria = await root.ariaSnapshot().catch(() => "(accessibility snapshot unavailable)");

    const candidates = page.locator(
      [
        "button",
        "a[href]",
        "input:not([type='hidden'])",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='radio']",
        "[contenteditable='true']",
      ].join(",")
    );

    const count = Math.min(await candidates.count(), 80);
    const actions: PublicAction[] = [];

    for (let i = 0; i < count; i++) {
      const locator = candidates.nth(i);
      if (!(await locator.isVisible().catch(() => false))) continue;
      if (!(await locator.isEnabled().catch(() => false))) continue;

      const meta = await locator
        .evaluate((el) => {
          const node = el as HTMLElement;
          const input = el as HTMLInputElement;
          const tag = el.tagName.toLowerCase();
          const role =
            el.getAttribute("role") ||
            (tag === "button" ? "button" : tag === "a" ? "link" : tag);

          const id = el.getAttribute("id");
          const labelledBy = id
            ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
            : null;

          const label =
            el.getAttribute("aria-label") ||
            labelledBy ||
            el.getAttribute("placeholder") ||
            node.innerText ||
            input.value ||
            el.getAttribute("name") ||
            role;

          return {
            tag,
            role,
            type: input.type || null,
            label: String(label || role).trim().replace(/\s+/g, " ").slice(0, 120),
          };
        })
        .catch(() => null);

      if (!meta) continue;

      let kind: ActionKind = "click";
      if (
        meta.tag === "textarea" ||
        meta.tag === "select" ||
        meta.type === "text" ||
        meta.type === "email" ||
        meta.type === "search" ||
        meta.type === "url" ||
        meta.type === "tel" ||
        meta.type === "password" ||
        meta.type === "number" ||
        meta.tag === "input"
      ) {
        kind = meta.tag === "select" ? "select" : "fill";
      }
      if (meta.type === "checkbox" || meta.type === "radio") kind = "check";

      const id = `a_${crypto.randomBytes(4).toString("hex")}`;
      const action: IssuedAction = {
        id,
        kind,
        label: meta.label || meta.role,
        role: meta.role,
        locator,
      };
      this.issued.set(id, action);
      actions.push({ id, kind, label: action.label, role: action.role });
    }

    const overflow = await page
      .evaluate(() => {
        const el = document.documentElement;
        return {
          horizontal: el.scrollWidth > el.clientWidth + 2,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
        };
      })
      .catch(() => ({ horizontal: false, clientWidth: 0, scrollWidth: 0 }));

    if (overflow.horizontal) {
      const message = `Horizontal overflow: ${overflow.scrollWidth - overflow.clientWidth}px`;
      if (!this.signals.some((x) => x.type === "overflow" && x.message === message)) {
        this.signals.push({ type: "overflow", message, at: nowIso() });
      }
    }

    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      step: this.steps,
      remainingSteps: Math.max(0, this.maxSteps - this.steps),
      aria,
      actions,
      signals: this.signals,
      viewport: await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      })),
    };
  }

  async act(actionId: string, value?: string) {
    const page = this.requirePage();
    if (this.steps >= this.maxSteps) {
      throw new Error(`Maximum step count (${this.maxSteps}) reached`);
    }

    const action = this.issued.get(actionId);
    if (!action) {
      throw new Error("Unknown or expired action ID. Call gremlin_observe again.");
    }

    this.issued.clear();
    this.steps += 1;

    let ok = true;
    let error: string | undefined;

    try {
      if (action.kind === "click") {
        await action.locator.click({ timeout: 5000 });
      } else if (action.kind === "fill") {
        await action.locator.fill(value ?? "", { timeout: 5000 });
      } else if (action.kind === "check") {
        await action.locator.check({ timeout: 5000 });
      } else if (action.kind === "select") {
        if (value === undefined) throw new Error("select action requires value");
        await action.locator.selectOption({ label: value }).catch(async () => {
          await action.locator.selectOption(value);
        });
      }
      await page.waitForTimeout(150);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }

    const entry: ActionLog = {
      step: this.steps,
      actionId,
      kind: action.kind,
      label: action.label,
      ...(value !== undefined ? { value } : {}),
      ok,
      ...(error ? { error } : {}),
      at: nowIso(),
    };
    this.actionLog.push(entry);

    return {
      ...entry,
      url: page.url(),
      newSignals: this.signals.slice(-10),
    };
  }

  async finish() {
    if (!this.runDir) throw new Error("No active run");

    const page = this.page;
    const summary = {
      finishedAt: nowIso(),
      steps: this.steps,
      finalUrl: page?.url() ?? null,
      signals: this.signals,
      actions: this.actionLog,
    };

    await writeFile(
      path.join(this.runDir, "actions.json"),
      JSON.stringify(this.actionLog, null, 2) + "\n"
    );
    await writeFile(
      path.join(this.runDir, "findings.json"),
      JSON.stringify(this.signals, null, 2) + "\n"
    );
    await writeFile(
      path.join(this.runDir, "run.json"),
      JSON.stringify(summary, null, 2) + "\n"
    );

    if (this.context) {
      await this.context.tracing.stop({
        path: path.join(this.runDir, "trace.zip"),
      });
    }

    await this.closeBrowserOnly();

    return {
      ...summary,
      runDir: this.runDir,
      trace: path.join(this.runDir, "trace.zip"),
    };
  }

  private requirePage() {
    if (!this.page) throw new Error("No active run. Call gremlin_start first.");
    return this.page;
  }

  private attachSignals(page: Page) {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.signals.push({
          type: "console",
          message: msg.text(),
          at: nowIso(),
        });
      }
    });

    page.on("pageerror", (err) => {
      this.signals.push({
        type: "pageerror",
        message: err.message,
        at: nowIso(),
      });
    });

    page.on("requestfailed", (req) => {
      this.signals.push({
        type: "requestfailed",
        message: `${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? "failed"}`,
        at: nowIso(),
      });
    });

    page.on("response", (res) => {
      if (res.status() >= 500) {
        this.signals.push({
          type: "http",
          message: `${res.status()} ${res.url()}`,
          at: nowIso(),
        });
      }
    });
  }

  private async closeBrowserOnly() {
    this.issued.clear();
    this.page = undefined;

    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = undefined;
    }
  }
}

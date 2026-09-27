import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { BrowserSession } from "./browser.js";

const session = new BrowserSession();

const server = new McpServer({
  name: "gremlin",
  version: "0.1.0",
});

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool(
  "gremlin_start",
  {
    description:
      "Start a fresh constrained exploratory browser session. This is the only way to open a target URL.",
    inputSchema: z.object({
      url: z.string().url(),
      width: z.number().int().min(240).max(2560).default(390),
      height: z.number().int().min(240).max(2560).default(844),
      maxSteps: z.number().int().min(1).max(200).default(30),
      headless: z.boolean().default(false),
    }),
  },
  async ({ url, width, height, maxSteps, headless }) =>
    textResult(await session.start({ url, width, height, maxSteps, headless }))
);

server.registerTool(
  "gremlin_observe",
  {
    description:
      "Observe the current page. Returns an accessibility snapshot, objective failure signals, and short-lived semantic action IDs. Call this before every action.",
    inputSchema: z.object({}),
  },
  async () => textResult(await session.observe())
);

server.registerTool(
  "gremlin_act",
  {
    description:
      "Execute exactly one action ID previously minted by gremlin_observe. Raw selectors, JavaScript, shell commands, and arbitrary Playwright commands are not accepted.",
    inputSchema: z.object({
      actionId: z.string().min(1),
      value: z.string().optional(),
    }),
  },
  async ({ actionId, value }) => textResult(await session.act(actionId, value))
);

server.registerTool(
  "gremlin_finish",
  {
    description:
      "Finish the current run, save action logs and objective findings, stop Playwright tracing, and close Chromium.",
    inputSchema: z.object({}),
  },
  async () => textResult(await session.finish())
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

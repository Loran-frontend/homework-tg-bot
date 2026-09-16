import "dotenv/config";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { webhookCallback } from "grammy";
import { createBot, refreshMessage } from "./bot.js";
import { HomeworkStore } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const isRender = process.env.RENDER === "true";
const port = Number(process.env.PORT ?? 3000);
const webhookUrl = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/telegram/webhook`
  : undefined;
const webhookSecret = process.env.WEBHOOK_SECRET;

if (isRender && !webhookUrl) {
  throw new Error("RENDER_EXTERNAL_URL is not set");
}
if (isRender && !webhookSecret) {
  throw new Error("WEBHOOK_SECRET is not set");
}

const prisma = new PrismaClient();
const store = new HomeworkStore(prisma);
await store.connect();

const bot = createBot(token, store);
const webhookHandler = isRender && webhookSecret
  ? webhookCallback(bot, "http", { secretToken: webhookSecret })
  : null;

bot.catch((error) => {
  console.error("Telegram bot error:", error.error);
});

const archiveExpiredHomework = async () => {
  try {
    const topics = await store.archiveExpired();
    for (const topic of topics) {
      await refreshMessage(bot.api, store, topic);
    }
  } catch (error) {
    console.error("Failed to archive expired homework:", error);
  }
};

await archiveExpiredHomework();
const archiveTimer = setInterval(() => void archiveExpiredHomework(), 30_000);
archiveTimer.unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/telegram/webhook" && webhookHandler) {
    try {
      await webhookHandler(req, res);
    } catch (error) {
      console.error("Telegram webhook error:", error);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(archiveTimer);

  if (!isRender) {
    await bot.stop();
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await store.disconnect();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await new Promise<void>((resolve) => {
  server.listen(port, "0.0.0.0", resolve);
});

if (isRender && webhookUrl && webhookSecret) {
  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret,
  });
  console.log("Homework bot started with Telegram webhook");
} else {
  await bot.api.deleteWebhook();
  console.log("Homework bot started with long polling");
  await bot.start();
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createBot } from "./bot.js";
import { HomeworkStore } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient();
const store = new HomeworkStore(prisma);
await store.connect();

const bot = createBot(token, store);

bot.catch((error) => {
  console.error("Telegram bot error:", error.error);
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  await bot.stop();
  await store.disconnect();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.log("Homework bot started");
await bot.start();

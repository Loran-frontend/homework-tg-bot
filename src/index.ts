import "dotenv/config";
import { createBot } from "./bot.js";
import { HomeworkStore } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set");
}

const filePath = process.env.DATA_FILE ?? "./data/homework.json";
const store = new HomeworkStore(filePath);
await store.load();

const bot = createBot(token, store);

bot.catch((error) => {
  console.error("Telegram bot error:", error.error);
});

console.log("Homework bot started");
await bot.start();

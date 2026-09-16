-- CreateTable
CREATE TABLE "TelegramGroup" (
    "id" SERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "messageThreadId" INTEGER NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUser" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkList" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "primaryMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkItem" (
    "id" SERIAL NOT NULL,
    "listId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_chatId_key" ON "TelegramGroup"("chatId");
CREATE UNIQUE INDEX "Topic_groupId_messageThreadId_key" ON "Topic"("groupId", "messageThreadId");
CREATE INDEX "Topic_groupId_idx" ON "Topic"("groupId");
CREATE UNIQUE INDEX "TelegramUser_telegramId_key" ON "TelegramUser"("telegramId");
CREATE UNIQUE INDEX "HomeworkList_topicId_key" ON "HomeworkList"("topicId");
CREATE INDEX "HomeworkItem_listId_createdAt_idx" ON "HomeworkItem"("listId", "createdAt");
CREATE INDEX "HomeworkItem_authorId_idx" ON "HomeworkItem"("authorId");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkList" ADD CONSTRAINT "HomeworkList_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkItem" ADD CONSTRAINT "HomeworkItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "HomeworkList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkItem" ADD CONSTRAINT "HomeworkItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TelegramUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

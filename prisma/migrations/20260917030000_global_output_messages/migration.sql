CREATE TABLE "OutputMessage" (
    "id" SERIAL NOT NULL,
    "messageType" "PersistentMessageType" NOT NULL,
    "messageId" INTEGER NOT NULL DEFAULT 0,
    "destinationChatId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutputMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutputMessage_messageType_key" ON "OutputMessage"("messageType");

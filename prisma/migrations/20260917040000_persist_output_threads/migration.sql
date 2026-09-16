CREATE TABLE "OutputMessageDestination" (
    "id" SERIAL NOT NULL,
    "messageType" "PersistentMessageType" NOT NULL,
    "destinationChatId" BIGINT NOT NULL,
    "destinationThreadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutputMessageDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutputMessageDestination_messageType_key" ON "OutputMessageDestination"("messageType");

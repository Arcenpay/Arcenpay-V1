-- AddForeignKey
ALTER TABLE "EmbedAccessToken" ADD CONSTRAINT "EmbedAccessToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

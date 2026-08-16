-- Persist the hosting node selected for a website. Deployments already carry
-- their own nodeId snapshot; Website.nodeId keeps future operations pinned to
-- the node that owns the releases.
ALTER TABLE "Website" ADD COLUMN "nodeId" TEXT;

CREATE INDEX "Website_nodeId_idx" ON "Website"("nodeId");

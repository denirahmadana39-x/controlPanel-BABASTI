import { prisma } from "../database/prisma.js";
import { AppError, ErrorCode } from "@babasti/shared";
import { loadConfig } from "@babasti/config";
import { decryptNullable } from "../crypto/encryption.js";
import type { HostingNode } from "./types.js";

/**
 * Node selection strategy. The client never chooses a node; the scheduler does.
 * The MVP uses a deterministic online-node selection. Future versions can
 * consider CPU/RAM/disk/active-website counts without changing callers because
 * this is the single place node decisions are made.
 */

const MOCK_NODE: HostingNode = {
  id: "mock-node",
  name: "Mock Node",
  status: "ONLINE",
};

type NodeRecord = Awaited<
  ReturnType<typeof prisma.hostingNodeReference.findUnique>
>;

function decodeNodeToken(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptNullable(value);
  } catch {
    // Compatibility for nodes registered before token-at-rest encryption was
    // introduced. The next registration replaces it with encrypted data.
    return value;
  }
}

function isFresh(node: NonNullable<NodeRecord>): boolean {
  const ttlMs = loadConfig().NODE_HEARTBEAT_TTL_SECONDS * 1000;
  const lastSeen =
    node.lastHeartbeat ?? node.registeredAt ?? node.updatedAt ?? node.createdAt;
  return lastSeen.getTime() >= Date.now() - ttlMs;
}

function toHostingNode(node: NonNullable<NodeRecord>): HostingNode {
  const config = loadConfig();
  return {
    id: node.id,
    name: node.name,
    status: node.status as HostingNode["status"],
    baseUrl: node.baseUrl || config.NODE_AGENT_URL || null,
    token: decodeNodeToken(node.token) || config.NODE_AGENT_TOKEN || null,
    dnsTarget: node.dnsTarget,
  };
}

export async function chooseNode(
  providerName: string,
): Promise<HostingNode | null> {
  if (providerName === "mock") {
    return MOCK_NODE;
  }

  const nodes = await prisma.hostingNodeReference.findMany({
    where: { status: "ONLINE" },
    orderBy: { name: "asc" },
  });

  if (nodes.length === 0) {
    return null;
  }

  const freshNodes = nodes.filter(isFresh);
  const staleIds = nodes
    .filter((node) => !isFresh(node))
    .map((node) => node.id);
  if (staleIds.length > 0) {
    await prisma.hostingNodeReference.updateMany({
      where: { id: { in: staleIds }, status: "ONLINE" },
      data: { status: "OFFLINE" },
    });
  }
  if (freshNodes.length === 0) return null;

  // Deterministic selection: pick the node with the fewest websites, falling
  // back to alphabetical order for stability. A simple, swappable heuristic.
  let best = freshNodes[0];
  let bestCount = await countWebsitesOnNode(best.id);
  for (const node of freshNodes.slice(1)) {
    const count = await countWebsitesOnNode(node.id);
    if (count < bestCount) {
      best = node;
      bestCount = count;
    }
  }

  return toHostingNode(best);
}

async function countWebsitesOnNode(nodeId: string): Promise<number> {
  return prisma.website.count({ where: { nodeId } });
}

/** Resolve an existing placement. DRAINING nodes keep serving their assigned
 * websites but are excluded from new placement by chooseNode(). */
export async function getNodeById(
  providerName: string,
  nodeId: string | null | undefined,
): Promise<HostingNode | null> {
  if (!nodeId) return null;
  if (providerName === "mock") {
    return nodeId === MOCK_NODE.id ? MOCK_NODE : null;
  }
  const node = await prisma.hostingNodeReference.findUnique({
    where: { id: nodeId },
  });
  if (!node || node.status === "OFFLINE") return null;
  if (!isFresh(node)) {
    await prisma.hostingNodeReference.update({
      where: { id: node.id },
      data: { status: "OFFLINE" },
    });
    return null;
  }
  return toHostingNode(node);
}

export async function requireNodeById(
  providerName: string,
  nodeId: string | null | undefined,
): Promise<HostingNode> {
  const node = await getNodeById(providerName, nodeId);
  if (!node) {
    throw new AppError(
      ErrorCode.NODE_UNAVAILABLE,
      "The website's hosting node is unavailable",
    );
  }
  return node;
}

export async function assertNodeAvailable(
  providerName: string,
): Promise<HostingNode> {
  const node = await chooseNode(providerName);
  if (!node) {
    throw new AppError(ErrorCode.NODE_UNAVAILABLE, "No hosting node available");
  }
  return node;
}

import { PrismaClient, SprintStatus } from "@prisma/client";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env.mjs";
import { filterUserForClient, generateIssuesForClient } from "@/utils/helpers";
import { type UserResource } from "@clerk/types";
import { clerkClient } from "@clerk/nextjs";
import {
  initDefaultIssueComments,
  initDefaultIssues,
  initDefaultSprints,
} from "@/prisma/seed";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(15, "1 m"), // 15 requests per minute
  analytics: true,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function getInitialIssuesFromServer(
  userId: UserResource["id"] | undefined | null
) {
  let activeIssues = await prisma.issue.findMany({
    where: { isDeleted: false, creatorId: userId ?? "init" },
  });

  if (userId && (!activeIssues || activeIssues.length === 0)) {
    // New user, create default issues
    await initDefaultIssues(userId);
    // Create comments for default issues
    await initDefaultIssueComments(userId);

    const newActiveIssues = await prisma.issue.findMany({
      where: {
        creatorId: userId ?? "init",
        isDeleted: false,
      },
    });
    activeIssues = newActiveIssues;
  }

  if (!activeIssues || activeIssues.length === 0) {
    return [];
  }

  const activeSprints = await prisma.sprint.findMany({
    where: {
      status: "ACTIVE",
    },
  });

  const userIds = activeIssues
    .flatMap((issue) => [issue.assigneeId, issue.reporterId] as string[])
    .filter(Boolean);

  // USE THIS IF RUNNING LOCALLY ----------------------
  // const users = await prisma.defaultUser.findMany({
  //   where: {
  //     id: {
  //       in: userIds,
  //     },
  //   },
  // });
  // --------------------------------------------------

  // COMMENT THIS IF RUNNING LOCALLY ------------------
  const users = (
    await clerkClient.users.getUserList({
      userId: userIds,
      limit: 20,
    })
  ).map(filterUserForClient);
  // --------------------------------------------------

  const issues = generateIssuesForClient(
    activeIssues,
    users,
    activeSprints.map((sprint) => sprint.id)
  );
  return issues;
}

export async function getInitialProjectFromServer() {
  const project = await prisma.project.findUnique({
    where: { key: "JIRA-CLONE" },
  });
  return project;
}

export async function getInitialSprintsFromServer(
  userId: UserResource["id"] | undefined
) {
  let sprints = await prisma.sprint.findMany({
    where: {
      OR: [{ status: SprintStatus.ACTIVE }, { status: SprintStatus.PENDING }],
      creatorId: userId ?? "init",
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (userId && (!sprints || sprints.length === 0)) {
    // New user, create default sprints
    await initDefaultSprints(userId);

    const newSprints = await prisma.sprint.findMany({
      where: {
        creatorId: userId,
      },
    });
    sprints = newSprints;
  }
  return sprints;
}

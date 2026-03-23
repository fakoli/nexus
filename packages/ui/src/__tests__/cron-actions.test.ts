/**
 * Tests for packages/ui/src/stores/cron-actions.ts
 *
 * The gateway client and solid-js/store are fully mocked so no WebSocket
 * or reactive context is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CronJob, CronRunHistory } from "../gateway/types";

// ── Shim solid-js/store ───────────────────────────────────────────────────────

const storeState = {
  connection: { status: "disconnected", error: null as string | null },
  cron: { jobs: [] as CronJob[], history: [] as CronRunHistory[] },
};

function setStore(...args: unknown[]): void {
  if (args.length === 3) {
    const section = args[0] as keyof typeof storeState;
    const field = args[1] as string;
    const value = args[2];
    (storeState[section] as Record<string, unknown>)[field] = value;
  }
}

vi.mock("solid-js/store", () => ({
  createStore: (_initial: unknown) => [storeState, setStore],
}));

vi.mock("solid-js", () => ({
  createSignal: (initial: unknown) => {
    let val = initial;
    const getter = () => val;
    const setter = (next: unknown) => {
      val = typeof next === "function" ? (next as (v: unknown) => unknown)(val) : next;
    };
    return [getter, setter];
  },
}));

// ── Mock gateway client ────────────────────────────────────────────────────────

const mockRequest = vi.fn();

vi.mock("../gateway/client", () => ({
  createGatewayClient: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    request: mockRequest,
    onEvent: vi.fn(() => () => {}),
    connected: vi.fn(() => true),
  })),
}));

// Import modules under test AFTER mocks are set up
const {
  loadCronJobs,
  createCronJob,
  deleteCronJob,
  updateCronJob,
  runCronJob,
  loadCronHistory,
} = await import("../stores/cron-actions");

// ── Helpers ───────────────────────────────────────────────────────────────────

const sampleJobs: CronJob[] = [
  {
    id: "job-1",
    name: "Daily summary",
    schedule: "0 9 * * *",
    agentId: "default",
    prompt: "Summarise the day",
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: "job-2",
    name: "Hourly check",
    schedule: "0 * * * *",
    agentId: "default",
    prompt: "Check status",
    enabled: false,
    lastRun: 1000,
    nextRun: 5000,
  },
];

function resetStore(): void {
  storeState.connection.error = null;
  storeState.cron.jobs = [];
  storeState.cron.history = [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadCronJobs", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("populates cron.jobs from payload.jobs", async () => {
    mockRequest.mockResolvedValue({ jobs: sampleJobs });
    await loadCronJobs();
    expect(storeState.cron.jobs).toHaveLength(2);
    expect(storeState.cron.jobs[0].id).toBe("job-1");
    expect(storeState.cron.jobs[1].schedule).toBe("0 * * * *");
  });

  it("sets cron.jobs to empty array when payload.jobs is absent", async () => {
    storeState.cron.jobs = sampleJobs;
    mockRequest.mockResolvedValue({});
    await loadCronJobs();
    expect(storeState.cron.jobs).toHaveLength(0);
  });

  it("calls cron.list on the gateway", async () => {
    mockRequest.mockResolvedValue({ jobs: [] });
    await loadCronJobs();
    expect(mockRequest).toHaveBeenCalledWith("cron.list", {});
  });

  it("stores error message when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("connection refused"));
    await loadCronJobs();
    expect(storeState.connection.error).toBe("connection refused");
  });
});

describe("createCronJob", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    // First call is cron.create, second call is cron.list (from loadCronJobs)
    mockRequest.mockResolvedValue({ jobs: sampleJobs });
  });

  it("calls cron.create with correct params", async () => {
    await createCronJob({
      name: "Test job",
      schedule: "* * * * *",
      agentId: "agent-1",
      prompt: "do something",
      enabled: true,
    });
    expect(mockRequest).toHaveBeenCalledWith("cron.create", expect.objectContaining({
      schedule: "* * * * *",
      agentId: "agent-1",
      message: "do something",
      enabled: true,
    }));
  });

  it("refreshes the jobs list after creation", async () => {
    await createCronJob({
      name: "Test job",
      schedule: "* * * * *",
      agentId: "agent-1",
      prompt: "hello",
      enabled: true,
    });
    // cron.create + cron.list = 2 calls
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenLastCalledWith("cron.list", {});
  });

  it("passes optional id when provided", async () => {
    await createCronJob({
      id: "my-custom-id",
      name: "Named job",
      schedule: "@daily",
      agentId: "default",
      prompt: "run daily",
      enabled: false,
    });
    expect(mockRequest).toHaveBeenCalledWith("cron.create", expect.objectContaining({
      id: "my-custom-id",
    }));
  });

  it("stores error message when cron.create throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("create failed"));
    await createCronJob({
      name: "Fail job",
      schedule: "* * * * *",
      agentId: "default",
      prompt: "fail",
      enabled: true,
    });
    expect(storeState.connection.error).toBe("create failed");
  });
});

describe("deleteCronJob", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ jobs: [] });
  });

  it("calls cron.delete with the given id", async () => {
    await deleteCronJob("job-42");
    expect(mockRequest).toHaveBeenCalledWith("cron.delete", { id: "job-42" });
  });

  it("refreshes the jobs list after deletion", async () => {
    await deleteCronJob("job-1");
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenLastCalledWith("cron.list", {});
  });

  it("stores error message when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("delete failed"));
    await deleteCronJob("job-99");
    expect(storeState.connection.error).toBe("delete failed");
  });
});

describe("updateCronJob", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ jobs: sampleJobs });
  });

  it("calls cron.update with id and schedule", async () => {
    await updateCronJob("job-1", { schedule: "0 0 * * *" });
    expect(mockRequest).toHaveBeenCalledWith("cron.update", expect.objectContaining({
      id: "job-1",
      schedule: "0 0 * * *",
    }));
  });

  it("calls cron.update with enabled flag", async () => {
    await updateCronJob("job-2", { enabled: true });
    expect(mockRequest).toHaveBeenCalledWith("cron.update", expect.objectContaining({
      id: "job-2",
      enabled: true,
    }));
  });

  it("refreshes jobs list after update", async () => {
    await updateCronJob("job-1", { enabled: false });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenLastCalledWith("cron.list", {});
  });

  it("stores error message when update throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("update failed"));
    await updateCronJob("job-1", { schedule: "@daily" });
    expect(storeState.connection.error).toBe("update failed");
  });
});

describe("runCronJob", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
  });

  it("calls cron.run with the given id", async () => {
    await runCronJob("job-1");
    expect(mockRequest).toHaveBeenCalledWith("cron.run", { id: "job-1" });
  });

  it("stores error when cron.run throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("run error"));
    await runCronJob("job-1");
    expect(storeState.connection.error).toBe("run error");
  });
});

describe("loadCronHistory", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  const sampleHistory: CronRunHistory[] = [
    { id: "h-1", jobId: "job-1", startedAt: 100, finishedAt: 200, status: "success", error: null },
    { id: "h-2", jobId: "job-1", startedAt: 300, finishedAt: null, status: "running", error: null },
  ];

  it("populates cron.history from payload.history", async () => {
    mockRequest.mockResolvedValue({ history: sampleHistory });
    await loadCronHistory("job-1");
    expect(storeState.cron.history).toHaveLength(2);
    expect(storeState.cron.history[0].status).toBe("success");
  });

  it("calls cron.history with the jobId", async () => {
    mockRequest.mockResolvedValue({ history: [] });
    await loadCronHistory("job-42");
    expect(mockRequest).toHaveBeenCalledWith("cron.history", { id: "job-42" });
  });

  it("sets history to empty array when payload.history is absent", async () => {
    storeState.cron.history = sampleHistory;
    mockRequest.mockResolvedValue({});
    await loadCronHistory("job-1");
    expect(storeState.cron.history).toHaveLength(0);
  });

  it("stores error message when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("history error"));
    await loadCronHistory("job-1");
    expect(storeState.connection.error).toBe("history error");
  });
});

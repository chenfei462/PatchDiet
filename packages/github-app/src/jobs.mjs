function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function deliveryKey(deliveryId) {
  const value = typeof deliveryId === "string" ? deliveryId.trim() : "";
  return value ? `delivery:${value}` : null;
}

/**
 * In-memory preview job queue — the single job-tracking module for the GitHub
 * App server.
 *
 * Delivery ids are idempotency keys: a webhook redelivery that arrives while the
 * first job remains retained returns the original job instead of enqueueing a
 * second one. A distinct GitHub delivery id represents a later PR event.
 *
 * Finished jobs are pruned once `jobTtlMs` has elapsed and the queue is capped
 * at `maxJobs` entries (oldest first) so long-running processes stay bounded.
 * Both limits default to unlimited for embedders that do not need them.
 */
export class PreviewJobQueue {
  constructor({ now = () => new Date(), maxJobs = Number.POSITIVE_INFINITY, jobTtlMs = Number.POSITIVE_INFINITY } = {}) {
    this.now = now;
    this.maxJobs = maxJobs;
    this.jobTtlMs = jobTtlMs;
    this.jobs = new Map();
    this.dedupeKeys = new Map();
    this.nextId = 1;
  }

  enqueue({ deliveryId = "", owner = "", repo = "", pullNumber = null, installationId = null, headSha = "", run } = {}) {
    const key = deliveryKey(deliveryId);

    if (key) {
      const existingId = this.dedupeKeys.get(key);
      const existingJob = existingId ? this.jobs.get(existingId) : null;
      if (existingJob) {
        return { duplicate: true, job: existingJob };
      }
      this.dedupeKeys.delete(key);
    }

    this.prune();
    if (this.jobs.size >= this.maxJobs) {
      const oldestFinished = Array.from(this.jobs).find(([, job]) => job.status !== "in_flight");
      if (oldestFinished) this.#delete(oldestFinished[0]);
    }
    if (this.jobs.size >= this.maxJobs && Array.from(this.jobs.values()).every((job) => job.status === "in_flight")) {
      throw new Error("Job queue is full");
    }
    const createdAt = toIsoString(this.now());
    const job = {
      id: `preview-${this.nextId++}`,
      status: "in_flight",
      deliveryId: typeof deliveryId === "string" ? deliveryId : "",
      owner,
      repo,
      pullNumber,
      installationId,
      headSha,
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      result: null,
      error: null,
      finishedAtMs: null
    };
    this.jobs.set(job.id, job);
    if (key) {
      this.dedupeKeys.set(key, job.id);
    }

    Promise.resolve()
      .then(() => (typeof run === "function" ? run() : undefined))
      .then(
        (result) => {
          job.result = result ?? null;
          job.status = "completed";
        },
        (error) => {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
        }
      )
      .then(() => {
        job.finishedAt = toIsoString(this.now());
        job.finishedAtMs = this.now().getTime();
      });

    return { duplicate: false, job };
  }

  /**
   * Drop finished jobs older than the TTL, then evict the oldest jobs until the
   * queue fits within `maxJobs`. Callers invoke this after enqueueing; in-flight
   * jobs are never TTL-pruned.
   */
  prune() {
    const nowMs = this.now().getTime();

    for (const [id, job] of this.jobs) {
      if (job.status !== "in_flight" && job.finishedAtMs !== null && nowMs - job.finishedAtMs > this.jobTtlMs) {
        this.#delete(id);
      }
    }

    while (this.jobs.size > this.maxJobs) {
      const oldest = Array.from(this.jobs).find(([, job]) => job.status !== "in_flight");
      if (!oldest) {
        break;
      }
      this.#delete(oldest[0]);
    }
  }

  #delete(id) {
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }
    this.jobs.delete(id);
    for (const [key, jobId] of this.dedupeKeys) {
      if (jobId === id) {
        this.dedupeKeys.delete(key);
      }
    }
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  list() {
    return Array.from(this.jobs.values()).sort((left, right) => numericId(left.id) - numericId(right.id));
  }
}

/**
 * Client-facing view of a job: strips queue-internal bookkeeping fields
 * (`finishedAtMs`) so they never leak through HTTP responses.
 */
export function publicJob(job) {
  if (!job) {
    return null;
  }
  const { finishedAtMs: _finishedAtMs, ...rest } = job;
  return rest;
}

function numericId(id) {
  const value = Number.parseInt(String(id).replace(/^preview-/u, ""), 10);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

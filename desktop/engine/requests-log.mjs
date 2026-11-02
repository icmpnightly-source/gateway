// The most recent requests of the works that asked to be recorded: what came
// in and what left for the destination. Kept in memory, on this computer only;
// it starts empty every time the app does.

const DEFAULT_CAPACITY = 1000;

// Why the gateway turned a request away, as its own answer says ("token",
// "key", "ip", ...); null for any other answer.
function refusalOf(entry) {
  if (entry.answer?.by !== 'gateway' || entry.out.failed || typeof entry.answer.body !== 'string') return null;
  try {
    const { reason } = JSON.parse(entry.answer.body);
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}

export function createRequestsLog(capacity = DEFAULT_CAPACITY) {
  // Oldest first.
  let entries = [];

  return {
    add(entry) {
      entries.push(entry);
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
    },

    /** Newest first, without the headers and bodies: enough for a list. */
    list({ workId, projectId, limit = 200 } = {}) {
      const found = [];
      for (let index = entries.length - 1; index >= 0 && found.length < limit; index -= 1) {
        const entry = entries[index];
        if (workId && entry.workId !== workId) continue;
        if (projectId && entry.projectId !== projectId) continue;

        found.push({
          id: entry.id,
          time: entry.time,
          workId: entry.workId,
          workName: entry.workName,
          projectId: entry.projectId,
          method: entry.in.method,
          url: entry.in.url,
          status: entry.status,
          durationMs: entry.durationMs,
          destination: entry.out.url ?? null,
          failed: entry.out.failed?.reason ?? null,
          // "gateway" when the answer was the gateway's own: a refusal, or
          // word that the destination could not be reached.
          answeredBy: entry.answer?.by ?? null,
          refusal: refusalOf(entry),
        });
      }
      return found;
    },

    find: (id) => entries.find((entry) => entry.id === id),

    clear() {
      entries = [];
    },
  };
}

import { describe, it, expect } from "vitest";
import { checkLiveSession, isUnauthenticatedWriteError, type LiveSessionAuth } from "./liveSession";

const USER = "user-1";

function auth(opts: {
  session?: { user: { id: string } } | null;
  sessionError?: { name?: string; code?: string } | null;
  sessionThrows?: boolean;
  userError?: { name?: string; code?: string } | null;
  userThrows?: boolean;
}): LiveSessionAuth & { getUserCalls: number } {
  const a = {
    getUserCalls: 0,
    async getSession() {
      if (opts.sessionThrows) throw new Error("lock timeout");
      return {
        data: { session: opts.session === undefined ? { user: { id: USER } } : opts.session },
        error: opts.sessionError ?? null,
      };
    },
    async getUser() {
      a.getUserCalls++;
      if (opts.userThrows) throw new TypeError("Load failed");
      return { error: opts.userError ?? null };
    },
  };
  return a;
}

describe("checkLiveSession", () => {
  it("is ok for a live session of the expected user", async () => {
    expect(await checkLiveSession(auth({}), USER)).toBe("ok");
  });

  it("is offline when the refresh failed with a transport error — the anon-fallback case", async () => {
    const a = auth({ session: null, sessionError: { name: "AuthRetryableFetchError" } });
    expect(await checkLiveSession(a, USER)).toBe("offline");
    expect(a.getUserCalls).toBe(0);
  });

  it("is offline when getSession itself throws", async () => {
    expect(await checkLiveSession(auth({ sessionThrows: true }), USER)).toBe("offline");
  });

  it("is dead when the refresh failed definitively", async () => {
    const a = auth({ session: null, sessionError: { name: "AuthApiError", code: "refresh_token_not_found" } });
    expect(await checkLiveSession(a, USER)).toBe("dead");
  });

  it("is dead when nothing is stored at all", async () => {
    expect(await checkLiveSession(auth({ session: null }), USER)).toBe("dead");
  });

  it("is dead when the stored session belongs to another user", async () => {
    expect(await checkLiveSession(auth({ session: { user: { id: "someone-else" } } }), USER)).toBe("dead");
  });

  it("is dead when the server says the session is gone", async () => {
    expect(await checkLiveSession(auth({ userError: { code: "session_not_found" } }), USER)).toBe("dead");
  });

  it("stays ok when getUser fails on the network — the token in hand is usable", async () => {
    expect(await checkLiveSession(auth({ userError: { name: "AuthRetryableFetchError" } }), USER)).toBe("ok");
    expect(await checkLiveSession(auth({ userThrows: true }), USER)).toBe("ok");
  });

  it("stays ok on an unrecognised getUser error", async () => {
    expect(await checkLiveSession(auth({ userError: { code: "unexpected_failure" } }), USER)).toBe("ok");
  });
});

describe("isUnauthenticatedWriteError", () => {
  it("recognises an RLS refusal for the anon role (401)", () => {
    expect(isUnauthenticatedWriteError({ code: "42501" }, 401)).toBe(true);
  });

  it("does not treat an authenticated RLS refusal (403) as a dead session", () => {
    expect(isUnauthenticatedWriteError({ code: "42501" }, 403)).toBe(false);
  });

  it("recognises rejected JWTs", () => {
    expect(isUnauthenticatedWriteError({ code: "PGRST301" }, 401)).toBe(true);
    expect(isUnauthenticatedWriteError({ code: "PGRST302" }, 401)).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isUnauthenticatedWriteError({ code: "P0001" }, 400)).toBe(false);
    expect(isUnauthenticatedWriteError(null, 401)).toBe(false);
    expect(isUnauthenticatedWriteError(undefined)).toBe(false);
  });
});

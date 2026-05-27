import { describe, it, expect } from "vitest";
import { buildSearchUrl } from "../worker/searchUrl.js";

describe("buildSearchUrl", () => {
  it("encodes keywords and location", () => {
    const url = new URL(buildSearchUrl({ keywords: "Backend Engineer", location: "Bangalore", experienceLevel: "", datePosted: "" }));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(url.searchParams.get("keywords")).toBe("Backend Engineer");
    expect(url.searchParams.get("location")).toBe("Bangalore");
  });

  it("adds f_AL=true when easyApplyOnly is set", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "" }, { easyApplyOnly: true }));
    expect(url.searchParams.get("f_AL")).toBe("true");
  });

  it("maps datePosted past-24h to f_TPR=r86400", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "past-24h" }));
    expect(url.searchParams.get("f_TPR")).toBe("r86400");
  });

  it("maps experienceLevel mid-senior to f_E=4", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "mid-senior", datePosted: "" }));
    expect(url.searchParams.get("f_E")).toBe("4");
  });

  it("omits optional params when not provided", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "" }));
    expect(url.searchParams.has("f_TPR")).toBe(false);
    expect(url.searchParams.has("f_E")).toBe(false);
    expect(url.searchParams.has("f_AL")).toBe(false);
  });
});

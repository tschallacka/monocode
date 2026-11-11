import { describe, expect, it } from "vitest";
import { shouldWarnIosurface } from "./iosurfaceWatch";

describe("shouldWarnIosurface", () => {
  it("warns for a count above 4000", () => {
    expect(shouldWarnIosurface(false, 4001)).toBe(true);
  });

  it("does not warn at or below 4000", () => {
    expect(shouldWarnIosurface(false, 4000)).toBe(false);
    expect(shouldWarnIosurface(false, 120)).toBe(false);
  });

  it("does not warn when the count is unavailable", () => {
    expect(shouldWarnIosurface(false, null)).toBe(false);
  });

  it("does not warn again once warned", () => {
    expect(shouldWarnIosurface(true, 5000)).toBe(false);
  });
});

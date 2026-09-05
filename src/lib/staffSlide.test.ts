import { describe, it, expect } from "vitest";
import { routeDepth, slideDirection, slideInitial, slideAnimate, slideExit, SLIDE_DURATION } from "./staffSlide";

describe("routeDepth / slideDirection", () => {
  it("counts path segments, ignoring empty ones", () => {
    expect(routeDepth("/staff")).toBe(1);
    expect(routeDepth("/staff/")).toBe(1);
    expect(routeDepth("/staff/abc")).toBe(2);
    expect(routeDepth("/staff/new")).toBe(2);
  });

  it("opening a member is forward, returning to the roster is back", () => {
    expect(slideDirection("/staff", "/staff/abc")).toBe("forward");
    expect(slideDirection("/staff/abc", "/staff")).toBe("back");
  });

  it("the device back gesture is just a shallower location — it resolves to back with no click handler", () => {
    // popstate delivers the previous location; nothing else distinguishes it
    // from a PUSH, and nothing needs to.
    const afterPop = slideDirection("/staff/abc", "/staff");
    expect(afterPop).toBe("back");
  });

  it("replacing /staff/new with the created id is neither forward nor back", () => {
    expect(slideDirection("/staff/new", "/staff/9f2c")).toBe("none");
  });
});

describe("direction follows the reading direction", () => {
  it("LTR: forward enters from the right edge and back leaves to the right", () => {
    expect(slideInitial({ dir: "forward", isRtl: false, exitScrollY: 0 }).x).toBe("100%");
    expect(slideExit({ dir: "back", isRtl: false, exitScrollY: 0 }).x).toBe("100%");
  });

  it("RTL: forward enters from the LEFT edge and back leaves to the LEFT", () => {
    expect(slideInitial({ dir: "forward", isRtl: true, exitScrollY: 0 }).x).toBe("-100%");
    expect(slideExit({ dir: "back", isRtl: true, exitScrollY: 0 }).x).toBe("-100%");
  });

  it("the page underneath drifts toward the inline start, mirrored per direction", () => {
    expect(slideExit({ dir: "forward", isRtl: false, exitScrollY: 0 }).x).toBe("-30%");
    expect(slideExit({ dir: "forward", isRtl: true, exitScrollY: 0 }).x).toBe("30%");
    expect(slideInitial({ dir: "back", isRtl: false, exitScrollY: 0 }).x).toBe("-30%");
    expect(slideInitial({ dir: "back", isRtl: true, exitScrollY: 0 }).x).toBe("30%");
  });

  it("'none' is a crossfade with no horizontal motion", () => {
    expect(slideInitial({ dir: "none", isRtl: true, exitScrollY: 0 })).toEqual({ x: 0, opacity: 0 });
    expect(slideExit({ dir: "none", isRtl: false, exitScrollY: 0 }).x).toBe(0);
  });
});

describe("layering and scroll pinning", () => {
  it("the moving page is always on top: entering on forward, exiting on back", () => {
    expect(slideAnimate({ dir: "forward", isRtl: false, exitScrollY: 0 }).zIndex).toBe(2);
    expect(slideExit({ dir: "forward", isRtl: false, exitScrollY: 0 }).zIndex).toBe(1);
    expect(slideAnimate({ dir: "back", isRtl: false, exitScrollY: 0 }).zIndex).toBe(1);
    expect(slideExit({ dir: "back", isRtl: false, exitScrollY: 0 }).zIndex).toBe(2);
  });

  it("the exiting page is pinned absolutely at minus the scroll offset, instantly", () => {
    const exit = slideExit({ dir: "back", isRtl: true, exitScrollY: 640 });
    expect(exit.position).toBe("absolute");
    expect(exit.top).toBe(-640);
    expect(exit.transition.top).toEqual({ duration: 0 });
    expect(exit.transition.duration).toBe(SLIDE_DURATION);
  });

  it("the resting page only moves x and opacity; flow position comes from the base style", () => {
    const rest = slideAnimate({ dir: "forward", isRtl: false, exitScrollY: 999 });
    expect(rest.x).toBe(0);
    expect(rest.opacity).toBe(1);
    expect("position" in rest).toBe(false);
    expect("top" in rest).toBe(false);
  });

  it("runs at 220ms", () => {
    expect(SLIDE_DURATION).toBe(0.22);
  });
});

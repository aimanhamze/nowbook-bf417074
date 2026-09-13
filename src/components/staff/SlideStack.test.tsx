// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { SlideStack } from "./SlideStack";

/**
 * Drives the transition shell through a real router history. MemoryRouter's
 * `navigate(-1)` is a POP — the same event the device back gesture produces —
 * so this is the back-gesture path, not the back-arrow path.
 *
 * Framer runs its JS animation driver in jsdom, so the exiting panel is really
 * present with really applied styles for the 220ms of the slide.
 */

let nav: NavigateFunction | null = null;
function NavGrab() {
  nav = useNavigate();
  return null;
}

function Harness({ isRtl, reduceMotion = false }: { isRtl: boolean; reduceMotion?: boolean }) {
  const location = useLocation();
  return (
    <SlideStack pathname={location.pathname} isRtl={isRtl} reduceMotion={reduceMotion}>
      <Routes location={location}>
        <Route path="/staff" element={<div data-page="roster">ROSTER</div>} />
        <Route path="/staff/:id" element={<div data-page="member">MEMBER</div>} />
      </Routes>
    </SlideStack>
  );
}

function mount(isRtl: boolean, reduceMotion = false) {
  return render(
    <MemoryRouter initialEntries={["/staff", "/staff/abc"]} initialIndex={1}>
      <NavGrab />
      <Harness isRtl={isRtl} reduceMotion={reduceMotion} />
    </MemoryRouter>,
  );
}

const panels = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-slide-panel]"));
const translateX = (el: HTMLElement) => {
  const m = /translateX\((-?[\d.]+)%\)/.exec(el.style.transform);
  return m ? Number(m[1]) : null;
};

beforeEach(() => {
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "scrollY", { value: 640, configurable: true, writable: true });
});
afterEach(() => {
  nav = null;
});

describe("SlideStack — device back gesture (POP)", () => {
  it("RTL: the member page is pinned at its scroll offset and slides out to the LEFT, over the roster", async () => {
    const { container } = mount(true);
    expect(panels(container)).toHaveLength(1);

    act(() => nav!(-1)); // popstate: /staff/abc → /staff

    // Both pages are present during the slide; the roster is the new one.
    await waitFor(() => expect(panels(container)).toHaveLength(2));
    const exiting = container.querySelector<HTMLElement>('[data-slide-panel="/staff/abc"]')!;
    const entering = container.querySelector<HTMLElement>('[data-slide-panel="/staff"]')!;
    expect(exiting.textContent).toBe("MEMBER");
    expect(entering.textContent).toBe("ROSTER");

    // Pinned: absolute, lifted by the old scroll offset, on top.
    await waitFor(() => {
      expect(exiting.style.position).toBe("absolute");
      expect(exiting.style.top).toBe("-640px");
      expect(exiting.style.zIndex).toBe("2");
    });
    // The window was scrolled to the top for the entering page.
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

    // Moving toward the inline END, which in RTL is the left: negative translateX.
    await waitFor(() => {
      const x = translateX(exiting);
      expect(x).not.toBeNull();
      expect(x!).toBeLessThan(0);
    });

    // And it is gone once the slide finishes.
    await waitFor(() => expect(panels(container)).toHaveLength(1), { timeout: 2000 });
    expect(panels(container)[0].textContent).toBe("ROSTER");
  });

  it("LTR: the same POP slides the member page out to the RIGHT", async () => {
    const { container } = mount(false);
    act(() => nav!(-1));
    await waitFor(() => expect(panels(container)).toHaveLength(2));
    const exiting = container.querySelector<HTMLElement>('[data-slide-panel="/staff/abc"]')!;
    await waitFor(() => {
      const x = translateX(exiting);
      expect(x).not.toBeNull();
      expect(x!).toBeGreaterThan(0);
    });
    await waitFor(() => expect(panels(container)).toHaveLength(1), { timeout: 2000 });
  });

  it("forward (roster → member) enters from the inline end: from the LEFT in RTL", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/staff"]}>
        <NavGrab />
        <Harness isRtl />
      </MemoryRouter>,
    );
    act(() => nav!("/staff/xyz"));
    await waitFor(() => expect(panels(container)).toHaveLength(2));
    const entering = container.querySelector<HTMLElement>('[data-slide-panel="/staff/xyz"]')!;
    const exiting = container.querySelector<HTMLElement>('[data-slide-panel="/staff"]')!;
    await waitFor(() => {
      const x = translateX(entering);
      expect(x).not.toBeNull();
      expect(x!).toBeLessThan(0); // still travelling in from the left edge
    });
    await waitFor(() => expect(exiting.style.zIndex).toBe("1")); // the old page sits under
    await waitFor(() => expect(panels(container)).toHaveLength(1), { timeout: 2000 });
  });

  it("reduced motion: an instant keyed swap, no panels, no transform", async () => {
    const { container } = mount(true, true);
    expect(panels(container)).toHaveLength(0);
    expect(container.textContent).toBe("MEMBER");
    act(() => nav!(-1));
    expect(container.textContent).toBe("ROSTER");
    expect(panels(container)).toHaveLength(0);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

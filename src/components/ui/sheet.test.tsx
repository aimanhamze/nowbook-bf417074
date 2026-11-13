// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

/**
 * The shared sheet vs the phone keyboard:
 * - opening a sheet never focuses its first field (that pops the keyboard
 *   before the form is seen); the sheet itself takes focus
 * - a bottom sheet is lifted by the part of the layout the keyboard hides
 *   (iOS: VisualViewport shorter than innerHeight) and capped to the visible
 *   height; listeners are removed when it closes
 * - useKeyboardOpen: a focused, still-attached text field on a touch device
 *   AND a keyboard-shortened viewport; re-checked on route changes
 */

vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k }) }));

const { Sheet, SheetContent, SheetTitle, SheetDescription } = await import("./sheet");
const { useKeyboardOpen } = await import("@/hooks/useKeyboardOpen");

class FakeViewport extends EventTarget {
  width = 375;
  height = 800;
  offsetTop = 0;
}
let vv: FakeViewport;

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

function Form({ open = true, autoFocusOnOpen }: { open?: boolean; autoFocusOnOpen?: boolean }) {
  return (
    <Sheet open={open}>
      <SheetContent side="bottom" autoFocusOnOpen={autoFocusOnOpen} data-testid="sheet">
        <SheetTitle>Title</SheetTitle>
        <SheetDescription>Desc</SheetDescription>
        <input aria-label="name" />
      </SheetContent>
    </Sheet>
  );
}

describe("SheetContent and the keyboard", () => {
  it("does not focus the first field on open; the sheet takes focus", () => {
    render(<Form />);
    expect(screen.getByLabelText("name")).not.toHaveFocus();
    expect(screen.getByTestId("sheet")).toHaveFocus();
  });

  it("autoFocusOnOpen keeps Radix's default for a sheet that wants it", () => {
    render(<Form autoFocusOnOpen />);
    expect(screen.getByLabelText("name")).toHaveFocus();
  });

  it("lifts the sheet by the hidden keyboard height and caps it to the visible area", () => {
    render(<Form />);
    const sheet = screen.getByTestId("sheet");
    expect(sheet.style.getPropertyValue("--kb-inset")).toBe("0px");
    act(() => {
      vv.height = 460; // iOS: the keyboard covers 340px, innerHeight unchanged
      vv.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.getPropertyValue("--kb-inset")).toBe("340px");
    expect(sheet.style.getPropertyValue("--vvh")).toBe("460px");
    expect(sheet.className).toContain("bottom-[var(--kb-inset,0px)]");
    expect(sheet.className).toContain("max-h-[calc(var(--vvh,100dvh)*0.92)]");
  });

  it("keeps the focused field in view when the keyboard opens", () => {
    render(<Form />);
    const input = screen.getByLabelText("name");
    act(() => input.focus());
    act(() => {
      vv.height = 460;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(input.scrollIntoView).toHaveBeenCalled();
  });

  it("removes its viewport listeners when it closes", () => {
    const remove = vi.spyOn(vv, "removeEventListener");
    const { rerender } = render(<Form />);
    rerender(<Form open={false} />);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});

describe("useKeyboardOpen (bottom nav / Book bar)", () => {
  const touch = (coarse: boolean) =>
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: coarse }),
    });
  const keyboard = (up: boolean) =>
    act(() => {
      vv.height = up ? 460 : 800;
      vv.dispatchEvent(new Event("resize"));
    });

  function Probe() {
    const open = useKeyboardOpen();
    const navigate = useNavigate();
    return (
      <>
        <output data-testid="open">{String(open)}</output>
        <button onClick={() => navigate("/next")}>go</button>
      </>
    );
  }
  const renderProbe = () =>
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Probe />
      </MemoryRouter>,
    );
  const isOpen = () => screen.getByTestId("open").textContent === "true";

  beforeEach(() => {
    touch(true);
    document.body.innerHTML = "";
  });

  it("needs a focused text field AND a keyboard-shortened viewport", () => {
    const input = document.body.appendChild(document.createElement("input"));
    renderProbe();
    act(() => input.focus());
    expect(isOpen()).toBe(false); // focused, keyboard not up yet
    keyboard(true);
    expect(isOpen()).toBe(true);
    // Android's back button: the keyboard goes, focus stays.
    keyboard(false);
    expect(isOpen()).toBe(false);
    act(() => input.blur());
  });

  it("a focused field REMOVED by a navigation (login) can't leave it stuck", async () => {
    const input = document.body.appendChild(document.createElement("input"));
    renderProbe();
    act(() => input.focus());
    keyboard(true);
    expect(isOpen()).toBe(true);
    // The page unmounts the field: no blur / focusout fires…
    act(() => input.remove());
    // …but the route change re-checks, even before the viewport resizes.
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(isOpen()).toBe(false);
  });

  it("a date picker isn't the keyboard; a mouse device never hides the nav", async () => {
    const date = document.body.appendChild(document.createElement("input"));
    date.type = "date";
    renderProbe();
    act(() => date.focus());
    keyboard(true);
    expect(isOpen()).toBe(false);
    keyboard(false);
    touch(false);
    const text = document.body.appendChild(document.createElement("input"));
    act(() => text.focus());
    keyboard(true);
    expect(isOpen()).toBe(false);
    keyboard(false);
    act(() => text.blur());
  });

  it("without VisualViewport, focus alone decides", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    const input = document.body.appendChild(document.createElement("input"));
    renderProbe();
    act(() => input.focus());
    expect(isOpen()).toBe(true);
    act(() => input.blur());
  });
});

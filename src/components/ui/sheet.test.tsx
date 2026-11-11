// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

/**
 * The shared sheet vs the phone keyboard:
 * - opening a sheet never focuses its first field (that pops the keyboard
 *   before the form is seen); the sheet itself takes focus
 * - a bottom sheet is lifted by the part of the layout the keyboard hides
 *   (iOS: VisualViewport shorter than innerHeight) and capped to the visible
 *   height; listeners are removed when it closes
 * - useKeyboardOpen: a focused text field on a touch device
 */

vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k }) }));

const { Sheet, SheetContent, SheetTitle, SheetDescription } = await import("./sheet");
const { useKeyboardOpen } = await import("@/hooks/useKeyboardOpen");

class FakeViewport extends EventTarget {
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

describe("useKeyboardOpen", () => {
  const touch = (coarse: boolean) =>
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: coarse }),
    });

  it("is true while a text field has focus on a touch device", async () => {
    touch(true);
    document.body.innerHTML = '<input id="t" /><input id="d" type="date" />';
    const { result } = renderHook(() => useKeyboardOpen());
    expect(result.current).toBe(false);
    act(() => (document.getElementById("t") as HTMLInputElement).focus());
    expect(result.current).toBe(true);
    // A date picker isn't the keyboard.
    act(() => (document.getElementById("d") as HTMLInputElement).focus());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(result.current).toBe(false);
  });

  it("stays false on a mouse device", () => {
    touch(false);
    document.body.innerHTML = '<input id="t" />';
    const { result } = renderHook(() => useKeyboardOpen());
    act(() => (document.getElementById("t") as HTMLInputElement).focus());
    expect(result.current).toBe(false);
  });
});



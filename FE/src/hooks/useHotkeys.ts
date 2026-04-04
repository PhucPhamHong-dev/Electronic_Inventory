import { useEffect } from "react";

type HotkeyHandler = (event: KeyboardEvent) => void;

interface HotkeyMap {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: HotkeyHandler;
}

export function useHotkeys(bindings: HotkeyMap[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      bindings.forEach((binding) => {
        const keyMatched = event.key.toLowerCase() === binding.key.toLowerCase();
        const ctrlMatched = (binding.ctrl ?? false) === event.ctrlKey;
        const shiftMatched = (binding.shift ?? false) === event.shiftKey;
        const altMatched = (binding.alt ?? false) === event.altKey;

        if (keyMatched && ctrlMatched && shiftMatched && altMatched) {
          event.preventDefault();
          binding.handler(event);
        }
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [bindings]);
}

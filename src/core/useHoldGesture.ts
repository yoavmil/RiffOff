import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from 'react';

interface Options {
  /** Host is holding (from the player); when it drops, the tracked pointer is forgotten. */
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
}

// How far (px) the finger may wander outside the element before the press is cancelled.
const SLOP = 16;

/** Styles every hold element needs: no scrolling, selection or iOS long-press callout. */
const HOLD_STYLE: CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  WebkitTapHighlightColor: 'transparent',
};

export interface HoldBindings<T extends HTMLElement> {
  ref: RefObject<T>;
  style: CSSProperties;
  'aria-pressed': boolean;
  'aria-disabled': boolean;
  onPointerDown: (e: PointerEvent<T>) => void;
  onPointerUp: (e: PointerEvent<T>) => void;
  onPointerCancel: (e: PointerEvent<T>) => void;
  onLostPointerCapture: (e: PointerEvent<T>) => void;
  onPointerLeave: (e: PointerEvent<T>) => void;
  onPointerMove: (e: PointerEvent<T>) => void;
  onKeyDown: (e: KeyboardEvent<T>) => void;
  onKeyUp: (e: KeyboardEvent<T>) => void;
  onBlur: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
  onDragStart: (e: { preventDefault: () => void }) => void;
}

/**
 * Press-and-hold behaviour for any element: spread the returned bindings on it
 * (`<button {...hold}>`). If the element needs its own `style`, merge it:
 * `style={{ ...hold.style, ...yours }}`.
 *
 * Pointer Events + pointer capture; one pointer at a time. Sliding more than
 * SLOP px off the element, pointercancel or lostpointercapture all release.
 * Space/Enter hold works for keyboards.
 */
export function useHoldGesture<T extends HTMLElement = HTMLButtonElement>({
  active,
  disabled,
  onPress,
  onRelease,
}: Options): HoldBindings<T> {
  const ref = useRef<T>(null);
  const pointerIdRef = useRef<number | null>(null);
  const keyHeldRef = useRef(false);

  const endPress = () => {
    const id = pointerIdRef.current;
    pointerIdRef.current = null;
    keyHeldRef.current = false;
    if (id !== null && ref.current?.hasPointerCapture?.(id)) {
      try {
        ref.current.releasePointerCapture(id);
      } catch {
        /* already released */
      }
    }
    onRelease();
  };

  const onPointerDown = (e: PointerEvent<T>) => {
    if (disabled || pointerIdRef.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no focus ring flash, no text selection, no compat mouse events
    pointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported: pointerleave fallback still works */
    }
    onPress();
  };

  const onPointerEnd = (e: PointerEvent<T>) => {
    if (e.pointerId === pointerIdRef.current) endPress();
  };

  const onPointerMove = (e: PointerEvent<T>) => {
    if (e.pointerId !== pointerIdRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const outside =
      e.clientX < r.left - SLOP || e.clientX > r.right + SLOP || e.clientY < r.top - SLOP || e.clientY > r.bottom + SLOP;
    if (outside) endPress();
  };

  const onKeyDown = (e: KeyboardEvent<T>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || disabled || keyHeldRef.current || pointerIdRef.current !== null) return;
    keyHeldRef.current = true;
    onPress();
  };

  const onKeyUp = (e: KeyboardEvent<T>) => {
    if ((e.key === ' ' || e.key === 'Enter') && keyHeldRef.current) {
      e.preventDefault();
      endPress();
    }
  };

  // iOS: React registers touchstart as passive, so block the long-press
  // callout / magnifier with a native non-passive listener.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', block, { passive: false });
    return () => el.removeEventListener('touchstart', block);
  }, []);

  // If the player dropped the hold on its own (track ended, song changed, app
  // blurred), forget the tracked pointer so the next touch starts a fresh press.
  useEffect(() => {
    if (!active) {
      pointerIdRef.current = null;
      keyHeldRef.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (disabled && (pointerIdRef.current !== null || keyHeldRef.current)) endPress();
  }, [disabled]);

  return {
    ref,
    style: HOLD_STYLE,
    'aria-pressed': active,
    'aria-disabled': disabled,
    onPointerDown,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onPointerLeave: onPointerEnd,
    onPointerMove,
    onKeyDown,
    onKeyUp,
    onBlur: () => {
      if (keyHeldRef.current) endPress();
    },
    onContextMenu: (e) => e.preventDefault(),
    onDragStart: (e) => e.preventDefault(),
  };
}

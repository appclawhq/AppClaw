import React, { useEffect, useRef, useState } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';
import { COLORS } from '../../ui/ink/theme.js';

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** When false the input consumes nothing, freeing the bare arrow keys for whoever else wants them. */
  focus?: boolean;
  showCursor?: boolean;
  placeholder?: string;
}

/** Control characters, which a terminal sends for keys Ink did not decode. Never text. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * The goal prompt's text input.
 *
 * This exists instead of `ink-text-input` for one reason: that component
 * inserts any ctrl chord it does not recognise as a plain letter — ctrl+p types
 * "p" — so a screen holding a focused prompt could not also own keyboard
 * shortcuts. Every ctrl/meta chord below is ignored and left for the screen's
 * own `useInput`, which is what makes ^r/^p/^x work while you are typing a
 * goal. ctrl+c included: TuiApp quits on it, and this must not eat it.
 *
 * Two smaller things it fixes while it is here. The cursor follows a value
 * replaced from outside — history recall and tab completion both rewrite the
 * whole line, and leaving the cursor where it was meant the next character
 * landed in the middle of the recalled text. And arrows, tab and the page keys
 * are left alone, so the screen keeps using them for history, completion and
 * scrolling.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  showCursor = true,
  placeholder = '',
}: PromptInputProps) {
  const [offset, setOffset] = useState(value.length);
  /** The last value this component produced, to tell our own edits from outside ones. */
  const emitted = useRef(value);

  useEffect(() => {
    // A value we did not type — history recall, tab completion, the prompt
    // cleared after submit — puts the cursor at the end, where typing resumes.
    if (value !== emitted.current) {
      emitted.current = value;
      setOffset(value.length);
    }
  }, [value]);

  const cursor = Math.min(offset, value.length);

  function emit(next: string, nextOffset: number): void {
    emitted.current = next;
    setOffset(Math.max(0, Math.min(nextOffset, next.length)));
    if (next !== value) onChange(next);
  }

  useInput(
    (input, key) => {
      // The whole point of this component: chords belong to the screen, not to
      // the text being typed.
      if (key.ctrl || key.meta) return;
      // Arrows, tab and the page keys are the screen's too — history,
      // completion, pane focus, scrolling.
      if (key.upArrow || key.downArrow || key.tab || key.pageUp || key.pageDown) return;

      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.leftArrow) {
        setOffset(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setOffset(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        emit(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
        return;
      }
      if (!input || CONTROL_CHARS.test(input)) return;
      emit(value.slice(0, cursor) + input + value.slice(cursor), cursor + input.length);
    },
    { isActive: focus }
  );

  if (!value && placeholder) {
    return (
      <Text color={COLORS.dimmed}>
        {showCursor && focus ? chalk.inverse(placeholder[0]) + placeholder.slice(1) : placeholder}
      </Text>
    );
  }

  if (!showCursor || !focus) return <Text>{value}</Text>;

  // The cursor is a reversed cell, so it sits past the last character while the
  // line is being appended to — the same shape ink-text-input drew.
  const painted =
    cursor >= value.length
      ? value + chalk.inverse(' ')
      : value.slice(0, cursor) + chalk.inverse(value[cursor]) + value.slice(cursor + 1);

  return <Text>{painted}</Text>;
}

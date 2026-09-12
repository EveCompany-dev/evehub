'use client';

import { strings, WidgetShell } from '@eve/ui';
import { useState, type JSX } from 'react';
import type { WidgetProps } from './types';

type Operator = '+' | '-' | '×' | '÷';

function apply(a: number, b: number, operator: Operator): number {
  switch (operator) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? NaN : a / b;
  }
}

/** No sync, no persistence, no config — just a four-function calculator. */
export function CalculatorWidget({ title, onRemove }: WidgetProps): JSX.Element {
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState<number | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [resetOnDigit, setResetOnDigit] = useState(false);

  const inputDigit = (digit: string) => {
    if (resetOnDigit || display === '0') {
      setDisplay(digit === '.' ? '0.' : digit);
      setResetOnDigit(false);
    } else if (digit === '.' && display.includes('.')) {
      // Ignore a second decimal point.
    } else {
      setDisplay(display + digit);
    }
  };

  const chooseOperator = (next: Operator) => {
    const value = Number(display);

    if (operator && stored !== null && !resetOnDigit) {
      setStored(apply(stored, value, operator));
    } else {
      setStored(value);
    }

    setOperator(next);
    setResetOnDigit(true);
  };

  const equals = () => {
    if (operator === null || stored === null) return;
    const result = apply(stored, Number(display), operator);
    setDisplay(Number.isFinite(result) ? String(result) : 'Erro');
    setStored(null);
    setOperator(null);
    setResetOnDigit(true);
  };

  const clear = () => {
    setDisplay('0');
    setStored(null);
    setOperator(null);
    setResetOnDigit(false);
  };

  const percent = () => setDisplay(String(Number(display) / 100));
  const toggleSign = () => setDisplay(String(Number(display) * -1));

  return (
    <WidgetShell
      title={title}
      status="ok"
      actions={[{ label: strings.dashboard.removeWidget, onSelect: onRemove, danger: true }]}
    >
      <div className="eve-calc eve-no-drag">
        <div className="eve-calc__display">{display}</div>
        <div className="eve-calc__grid">
          <button type="button" className="eve-calc__btn" onClick={clear}>
            C
          </button>
          <button type="button" className="eve-calc__btn" onClick={toggleSign}>
            +/-
          </button>
          <button type="button" className="eve-calc__btn" onClick={percent}>
            %
          </button>
          <button type="button" className="eve-calc__btn eve-calc__btn--op" onClick={() => chooseOperator('÷')}>
            ÷
          </button>

          {['7', '8', '9'].map((digit) => (
            <button key={digit} type="button" className="eve-calc__btn" onClick={() => inputDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className="eve-calc__btn eve-calc__btn--op" onClick={() => chooseOperator('×')}>
            ×
          </button>

          {['4', '5', '6'].map((digit) => (
            <button key={digit} type="button" className="eve-calc__btn" onClick={() => inputDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className="eve-calc__btn eve-calc__btn--op" onClick={() => chooseOperator('-')}>
            −
          </button>

          {['1', '2', '3'].map((digit) => (
            <button key={digit} type="button" className="eve-calc__btn" onClick={() => inputDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className="eve-calc__btn eve-calc__btn--op" onClick={() => chooseOperator('+')}>
            +
          </button>

          <button type="button" className="eve-calc__btn eve-calc__btn--wide" onClick={() => inputDigit('0')}>
            0
          </button>
          <button type="button" className="eve-calc__btn" onClick={() => inputDigit('.')}>
            .
          </button>
          <button type="button" className="eve-calc__btn eve-calc__btn--op eve-calc__btn--equals" onClick={equals}>
            =
          </button>
        </div>
      </div>
    </WidgetShell>
  );
}

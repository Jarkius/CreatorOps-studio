import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { TextAreaField } from './TextAreaField.js';

describe('TextAreaField', () => {
  it('renders a labelled textarea with four rows by default', () => {
    render(<TextAreaField label="Description" />);
    const area = screen.getByLabelText('Description');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('rows', '4');
  });

  it('wires hint and error and forwards the ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<TextAreaField ref={ref} label="Description" hint="Plain text." error="Too long." />);
    const area = screen.getByLabelText('Description');
    expect(area).toHaveAttribute('aria-invalid', 'true');
    expect(area).toHaveAccessibleDescription('Plain text. Too long.');
    expect(ref.current).toBe(area);
  });
});

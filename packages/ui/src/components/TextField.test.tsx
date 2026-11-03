import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { TextField } from './TextField.js';

describe('TextField', () => {
  it('associates a visible label with the input', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name')).toBeInstanceOf(HTMLInputElement);
  });

  it('links the hint through aria-describedby', () => {
    render(<TextField label="Name" hint="Shown to your team." />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAccessibleDescription('Shown to your team.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows the error visibly, marks the input invalid and describes it', () => {
    render(<TextField label="Name" hint="Hint." error="Enter a product name." />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Hint. Enter a product name.');
    expect(screen.getByText('Enter a product name.')).toBeVisible();
  });

  it('uses an explicit id and forwards the ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} id="product-name" label="Name" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('id', 'product-name');
    expect(ref.current).toBe(screen.getByLabelText('Name'));
  });

  it('keeps Thai text intact and wraps it instead of clipping', () => {
    render(<TextField label="Name" defaultValue="พัดลมตั้งโต๊ะ" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('พัดลมตั้งโต๊ะ');
    expect(input.className).toMatch(/overflow-wrap:anywhere/);
  });
});

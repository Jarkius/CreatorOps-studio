import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';

function Harness({
  onConfirm = vi.fn(),
  busy = false,
}: {
  onConfirm?: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Archive
      </button>
      <ConfirmDialog
        open={open}
        title="Archive Lamp?"
        description="It moves to Archived."
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
        busy={busy}
        confirmVariant="danger"
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="T"
        description="D"
        confirmLabel="OK"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is a modal alertdialog labelled by its title and described by its text', () => {
    render(
      <ConfirmDialog
        open
        title="Archive Lamp?"
        description="It moves to Archived."
        confirmLabel="Archive"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Archive Lamp?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('It moves to Archived.');
  });

  it('focuses Cancel when opened', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Escape cancels and focus returns to the opener', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Archive' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('confirm calls onConfirm and does not close by itself', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('shows a busy state, disables both buttons and ignores Escape while busy', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        title="Archive?"
        description="D"
        confirmLabel="Archive"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps Tab focus inside the dialog', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Go"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Go' });
    confirm.focus();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });
});

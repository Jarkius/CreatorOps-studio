import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@creatorops/contracts';
import { Button } from '@creatorops/ui';

import { useDashboard } from '../../app/dashboard-context.js';
import { productKeys } from '../products/productQueries.js';
import { formatBytes, uploadFile, validateFile, ACCEPT_ATTRIBUTE } from './uploadFile.js';
import type { TransportFactory, UploadProgress } from './uploadFile.js';
import { assetKeys } from './assetQueries.js';

/** How many files upload at the same time. The rest wait in the queue. */
export const MAX_CONCURRENT_UPLOADS = 2;

type ItemStatus = 'waiting' | UploadProgress['stage'] | 'done' | 'failed' | 'cancelled';

interface QueueItem {
  readonly id: string;
  readonly file: File;
  readonly status: ItemStatus;
  readonly percent: number;
  /** Set when status is failed: the message to show. */
  readonly error: string | null;
  /** False for files the browser refused before any request (they cannot be retried as they are). */
  readonly canRetry: boolean;
}

export interface UploadPanelProps {
  readonly workspaceId: string;
  /** When set, the files are uploaded for this product and its product data is refreshed. */
  readonly productId?: string;
  /** Test seam: the transport used for the byte upload. Defaults to the browser's XMLHttpRequest. */
  readonly createTransport?: TransportFactory;
}

function statusText(item: QueueItem): string {
  switch (item.status) {
    case 'waiting':
      return 'Waiting';
    case 'preparing':
      return 'Preparing';
    case 'uploading':
      return `Uploading ${item.percent}%`;
    case 'finishing':
      return 'Finishing';
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return `Failed: ${item.error ?? 'The upload failed.'}`;
  }
}

const describeFailure = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The upload failed. Please try again.';

/**
 * Picks files (button, or drag and drop) and uploads them two at a time. Each row shows its
 * progress and status; failed rows can be retried. Completion and failure are announced politely.
 */
export function UploadPanel({ workspaceId, productId, createTransport }: UploadPanelProps) {
  const { client } = useDashboard();
  const queryClient = useQueryClient();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const nextId = useRef(0);

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const startUpload = useCallback(
    (item: QueueItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      update(item.id, { status: 'preparing', percent: 0, error: null });
      const name = item.file.name;
      uploadFile({
        client,
        workspaceId,
        file: item.file,
        ...(productId === undefined ? {} : { productId }),
        signal: controller.signal,
        ...(createTransport === undefined ? {} : { createTransport }),
        onProgress: ({ stage, percent }) => update(item.id, { status: stage, percent }),
      })
        .then(() => {
          update(item.id, { status: 'done', percent: 100 });
          setAnnouncement(`${name} uploaded.`);
          void queryClient.invalidateQueries({ queryKey: assetKeys.lists(workspaceId) });
          if (productId !== undefined) {
            void queryClient.invalidateQueries({
              queryKey: productKeys.detail(workspaceId, productId),
            });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            update(item.id, { status: 'cancelled' });
            setAnnouncement(`${name} upload cancelled.`);
            return;
          }
          const message = describeFailure(error);
          update(item.id, { status: 'failed', error: message, canRetry: true });
          setAnnouncement(`${name} failed: ${message}`);
        })
        .finally(() => {
          controllers.current.delete(item.id);
          // A new array makes the scheduler below run again, so the next waiting file starts.
          setItems((previous) => [...previous]);
        });
    },
    [client, createTransport, productId, queryClient, update, workspaceId],
  );

  // Starts waiting files whenever the queue changes, never more than MAX_CONCURRENT_UPLOADS.
  useEffect(() => {
    for (const item of items) {
      if (controllers.current.size >= MAX_CONCURRENT_UPLOADS) break;
      if (item.status !== 'waiting' || controllers.current.has(item.id)) continue;
      startUpload(item);
    }
  }, [items, startUpload]);

  // Leaving the page cancels whatever is still running.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const added = files.map((file): QueueItem => {
      const id = `upload-${(nextId.current += 1)}`;
      const problem = validateFile(file);
      if (problem === null) {
        return { id, file, status: 'waiting', percent: 0, error: null, canRetry: true };
      }
      // Refused before any request: shown as failed at once, with Remove only.
      setAnnouncement(`${file.name} was not added: ${problem}`);
      return { id, file, status: 'failed', percent: 0, error: problem, canRetry: false };
    });
    setItems((previous) => [...previous, ...added]);
  };

  const remove = (id: string) => {
    controllers.current.get(id)?.abort();
    setItems((previous) => previous.filter((item) => item.id !== id));
  };

  const retry = (id: string) => {
    update(id, { status: 'waiting', percent: 0, error: null });
  };

  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Moving between the zone's own children is not leaving it.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="space-y-4">
      <label htmlFor={inputId} className="sr-only">
        Upload files
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        aria-describedby={hintId}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          // Clearing the value lets the same file be chosen again later.
          event.target.value = '';
        }}
      />

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center leading-relaxed ${
          dragging
            ? 'border-[var(--co-accent)] bg-[var(--co-surface)]'
            : 'border-[var(--co-border)]'
        }`}
      >
        <Button
          variant="secondary"
          aria-describedby={hintId}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <p id={hintId} className="mt-3 text-sm text-[var(--co-text-muted)]">
          Or drop them here. Images (JPEG, PNG, WebP, GIF) up to 15 MB; MP4 videos up to 200 MB.
        </p>
      </div>

      {items.length === 0 ? null : (
        <ul aria-label="Upload queue" className="space-y-3">
          {items.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              onCancel={() => cancel(item.id)}
              onRemove={() => remove(item.id)}
              onRetry={() => retry(item.id)}
            />
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

interface UploadRowProps {
  readonly item: QueueItem;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
}

function UploadRow({ item, onCancel, onRemove, onRetry }: UploadRowProps) {
  const name = item.file.name;
  const cancellable = item.status === 'preparing' || item.status === 'uploading';
  const retryable = item.status === 'cancelled' || (item.status === 'failed' && item.canRetry);
  const removable =
    item.status !== 'preparing' && item.status !== 'uploading' && item.status !== 'finishing';

  return (
    <li className="space-y-2 rounded-lg border border-[var(--co-border)] bg-[var(--co-surface)] p-4 leading-relaxed">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{name}</p>
          <p className="text-sm text-[var(--co-text-muted)]">{formatBytes(item.file.size)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cancellable ? (
            <Button variant="secondary" aria-label={`Cancel ${name}`} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {retryable ? (
            <Button variant="secondary" aria-label={`Retry ${name}`} onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          {removable ? (
            <Button variant="secondary" aria-label={`Remove ${name}`} onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <progress
        value={item.percent}
        max={100}
        aria-label={`Progress for ${name}`}
        className="h-2 w-full"
      />
      <p
        className={
          item.status === 'failed' ? 'text-[var(--co-danger)] [overflow-wrap:anywhere]' : 'text-sm'
        }
      >
        {statusText(item)}
      </p>
    </li>
  );
}

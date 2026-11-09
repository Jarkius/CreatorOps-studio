import type { DraftSections, DraftStatus, Export, Job } from '@creatorops/contracts';

/** Caption plus hashtags, as they are pasted into a post. Thai text is returned as stored. */
export function captionForPost(sections: DraftSections): string {
  const tags = sections.hashtags.join(' ');
  return tags === '' ? sections.caption : `${sections.caption}\n\n${tags}`;
}

export function exportJobText(job: Job): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return 'Building the package…';
    case 'succeeded':
      return 'Package ready';
    case 'failed':
      return job.errorMessage ?? 'The export failed.';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line the user reads before exporting a draft that is not approved. */
export function approvalNote(status: DraftStatus): string | null {
  return status === 'approved'
    ? null
    : 'This draft is not approved yet. You can still export it; the checklist in the package says so.';
}

export function isDownloadable(item: Export, now: number): boolean {
  return item.status === 'ready' && Date.parse(item.expiresAt) > now;
}

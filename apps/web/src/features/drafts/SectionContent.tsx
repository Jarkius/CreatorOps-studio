import type { DraftSections, SectionName } from '@creatorops/contracts';

export function SectionContent({ name, sections }: { name: SectionName; sections: DraftSections }) {
  if (name === 'storyboard') {
    return (
      <ol className="list-decimal space-y-1 pl-6 leading-relaxed">
        {sections.storyboard.map((scene, index) => (
          <li key={`${index}-${scene}`} className="[overflow-wrap:anywhere]">
            {scene}
          </li>
        ))}
      </ol>
    );
  }
  if (name === 'hashtags') {
    if (sections.hashtags.length === 0) {
      return <p className="text-[var(--co-text-muted)]">No hashtags</p>;
    }
    return (
      <ul aria-label="Hashtags" className="flex flex-wrap gap-2">
        {sections.hashtags.map((tag, index) => (
          <li
            key={`${index}-${tag}`}
            className="rounded-full border border-[var(--co-border)] px-2.5 py-0.5 text-sm [overflow-wrap:anywhere]"
          >
            {tag}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{sections[name]}</p>
  );
}

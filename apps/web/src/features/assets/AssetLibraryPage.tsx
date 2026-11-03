import { useParams } from 'react-router';

import { AssetGallery } from './AssetGallery.js';
import { UploadPanel } from './UploadPanel.js';

export function AssetLibraryPage() {
  const { workspaceId = '' } = useParams();
  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold leading-relaxed">Asset library</h1>
      </header>
      <section aria-labelledby="upload-heading" className="space-y-3">
        <h2 id="upload-heading" className="text-base font-semibold">
          Upload
        </h2>
        <UploadPanel workspaceId={workspaceId} />
      </section>
      <section aria-labelledby="files-heading" className="space-y-3">
        <h2 id="files-heading" className="text-base font-semibold">
          Files
        </h2>
        <AssetGallery workspaceId={workspaceId} />
      </section>
    </div>
  );
}

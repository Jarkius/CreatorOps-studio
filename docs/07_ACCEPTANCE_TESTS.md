# 07 — MVP Acceptance Tests

## Product and workspace

- [ ] A user can create a workspace.
- [ ] A user can create, edit, archive, and view a product.
- [ ] Required fields are validated with clear messages.
- [ ] A user cannot access another workspace's products by changing an ID.
- [ ] Product changes appear consistently in web dashboard and extension.

## Media

- [ ] Upload accepts allowed image formats and rejects unsupported/oversized files.
- [ ] MIME type and file signature are validated.
- [ ] Upload progress and failure are visible.
- [ ] User can preview, select primary image, and delete an asset.
- [ ] Private asset URLs expire and are not publicly guessable.

## Content generation

- [ ] User can choose a template and configure language/tone/variant count.
- [ ] Thai text generation works with mock provider.
- [ ] Generated claims are tied to source product facts or marked for review.
- [ ] User can edit each generated section.
- [ ] Regenerating one section does not overwrite unrelated edited sections.
- [ ] Duplicate submissions with the same idempotency key do not create duplicate jobs.

## Jobs

- [ ] Job transitions through valid states.
- [ ] Closing the side panel does not cancel a job.
- [ ] Browser restart does not lose durable job state.
- [ ] Retry is bounded and does not retry permanent failures.
- [ ] User can cancel a cancellable job.
- [ ] Logs do not expose credentials or private signed URLs.

## Assets and export

- [ ] User can filter assets by product/type/status.
- [ ] Draft can attach and detach assets.
- [ ] Export ZIP contains media, caption, hashtags, and checklist.
- [ ] Unauthorized user cannot download another workspace's export.

## Extension

- [ ] Side panel opens through the extension action.
- [ ] Extension requests only permissions needed for implemented features.
- [ ] Extension has useful empty, loading, and error states.
- [ ] Service worker suspension does not lose essential application state.
- [ ] Current-page import is explicitly user-triggered and narrowly scoped.

## Security and compliance

- [ ] Provider secrets exist only server-side and are encrypted at rest.
- [ ] All API routes enforce workspace authorization.
- [ ] No prohibited engagement or evasion features exist.
- [ ] Publishing connectors are disabled unless approved and configured.
- [ ] A publish action (when implemented) requires explicit confirmation and records an audit event.

## Release gate

Do not call the MVP complete until all P0 checks pass, tests run in CI, and the README has reproducible setup instructions.

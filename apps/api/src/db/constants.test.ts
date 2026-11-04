import { CONTENT_LIMITS, JOB_ERROR_CODES as CONTRACT_JOB_ERROR_CODES } from '@creatorops/contracts';
import * as contracts from '@creatorops/contracts';
import { SECTION_LIMITS, SECTION_NAMES } from '@creatorops/provider-core';
import { describe, expect, it } from 'vitest';

import * as schema from './schema.js';

// The same lists live in the database schema, the shared contracts and provider-core. They are
// written down three times on purpose (each package stays independent), so a test keeps them equal.
describe('constants shared by the schema, the contracts and provider-core', () => {
  it('job error codes, types and statuses match between the database and the contracts', () => {
    expect([...schema.JOB_ERROR_CODES]).toEqual([...CONTRACT_JOB_ERROR_CODES]);
    expect([...schema.JOB_TYPES]).toEqual([...contracts.JOB_TYPE_VALUES]);
    expect([...schema.JOB_STATUSES]).toEqual([...contracts.JOB_STATUS_VALUES]);
  });

  it('campaign and draft statuses and platforms match', () => {
    expect([...schema.CAMPAIGN_STATUSES]).toEqual([...contracts.CAMPAIGN_STATUS_VALUES]);
    expect([...schema.DRAFT_STATUSES]).toEqual([...contracts.DRAFT_STATUS_VALUES]);
    expect([...schema.PLATFORMS]).toEqual([...contracts.PLATFORM_VALUES]);
  });

  it('section names and limits match between the contracts and provider-core', () => {
    expect([...SECTION_NAMES]).toEqual([...contracts.SECTION_NAMES]);
    expect(SECTION_LIMITS.title).toBe(CONTENT_LIMITS.sections.title);
    expect(SECTION_LIMITS.hook).toBe(CONTENT_LIMITS.sections.hook);
    expect(SECTION_LIMITS.script).toBe(CONTENT_LIMITS.sections.script);
    expect(SECTION_LIMITS.caption).toBe(CONTENT_LIMITS.sections.caption);
    expect(SECTION_LIMITS.callToAction).toBe(CONTENT_LIMITS.sections.callToAction);
    expect(SECTION_LIMITS.storyboardScene).toBe(CONTENT_LIMITS.sections.scene);
    expect(SECTION_LIMITS.storyboardScenes).toEqual(CONTENT_LIMITS.storyboard);
    expect(SECTION_LIMITS.hashtags.max).toBe(CONTENT_LIMITS.hashtags.count);
    expect(SECTION_LIMITS.hashtags.length).toBe(CONTENT_LIMITS.hashtags.length);
  });
});

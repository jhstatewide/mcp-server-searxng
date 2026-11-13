import nock from 'nock';

import { searchWithFallback, SEARXNG_INSTANCES, resetResilienceState, shouldStartServer, WEB_SEARCH_TOOL } from '../src/index';
import { buildStructuredResponse, formatStructuredSearchResult, isWebSearchArgs } from '../src/utils';
import { truncateDetails, normalizeResultUrl, dedupeResults } from '../src/search-handler';
import { cacheResult, resilienceCacheKey, resilienceCacheSize } from '../src/resilience';
import type { SearxngResponse, StructuredSearchResult, WebSearchParams } from '../src/types';

/**
 * Serves a paged SearXNG response. Page N contains results (N-1)*perPage+1 .. N*perPage.
 * This mirrors a real instance, whose page size is server-configured and unrelated to
 * the caller's max_results.
 */
function mockPagedInstance(origin: string, totalPages = 10, perPage = 10) {
  return nock(origin)
    .persist()
    .post('/search')
    .reply(200, (_uri: string, requestBody: unknown) => {
      const params = new URLSearchParams(String(requestBody));
      const pageno = Number(params.get('pageno') || '1');
      if (pageno > totalPages) {
        return { results: [], number_of_results: totalPages * perPage };
      }
      const start = (pageno - 1) * perPage;
      return {
        results: Array.from({ length: perPage }, (_, i) => ({
          title: `r${start + i + 1}`,
          url: `https://example.com/${start + i + 1}`
        })),
        number_of_results: totalPages * perPage
      };
    });
}

function titles(data: SearxngResponse, params: WebSearchParams) {
  return buildStructuredResponse(data, 'q', params).results.map((r: StructuredSearchResult) => r.title);
}

describe('regressions', () => {
  beforeEach(() => {
    resetResilienceState();
    nock.cleanAll();
    SEARXNG_INSTANCES.length = 0;
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('offset pagination', () => {
    it('returns results 11-20 for offset=10, max_results=10', async () => {
      SEARXNG_INSTANCES.push('https://paged-a');
      mockPagedInstance('https://paged-a');

      const params = { query: 'pagination', offset: 10, max_results: 10 };
      const data = await searchWithFallback(params);

      expect(titles(data, params)).toEqual([
        'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20'
      ]);
    });

    it('returns results 40-43 for the documented offset=39, max_results=4 example', async () => {
      SEARXNG_INSTANCES.push('https://paged-b');
      mockPagedInstance('https://paged-b');

      const params = { query: 'pagination', offset: 39, max_results: 4 };
      const data = await searchWithFallback(params);

      expect(titles(data, params)).toEqual(['r40', 'r41', 'r42', 'r43']);
    });

    it('returns a partial tail when offset+max_results exceeds available results', async () => {
      SEARXNG_INSTANCES.push('https://paged-c');
      mockPagedInstance('https://paged-c', 2, 10); // only 20 results exist

      const params = { query: 'pagination', offset: 15, max_results: 10 };
      const data = await searchWithFallback(params);

      expect(titles(data, params)).toEqual(['r16', 'r17', 'r18', 'r19', 'r20']);
    });

    it('returns an empty list when offset is past the end', async () => {
      SEARXNG_INSTANCES.push('https://paged-d');
      mockPagedInstance('https://paged-d', 2, 10);

      const params = { query: 'pagination', offset: 100, max_results: 5 };
      const data = await searchWithFallback(params);

      expect(titles(data, params)).toEqual([]);
    });
  });

  describe('content_length', () => {
    const data = { results: [{ title: 't', url: 'u', content: 'Some content here.' }] };

    it('treats content_length=0 as metadata only', () => {
      const out = buildStructuredResponse(data, 'q', { content_length: 0 });
      expect(out.results[0].content).toBeUndefined();
    });

    it('never exceeds the requested content_length', () => {
      for (const limit of [1, 2, 3, 5, 10, 20]) {
        const out = formatStructuredSearchResult(
          { title: 't', url: 'u', content: 'Dr. Smith et al. reported e.g. 3 cases.' },
          limit
        );
        expect(out.content!.length).toBeLessThanOrEqual(limit);
      }
    });

    it('does not corrupt abbreviations when truncating', () => {
      const out = formatStructuredSearchResult(
        { title: 't', url: 'u', content: 'Dr. Smith et al. reported e.g. 3 cases.' },
        32
      );
      expect(out.content).not.toContain('e. g.');
      expect(out.content).not.toContain('et. al.');
    });
  });

  describe('total_results', () => {
    it('reports the upstream total, not the number of results on the page', async () => {
      SEARXNG_INSTANCES.push('https://total-a');
      nock('https://total-a')
        .post('/search')
        .reply(200, {
          results: Array.from({ length: 10 }, (_, i) => ({ title: `r${i + 1}`, url: `https://e.com/${i}` })),
          number_of_results: 1234
        });

      const params = { query: 'total', max_results: 3 };
      const data = await searchWithFallback(params);
      const out = buildStructuredResponse(data, 'total', params);

      expect(out.metadata.total_results).toBe(1234);
    });
  });

  describe('cache key', () => {
    it('distinguishes requests whose max_results changes the fetched page', () => {
      const a = resilienceCacheKey({ query: 'q', offset: 10, max_results: 10 });
      const b = resilienceCacheKey({ query: 'q', offset: 10, max_results: 5 });
      expect(a).not.toBe(b);
    });

    it('keeps the cache bounded', () => {
      for (let i = 0; i < 2000; i += 1) {
        cacheResult(`key-${i}`, { results: [] });
      }
      expect(resilienceCacheSize()).toBeLessThanOrEqual(500);
    });
  });

  describe('malformed upstream payloads', () => {
    it('returns empty results with a warning instead of throwing a TypeError', async () => {
      SEARXNG_INSTANCES.push('https://malformed-a');
      nock('https://malformed-a')
        .post('/search')
        .times(4)
        .reply(200, { error: 'no results key here' }, { 'Content-Type': 'application/json' });

      const params = { query: 'malformed', max_results: 2 };
      const data = await searchWithFallback(params);

      expect(data.results).toEqual([]);
      expect(data._resilience.status).toBe('degraded');
      expect(data._resilience.warnings[0].code).toBe('upstream_failure');

      // The whole point: this must not throw.
      expect(() => buildStructuredResponse(data, 'malformed', params)).not.toThrow();
    });
  });

  describe('truncateDetails', () => {
    it('collapses whitespace', () => {
      expect(truncateDetails('a\n\n   b\tc')).toBe('a b c');
    });

    it('truncates long values', () => {
      const out = truncateDetails('x'.repeat(500), 20);
      expect(out.length).toBe(23); // 20 + '...'
    });
  });

  describe('isWebSearchArgs', () => {
    it('rejects an empty or whitespace-only query', () => {
      expect(isWebSearchArgs({ query: '' }).valid).toBe(false);
      expect(isWebSearchArgs({ query: '   ' }).valid).toBe(false);
    });

    it('accepts every category a SearXNG instance exposes', () => {
      // These are real SearXNG categories that the old hardcoded 9-item
      // whitelist rejected outright.
      const instanceCategories = [
        'books', 'packages', 'repos', 'apps', 'software wikis', 'currency',
        'icons', 'weather', 'map', 'dictionaries', 'shopping', 'lyrics',
        'cargo', 'movies', 'translate', 'radio', 'blogs', 'q&a',
        'wikimedia', 'define', 'stock images', 'web', 'other',
        'scientific publications'
      ];

      for (const category of instanceCategories) {
        const result = isWebSearchArgs({ query: 'x', categories: [category] });
        expect({ category, valid: result.valid }).toEqual({ category, valid: true });
      }
    });

    it('still rejects an unknown category', () => {
      expect(isWebSearchArgs({ query: 'x', categories: ['not-a-real-category'] }).valid).toBe(false);
    });
  });

  describe('normalizeResultUrl', () => {
    it('strips fragments, tracking params and a trailing slash', () => {
      expect(normalizeResultUrl('https://ex.com/a/?utm_source=x#frag')).toBe('https://ex.com/a');
    });

    it('keeps non-tracking query parameters', () => {
      expect(normalizeResultUrl('https://ex.com/a?id=5')).toBe('https://ex.com/a?id=5');
    });

    it('falls back to the raw string when unparseable', () => {
      expect(normalizeResultUrl('not a url')).toBe('not a url');
    });
  });

  describe('dedupeResults', () => {
    it('keeps the higher-scored row and unions the engine names', () => {
      const out = dedupeResults([
        { title: 'a', url: 'https://ex.com/x', score: 1, engine: 'alpha' },
        { title: 'b', url: 'https://ex.com/x', score: 5, engine: 'beta' }
      ]);

      expect(out).toHaveLength(1);
      expect(out[0].title).toBe('b');
      expect((out[0].engines ?? []).slice().sort()).toEqual(['alpha', 'beta']);
    });

    it('preserves distinct URLs and their order', () => {
      const out = dedupeResults([
        { title: 'one', url: 'https://ex.com/1' },
        { title: 'two', url: 'https://ex.com/2' }
      ]);
      expect(out.map((r) => r.title)).toEqual(['one', 'two']);
    });
  });

  describe('multi-instance aggregation', () => {
    it('deduplicates identical URLs across instances and keeps the higher score', async () => {
      SEARXNG_INSTANCES.push('https://dup-a', 'https://dup-b');

      nock('https://dup-a').post('/search').reply(200, {
        results: [
          { title: 'Shared (a)', url: 'https://example.com/shared', score: 1, engine: 'alpha' },
          { title: 'Only A', url: 'https://example.com/a-only', score: 2, engine: 'alpha' }
        ]
      });

      nock('https://dup-b').post('/search').reply(200, {
        results: [
          { title: 'Shared (b)', url: 'https://example.com/shared/', score: 9, engine: 'beta' },
          { title: 'Only B', url: 'https://example.com/b-only', score: 1, engine: 'beta' }
        ]
      });

      const data = await searchWithFallback({ query: 'dedup test' });
      const shared = data.results.filter((r) => r.url.replace(/\/$/, '') === 'https://example.com/shared');

      expect(shared).toHaveLength(1);
      // The instance that scored it higher wins the merge.
      expect(shared[0].title).toBe('Shared (b)');
      expect(data.results).toHaveLength(3);
    });

    it('treats tracking params and fragments as the same result', async () => {
      SEARXNG_INSTANCES.push('https://dup-c', 'https://dup-d');

      nock('https://dup-c').post('/search').reply(200, {
        results: [{ title: 'Plain', url: 'https://example.com/x', score: 1 }]
      });
      nock('https://dup-d').post('/search').reply(200, {
        results: [{ title: 'Tracked', url: 'https://example.com/x?utm_source=foo#top', score: 2 }]
      });

      const data = await searchWithFallback({ query: 'dedup tracking' });
      expect(data.results).toHaveLength(1);
    });
  });

  describe('tool schema', () => {
    it('declares the categories parameter that the validator accepts', () => {
      const props = (WEB_SEARCH_TOOL.inputSchema as { properties: Record<string, { type?: string }> }).properties;
      expect(props.categories).toBeDefined();
      expect(props.categories.type).toBe('array');
    });
  });

  describe('shouldStartServer', () => {
    it('starts only when the entry point is this module', () => {
      expect(shouldStartServer('/app/dist/src/index.js', 'file:///app/dist/src/index.js', {})).toBe(true);
    });

    it('does not start when another file named index.js imports the module', () => {
      expect(shouldStartServer('/tmp/other/index.js', 'file:///app/dist/src/index.js', {})).toBe(false);
    });

    it('does not start under test', () => {
      expect(shouldStartServer('/app/dist/src/index.js', 'file:///app/dist/src/index.js', { NODE_ENV: 'test' })).toBe(false);
    });
  });
});

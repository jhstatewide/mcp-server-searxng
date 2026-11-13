import nock from 'nock';

import { searchWithFallback, SEARXNG_INSTANCES, resetResilienceState, shouldStartServer, WEB_SEARCH_TOOL } from '../src/index';
import { buildStructuredResponse, formatStructuredSearchResult, isWebSearchArgs } from '../src/utils';
import { truncateDetails } from '../src/search-handler';
import { cacheResult, resilienceCacheKey, resilienceCacheSize } from '../src/resilience';

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

function titles(data: any, params: any) {
  return buildStructuredResponse(data, 'q', params).results.map((r: any) => r.title);
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
  });

  describe('tool schema', () => {
    it('declares the categories parameter that the validator accepts', () => {
      const props = (WEB_SEARCH_TOOL.inputSchema as any).properties;
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

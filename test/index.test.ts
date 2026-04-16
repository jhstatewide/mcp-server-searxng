import { jest } from '@jest/globals';
import type { Response } from 'node-fetch';
import nock from 'nock';

import { 
  searchWithFallback,
  SEARXNG_INSTANCES
} from '../src/index';
import { 
  formatSearchResult, 
  formatStructuredSearchResult,
  buildStructuredResponse,
  isWebSearchArgs
} from '../src/utils';

describe('SearXNG MCP Server', () => {
  describe('formatSearchResult', () => {
    it('should format complete search result', () => {
      const result = {
        title: 'Test Title',
        url: 'https://example.com',
        content: 'Test content',
        engine: 'google'
      };
      
      expect(formatSearchResult(result)).toBe(
        'Title: Test Title\n' +
        'URL: https://example.com\n' +
        'Content: Test content\n' +
        'Source: google'
      );
    });

    it('should handle missing optional fields', () => {
      const result = {
        title: 'Test Title',
        url: 'https://example.com'
      };
      
      expect(formatSearchResult(result)).toBe(
        'Title: Test Title\n' +
        'URL: https://example.com'
      );
    });
  });

  describe('isWebSearchArgs', () => {
    it('should validate correct search args', () => {
      const args = {
        query: 'test query',
        page: 1,
        language: 'en'
      };
      
      expect(isWebSearchArgs(args).valid).toBe(true);
    });

    it('should reject invalid args', () => {
      expect(isWebSearchArgs(null).valid).toBe(false);
      expect(isWebSearchArgs({}).valid).toBe(false);
      expect(isWebSearchArgs({ query: 123 }).valid).toBe(false);
    });

    it('should validate new parameters', () => {
      // Valid new parameters
      const validArgs = {
        query: 'test query',
        max_results: 20,
        offset: 10,
        content_length: 300
      };
      expect(isWebSearchArgs(validArgs).valid).toBe(true);

      // Invalid max_results
      expect(isWebSearchArgs({ query: 'test', max_results: 0 }).valid).toBe(false);
      expect(isWebSearchArgs({ query: 'test', max_results: 101 }).valid).toBe(false);
      expect(isWebSearchArgs({ query: 'test', max_results: 'invalid' }).valid).toBe(false);

      // Invalid offset
      expect(isWebSearchArgs({ query: 'test', offset: -1 }).valid).toBe(false);
      expect(isWebSearchArgs({ query: 'test', offset: 'invalid' }).valid).toBe(false);

      // Invalid content_length
      expect(isWebSearchArgs({ query: 'test', content_length: -1 }).valid).toBe(false);
      expect(isWebSearchArgs({ query: 'test', content_length: 1001 }).valid).toBe(false);
      expect(isWebSearchArgs({ query: 'test', content_length: 'invalid' }).valid).toBe(false);
    });
  });

  describe('formatStructuredSearchResult', () => {
    it('should format complete structured search result', () => {
      const result = {
        title: 'Test Title',
        url: 'https://example.com',
        content: 'Test content',
        score: 0.85,
        category: 'news',
        engine: 'google',
        publishedDate: '2023-01-01'
      };
      
      const formatted = formatStructuredSearchResult(result);
      expect(formatted.title).toBe('Test Title');
      expect(formatted.url).toBe('https://example.com');
      expect(formatted.content).toBe('Test content');
      expect(formatted.score).toBe(0.85);
      expect(formatted.category).toBe('news');
      expect(formatted.engine).toBe('google');
      expect(formatted.publishedDate).toBe('2023-01-01');
    });

    it('should handle missing optional fields', () => {
      const result = {
        title: 'Test Title',
        url: 'https://example.com'
      };
      
      const formatted = formatStructuredSearchResult(result);
      expect(formatted.title).toBe('Test Title');
      expect(formatted.url).toBe('https://example.com');
      expect(formatted.content).toBeUndefined();
      expect(formatted.score).toBeUndefined();
      expect(formatted.category).toBeUndefined();
    });

    it('should truncate long content', () => {
      const longContent = 'This is a very long content that should be truncated because it exceeds the length limit. It has multiple sentences and should be limited to just a few sentences for better readability. This third sentence should not appear in the result because we only want the first two sentences.';
      const result = {
        title: 'Test Title',
        url: 'https://example.com',
        content: longContent
      };
      
      const formatted = formatStructuredSearchResult(result);
      expect(formatted.content).toBe('This is a very long content that should be truncated because it exceeds the length limit. It has multiple sentences and should be limited to just a few sentences for better readability.');
    });

    it('should map engine to category when category is missing', () => {
      const result = {
        title: 'Test Title',
        url: 'https://example.com',
        engine: 'google'
      };
      
      const formatted = formatStructuredSearchResult(result);
      expect(formatted.category).toBe('google');
      expect(formatted.engine).toBe('google');
    });
  });

  describe('buildStructuredResponse', () => {
    it('should build complete structured response', () => {
      const data = {
        results: [
          {
            title: 'Test Title 1',
            url: 'https://example1.com',
            content: 'Test content 1',
            engine: 'google'
          },
          {
            title: 'Test Title 2',
            url: 'https://example2.com',
            content: 'Test content 2',
            engine: 'bing'
          }
        ],
        number_of_results: 100
      };
      
      const startTime = Date.now() - 1000; // 1 second ago
      const params = { max_results: 10, offset: 0, content_length: 200 };
      const response = buildStructuredResponse(data, 'test query', params, startTime);
      
      expect(response.results).toHaveLength(2);
      expect(response.results[0].title).toBe('Test Title 1');
      expect(response.results[1].title).toBe('Test Title 2');
      expect(response.metadata.query).toBe('test query');
      expect(response.metadata.total_results).toBe(100);
      expect(response.metadata.time_taken).toBeGreaterThan(0);
    });

    it('should handle response without timing', () => {
      const data = {
        results: [
          {
            title: 'Test Title',
            url: 'https://example.com',
            content: 'Test content'
          }
        ]
      };
      
      const params = { max_results: 10, offset: 0, content_length: 200 };
      const response = buildStructuredResponse(data, 'test query', params);
      
      expect(response.results).toHaveLength(1);
      expect(response.metadata.query).toBe('test query');
      expect(response.metadata.total_results).toBe(1);
      expect(response.metadata.time_taken).toBeUndefined();
    });

    it('should handle content_length parameter', () => {
      const longContent = 'This is a very long content that should be truncated. It has multiple sentences and should be limited based on the content_length parameter. This third sentence should not appear if content_length is small enough.';
      const data = {
        results: [
          {
            title: 'Test Title',
            url: 'https://example.com',
            content: longContent
          }
        ]
      };
      
      const params = { max_results: 10, offset: 0, content_length: 100 };
      const response = buildStructuredResponse(data, 'test query', params);
      
      expect(response.results[0].content!.length).toBeLessThanOrEqual(100);
      expect(response.results[0].content).toContain('This is a very long content that should be truncated.');
    });

    it('should handle max_results parameter', () => {
      const data = {
        results: Array.from({ length: 20 }, (_, i) => ({
          title: `Test Title ${i + 1}`,
          url: `https://example${i + 1}.com`,
          content: `Test content ${i + 1}`
        }))
      };
      
      const params = { max_results: 5, offset: 0, content_length: 200 };
      const response = buildStructuredResponse(data, 'test query', params);
      
      expect(response.results).toHaveLength(5);
      expect(response.results[0].title).toBe('Test Title 1');
      expect(response.results[4].title).toBe('Test Title 5');
    });

    it('should handle offset parameter', () => {
      const data = {
        results: Array.from({ length: 20 }, (_, i) => ({
          title: `Test Title ${i + 1}`,
          url: `https://example${i + 1}.com`,
          content: `Test content ${i + 1}`
        }))
      };
      
      const params = { max_results: 5, offset: 10, content_length: 200 };
      const response = buildStructuredResponse(data, 'test query', params);
      
      expect(response.results).toHaveLength(5);
      expect(response.results[0].title).toBe('Test Title 11');
      expect(response.results[4].title).toBe('Test Title 15');
    });

    it('should handle offset with max_results beyond available results', () => {
      const data = {
        results: Array.from({ length: 5 }, (_, i) => ({
          title: `Test Title ${i + 1}`,
          url: `https://example${i + 1}.com`,
          content: `Test content ${i + 1}`
        }))
      };
      
      const params = { max_results: 10, offset: 3, content_length: 200 };
      const response = buildStructuredResponse(data, 'test query', params);
      
      expect(response.results).toHaveLength(2); // Only 2 results after offset 3
      expect(response.results[0].title).toBe('Test Title 4');
      expect(response.results[1].title).toBe('Test Title 5');
    });
  });

  describe('searchWithFallback', () => {
    beforeEach(() => {
      nock.cleanAll();
      SEARXNG_INSTANCES.length = 0;
      SEARXNG_INSTANCES.push('https://instance1', 'https://instance2');
    });

    it('should try multiple instances on failure', async () => {
      // First instance returns 500
      const instance1Scope = nock('https://instance1')
        .post('/search')
        .times(4)
        .reply(500);

      // Second instance returns successful results
      const instance2Scope = nock('https://instance2')
        .post('/search')
        .reply(200, {
          results: [{
            title: 'Test',
            url: 'https://test.com',
            content: 'Test content',
            engine: 'test-engine'
          }]
        });

      const result = await searchWithFallback({
        query: 'test'
      });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(1);
      expect(instance1Scope.isDone()).toBe(true);
      expect(instance2Scope.isDone()).toBe(true);
    });

    it('should handle no results', async () => {
      // Use nock to simulate no results scenario
      nock('https://instance1')
        .post('/search')
        .reply(200, { results: [] });

      nock('https://instance2')
        .post('/search')
        .reply(200, { results: [] });

      await expect(searchWithFallback({
        query: 'test'
      })).rejects.toThrow('All SearXNG instances failed');
    });

    it('should retry transient 500 errors and eventually succeed', async () => {
      SEARXNG_INSTANCES.length = 0;
      SEARXNG_INSTANCES.push('https://instance1');

      nock('https://instance1')
        .post('/search')
        .reply(500, { error: 'temporary failure' })
        .post('/search')
        .reply(500, { error: 'temporary failure' })
        .post('/search')
        .reply(500, { error: 'temporary failure' })
        .post('/search')
        .reply(200, {
          results: [{
            title: 'Recovered Result',
            url: 'https://test.com/recovered',
            content: 'Recovered after retries',
            engine: 'test-engine'
          }]
        });

      const result = await searchWithFallback({ query: 'retry test' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Recovered Result');
    });

    it('should stop after 4 total attempts on persistent 500 errors', async () => {
      SEARXNG_INSTANCES.length = 0;
      SEARXNG_INSTANCES.push('https://instance1');

      nock('https://instance1')
        .post('/search')
        .times(4)
        .reply(500, { error: 'still failing' });

      await expect(searchWithFallback({ query: 'always failing test' })).rejects.toThrow('failed after 4 attempt(s)');
    });

    it('should not retry non-transient 400 errors', async () => {
      SEARXNG_INSTANCES.length = 0;
      SEARXNG_INSTANCES.push('https://instance1');

      nock('https://instance1')
        .post('/search')
        .reply(400, { error: 'bad request' });

      await expect(searchWithFallback({ query: 'bad request test' })).rejects.toThrow('failed after 1 attempt(s)');
    });

    it('should succeed in parallel mode when one instance recovers after retries', async () => {
      nock('https://instance1')
        .post('/search')
        .reply(500, { error: 'temporary failure' })
        .post('/search')
        .reply(500, { error: 'temporary failure' })
        .post('/search')
        .reply(200, {
          results: [{
            title: 'Instance 1 Result',
            url: 'https://instance1-result.com',
            content: 'Recovered in parallel mode',
            engine: 'instance1'
          }]
        });

      nock('https://instance2')
        .post('/search')
        .times(4)
        .reply(500, { error: 'always failing' });

      const result = await searchWithFallback({ query: 'parallel retry test' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Instance 1 Result');
    });

    it('should retry on HTTP 408 and eventually succeed', async () => {
      SEARXNG_INSTANCES.length = 0;
      SEARXNG_INSTANCES.push('https://instance1');

      nock('https://instance1')
        .post('/search')
        .reply(408, { error: 'request timeout' })
        .post('/search')
        .reply(408, { error: 'request timeout' })
        .post('/search')
        .reply(200, {
          results: [{
            title: 'Recovered from 408',
            url: 'https://test.com/408-recovered',
            content: 'Eventually successful',
            engine: 'test-engine'
          }]
        });

      const result = await searchWithFallback({ query: 'retry 408 test' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Recovered from 408');
    });

    it('should honor Retry-After on HTTP 429 responses', async () => {
      const originalAttempts = process.env.SEARXNG_MAX_ATTEMPTS;
      const originalBaseDelay = process.env.SEARXNG_RETRY_BASE_DELAY_MS;
      const originalJitter = process.env.SEARXNG_RETRY_JITTER_MS;
      const originalTimeout = process.env.SEARXNG_REQUEST_TIMEOUT_MS;

      process.env.SEARXNG_MAX_ATTEMPTS = '4';
      process.env.SEARXNG_RETRY_BASE_DELAY_MS = '1';
      process.env.SEARXNG_RETRY_JITTER_MS = '0';
      process.env.SEARXNG_REQUEST_TIMEOUT_MS = '1000';

      try {
        await jest.isolateModulesAsync(async () => {
          const indexModule = await import('../src/index');
          const isolatedInstances = indexModule.SEARXNG_INSTANCES;
          isolatedInstances.length = 0;
          isolatedInstances.push('https://instance-retry-after');

          nock('https://instance-retry-after')
            .post('/search')
            .reply(429, { error: 'rate limited' }, { 'Retry-After': '1' })
            .post('/search')
            .reply(200, {
              results: [{
                title: 'Recovered after Retry-After',
                url: 'https://test.com/retry-after',
                content: 'Rate limit recovered',
                engine: 'test-engine'
              }]
            });

          const startTime = Date.now();
          const result = await indexModule.searchWithFallback({ query: 'retry-after test' });
          const elapsedMs = Date.now() - startTime;

          expect(result.results).toHaveLength(1);
          expect(elapsedMs).toBeGreaterThanOrEqual(900);
        });
      } finally {
        if (originalAttempts === undefined) {
          delete process.env.SEARXNG_MAX_ATTEMPTS;
        } else {
          process.env.SEARXNG_MAX_ATTEMPTS = originalAttempts;
        }

        if (originalBaseDelay === undefined) {
          delete process.env.SEARXNG_RETRY_BASE_DELAY_MS;
        } else {
          process.env.SEARXNG_RETRY_BASE_DELAY_MS = originalBaseDelay;
        }

        if (originalJitter === undefined) {
          delete process.env.SEARXNG_RETRY_JITTER_MS;
        } else {
          process.env.SEARXNG_RETRY_JITTER_MS = originalJitter;
        }

        if (originalTimeout === undefined) {
          delete process.env.SEARXNG_REQUEST_TIMEOUT_MS;
        } else {
          process.env.SEARXNG_REQUEST_TIMEOUT_MS = originalTimeout;
        }
      }
    });

    it('should apply exponential backoff delays between retries', async () => {
      const originalAttempts = process.env.SEARXNG_MAX_ATTEMPTS;
      const originalBaseDelay = process.env.SEARXNG_RETRY_BASE_DELAY_MS;
      const originalJitter = process.env.SEARXNG_RETRY_JITTER_MS;
      const originalTimeout = process.env.SEARXNG_REQUEST_TIMEOUT_MS;

      process.env.SEARXNG_MAX_ATTEMPTS = '4';
      process.env.SEARXNG_RETRY_BASE_DELAY_MS = '20';
      process.env.SEARXNG_RETRY_JITTER_MS = '0';
      process.env.SEARXNG_REQUEST_TIMEOUT_MS = '1000';

      try {
        await jest.isolateModulesAsync(async () => {
          const indexModule = await import('../src/index');
          const isolatedInstances = indexModule.SEARXNG_INSTANCES;
          isolatedInstances.length = 0;
          isolatedInstances.push('https://instance-backoff');

          nock('https://instance-backoff')
            .post('/search')
            .times(4)
            .reply(500, { error: 'always failing' });

          const startTime = Date.now();
          await expect(indexModule.searchWithFallback({ query: 'backoff delay test' })).rejects.toThrow('failed after 4 attempt(s)');
          const elapsedMs = Date.now() - startTime;

          expect(elapsedMs).toBeGreaterThanOrEqual(120);
        });
      } finally {
        if (originalAttempts === undefined) {
          delete process.env.SEARXNG_MAX_ATTEMPTS;
        } else {
          process.env.SEARXNG_MAX_ATTEMPTS = originalAttempts;
        }

        if (originalBaseDelay === undefined) {
          delete process.env.SEARXNG_RETRY_BASE_DELAY_MS;
        } else {
          process.env.SEARXNG_RETRY_BASE_DELAY_MS = originalBaseDelay;
        }

        if (originalJitter === undefined) {
          delete process.env.SEARXNG_RETRY_JITTER_MS;
        } else {
          process.env.SEARXNG_RETRY_JITTER_MS = originalJitter;
        }

        if (originalTimeout === undefined) {
          delete process.env.SEARXNG_REQUEST_TIMEOUT_MS;
        } else {
          process.env.SEARXNG_REQUEST_TIMEOUT_MS = originalTimeout;
        }
      }
    });
  });
}); 

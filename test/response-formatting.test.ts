import { jest } from '@jest/globals';
import nock from 'nock';
import { SearchHandler } from '../src/search-handler';
import { buildStructuredResponse } from '../src/utils';

describe('Tool Response with Special Characters', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should handle search results with special characters in content', () => {
    // This tests the buildStructuredResponse function that converts raw search results
    // into the structured response format that gets JSON.stringify'd
    
    const rawData = {
      results: [
        {
          title: 'Test "quoted" title with !important',
          url: 'https://example.com',
          content: 'This has "double quotes" and !exclamation marks',
          engine: 'test-engine'
        }
      ],
      number_of_results: 1
    };
    
    const structuredResponse = buildStructuredResponse(rawData, 'test "quoted" !important search', {
      max_results: 10,
      offset: 0,
      content_length: 200
    });
    
    // This should not throw any errors
    const jsonString = JSON.stringify(structuredResponse, null, 2);
    
    expect(jsonString).toBeDefined();
    expect(jsonString).toContain('"Test \\"quoted\\" title with !important"');
    expect(jsonString).toContain('"This has \\"double quotes\\" and !exclamation marks"');
  });

  it('should handle complex special characters in search results', () => {
    const rawData = {
      results: [
        {
          title: 'Price: $100! "Special" case',
          url: 'https://example.com',
          content: 'Test with "quotes", !exclamation, and \'single quotes\'',
          engine: 'test-engine',
          score: 0.85,
          category: 'news'
        }
      ],
      number_of_results: 1
    };
    
    const structuredResponse = buildStructuredResponse(rawData, 'complex "quoted" !search', {
      max_results: 10,
      offset: 0,
      content_length: 200
    });
    
    // This should not throw any errors
    const jsonString = JSON.stringify(structuredResponse, null, 2);
    
    expect(jsonString).toBeDefined();
    expect(jsonString).toContain('"Price: $100! \\"Special\\" case"');
    expect(jsonString).toContain('"Test with \\"quotes\\", !exclamation, and \'single quotes\'"');
  });

  it('should work with search handler that returns results with special characters', async () => {
    const handler = new SearchHandler(['https://test-instance']);
    
    // Mock a successful response from SearXNG with special characters in results
    nock('https://test-instance')
      .post('/search', 'q=test+%22quoted%22+%21important+search&pageno=1&language=all&time_range=&safesearch=0&format=json')
      .reply(200, {
        results: [
          {
            title: 'Test "quoted" result',
            url: 'https://example.com',
            content: 'This content has "quotes" and !exclamation marks',
            engine: 'test-engine'
          }
        ],
        number_of_results: 1
      });

    const params = { query: 'test "quoted" !important search', max_results: 10 };
    const result = await handler.search(params);
    
    // This should work without throwing
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Test "quoted" result');
    expect(result.results[0].content).toBe('This content has "quotes" and !exclamation marks');
  });
});

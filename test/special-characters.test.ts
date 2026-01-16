import { jest } from '@jest/globals';
import nock from 'nock';
import { SearchHandler } from '../src/search-handler';

describe('Search Handler Special Characters', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should properly handle query with exclamation mark', async () => {
    const handler = new SearchHandler(['https://test-instance']);
    
    // Mock a successful response from SearXNG
    nock('https://test-instance')
      .post('/search', 'q=test%21+search&pageno=1&language=all&time_range=&safesearch=0&format=json')
      .reply(200, {
        results: [{
          title: 'Test Result',
          url: 'https://example.com',
          content: 'Test content'
        }]
      });

    const params = { query: 'test! search', max_results: 10 };
    const result = await handler.search(params);
    
    expect(result.results).toHaveLength(1);
  });

  it('should properly handle query with double quotes', async () => {
    const handler = new SearchHandler(['https://test-instance']);
    
    // Mock a successful response from SearXNG
    nock('https://test-instance')
      .post('/search', 'q=test+%22quoted%22+search&pageno=1&language=all&time_range=&safesearch=0&format=json')
      .reply(200, {
        results: [{
          title: 'Test Result',
          url: 'https://example.com',
          content: 'Test content'
        }]
      });

    const params = { query: 'test "quoted" search', max_results: 10 };
    const result = await handler.search(params);
    
    expect(result.results).toHaveLength(1);
  });

  it('should properly handle query with both quotes and exclamation', async () => {
    const handler = new SearchHandler(['https://test-instance']);
    
    // Mock a successful response from SearXNG
    nock('https://test-instance')
      .post('/search', 'q=test+%22quoted%22+%21important+search&pageno=1&language=all&time_range=&safesearch=0&format=json')
      .reply(200, {
        results: [{
          title: 'Test Result',
          url: 'https://example.com',
          content: 'Test content'
        }]
      });

    const params = { query: 'test "quoted" !important search', max_results: 10 };
    const result = await handler.search(params);
    
    expect(result.results).toHaveLength(1);
  });
});

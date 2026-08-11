import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResearchDatabase } from './database';
import { buildLiteratureQueries, LiteratureSearchService, type LiteratureFetch } from './literature-search';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('literature search normalization', () => {
  it('deduplicates the same DOI across providers and persists traceable metadata', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-literature-'));
    directories.push(directory);
    const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const projectId = database.createProject({
        name: 'Literature', question: 'Erdos Szekeres convex polygon', goal: '', background: '', knownResults: '', constraints: '', mode: 'literature',
      }).project.id;
      database.saveSettings({
        ...database.getSettings(), literatureProviders: { arxiv: false, crossref: true, openalex: true, 'semantic-scholar': false, web: false },
      });
      const request: LiteratureFetch = async (url) => {
        if (url.includes('crossref')) return {
          status: 200, contentType: 'application/json', body: JSON.stringify({ message: { items: [{
            DOI: '10.1000/example', title: ['A convex polygon theorem'], author: [{ given: 'A', family: 'Author' }],
            published: { 'date-parts': [[2022]] }, 'container-title': ['Geometry Journal'], abstract: '<jats:p>Short abstract.</jats:p>', URL: 'https://doi.org/10.1000/example',
          }] } }),
        };
        return {
          status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{
            id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/example', title: 'A convex polygon theorem', publication_year: 2022,
            primary_location: { landing_page_url: 'https://doi.org/10.1000/example', source: { display_name: 'Geometry Journal' } },
            authorships: [{ author: { display_name: 'A Author' } }], abstract_inverted_index: { Longer: [0], abstract: [1], text: [2] },
          }] }),
        };
      };

      const result = await new LiteratureSearchService(database, request).search(projectId, 'convex polygon theorem');

      expect(result.providerErrors).toEqual([]);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].doi).toBe('10.1000/example');
      expect(result.records[0].verificationStatus).toBe('VERIFIED_METADATA');
      const snapshot = database.getProject(projectId, false);
      expect(snapshot.literature).toHaveLength(1);
      expect(snapshot.sources).toHaveLength(1);
      expect(snapshot.sources[0].url).toBe('https://doi.org/10.1000/example');
      expect(snapshot.literature[0].sourceId).toBe(snapshot.sources[0].id);
    } finally {
      database.close();
    }
  });

  it('returns provider errors without inventing records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-literature-'));
    directories.push(directory);
    const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const projectId = database.createProject({ name: 'Failure', question: 'q', goal: '', background: '', knownResults: '', constraints: '', mode: 'literature' }).project.id;
      database.saveSettings({
        ...database.getSettings(), literatureProviders: { arxiv: false, crossref: true, openalex: false, 'semantic-scholar': false, web: false },
      });
      const result = await new LiteratureSearchService(database, async () => ({ status: 503, contentType: 'text/html', body: '<html>gateway</html>' })).search(projectId, 'rare theorem');
      expect(result.records).toEqual([]);
      expect(result.providerErrors).toEqual([{ provider: 'crossref', message: 'crossref returned HTTP 503.' }]);
      expect(database.getProject(projectId, false).literature).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('creates international query variants for the ES(7) problem', () => {
    expect(buildLiteratureQueries('ES(7) 凸多边形判定')).toContain('Erdos Szekeres convex polygon ES(7)');
  });
});

const liveTest = process.env.MRA_LIVE_LITERATURE === '1' ? it : it.skip;
liveTest('calls a real OpenAlex provider without an API key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mra-literature-live-'));
  directories.push(directory);
  const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
  try {
    const projectId = database.createProject({ name: 'Live', question: 'Erdos Szekeres theorem', goal: '', background: '', knownResults: '', constraints: '', mode: 'literature' }).project.id;
    database.saveSettings({
      ...database.getSettings(), literatureProviders: { arxiv: false, crossref: false, openalex: true, 'semantic-scholar': false, web: false },
    });
    const request: LiteratureFetch = async (url, signal) => {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': 'MathResearchAgent/1.0 integration-test' } });
      return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
    };
    const result = await new LiteratureSearchService(database, request).search(projectId, 'Erdos Szekeres convex polygon theorem');
    expect(result.providerErrors).toEqual([]);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].url || result.records[0].doi).toBeTruthy();
  } finally {
    database.close();
  }
}, 60_000);

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { net } from 'electron';
import { XMLParser } from 'fast-xml-parser';
import type { LiteratureProviderName, LiteratureRecord, LiteratureSearchResult, NoveltyCheck, Source } from '../src/shared/types';
import { lexicalSimilarity } from '../src/shared/retrieval';
import type { ResearchDatabase } from './database';
import { extractDocument } from './document-extractor';
import { buildDocumentChunks } from './document-indexer';

const RESULT_LIMIT = 6;
const REQUEST_TIMEOUT_MS = 45_000;

export interface LiteratureHttpResponse {
  status: number;
  contentType: string;
  body: string;
}

export type LiteratureFetch = (url: string, signal: AbortSignal) => Promise<LiteratureHttpResponse>;

type Candidate = Omit<LiteratureRecord, 'id' | 'projectId' | 'sourceId' | 'query' | 'retrievalTime' | 'verificationStatus' | 'relevanceScore'>;

export class LiteratureSearchService {
  constructor(private readonly database: ResearchDatabase, private readonly request: LiteratureFetch = electronRequest, private readonly fullTextDirectory?: string) {}

  async search(projectId: string, query: string, signal?: AbortSignal): Promise<LiteratureSearchResult> {
    const cleanQuery = query.trim();
    if (!cleanQuery) throw new Error('A literature search query is required.');
    const settings = this.database.getSettings();
    if (settings.literatureSearchMode === 'off') return { queries: [cleanQuery], records: [], providerErrors: [] };
    const queries = buildLiteratureQueries(cleanQuery, settings.searchDomesticSources, settings.searchInternationalSources);
    const providers = enabledProviders(settings.literatureProviders);
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relayAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Literature search timed out.')), REQUEST_TIMEOUT_MS);
    const providerErrors: LiteratureSearchResult['providerErrors'] = [];
    try {
      const jobs = providers.map(async (provider, index) => {
        const variant = queries[index % queries.length];
        try { return await this.searchProvider(provider, variant, controller.signal); }
        catch (error) {
          providerErrors.push({ provider, message: safeError(error) });
          return [];
        }
      });
      const candidates = (await Promise.all(jobs)).flat();
      const ranked = deduplicateCandidates(candidates).map((candidate) => ({
        candidate,
        score: Math.max(0, Math.min(1, lexicalSimilarity(`${candidate.title}\n${candidate.abstract}\n${candidate.authors.join(' ')}`, cleanQuery))),
      })).sort((left, right) => right.score - left.score || (right.candidate.year ?? 0) - (left.candidate.year ?? 0)).slice(0, 30);
      const existing = this.database.getProject(projectId, false);
      const records = ranked.map(({ candidate, score }) => this.persistCandidate(projectId, cleanQuery, candidate, score, existing.literature));
      if (ranked[0] && records[0]) await this.hydrateOpenFullText(projectId, ranked[0].candidate, records[0], controller.signal);
      this.persistNoveltyCheck(projectId, cleanQuery, records, providerErrors.length > 0);
      return { queries, records, providerErrors: dedupeErrors(providerErrors) };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', relayAbort);
    }
  }

  private async searchProvider(provider: LiteratureProviderName, query: string, signal: AbortSignal): Promise<Candidate[]> {
    if (provider === 'arxiv') return this.searchArxiv(query, signal);
    if (provider === 'crossref') return this.searchCrossref(query, signal);
    if (provider === 'openalex') return this.searchOpenAlex(query, signal);
    if (provider === 'semantic-scholar') return this.searchSemanticScholar(query, signal);
    throw new Error('Web literature search is not configured; use a supported scholarly metadata provider.');
  }

  private async searchArxiv(query: string, signal: AbortSignal): Promise<Candidate[]> {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${RESULT_LIMIT}&sortBy=relevance&sortOrder=descending`;
    const response = await checked(() => this.request(url, signal), 'arxiv', signal);
    const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true }).parse(response.body) as { feed?: { entry?: unknown } };
    return asArray<ArxivEntry>(parsed.feed?.entry as ArxivEntry | ArxivEntry[] | undefined).filter((entry) => Boolean(entry.title && entry.id)).map((entry) => {
      const arxivId = String(entry.id).split('/abs/').pop()?.replace(/v\d+$/, '') ?? '';
      const doi = textValue(entry.doi);
      return {
        title: cleanText(textValue(entry.title)), authors: asArray<ArxivAuthor>(entry.author).map((author) => textValue(author.name)).filter(Boolean),
        year: yearFrom(textValue(entry.published)), venue: textValue(entry.journal_ref) || 'arXiv', doi, url: textValue(entry.id), arxivId,
        abstract: cleanText(textValue(entry.summary)), provider: 'arxiv', fullTextUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : '',
      };
    });
  }

  private async searchCrossref(query: string, signal: AbortSignal): Promise<Candidate[]> {
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${RESULT_LIMIT}&select=DOI,title,author,published,container-title,abstract,URL`;
    const response = await checked(() => this.request(url, signal), 'crossref', signal);
    const parsed = parseJson<CrossrefResponse>(response.body, 'crossref');
    return asArray(parsed.message?.items).filter((item) => Boolean(item.title?.[0] && (item.DOI || item.URL))).map((item) => ({
      title: cleanText(item.title?.[0] ?? ''), authors: asArray(item.author).map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
      year: item.published?.['date-parts']?.[0]?.[0] ?? null, venue: item['container-title']?.[0] ?? '', doi: normalizeDoi(item.DOI ?? ''),
      url: item.URL ?? doiUrl(item.DOI ?? ''), arxivId: '', abstract: stripTags(item.abstract ?? ''), provider: 'crossref',
    }));
  }

  private async searchOpenAlex(query: string, signal: AbortSignal): Promise<Candidate[]> {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${RESULT_LIMIT}&select=id,doi,title,publication_year,primary_location,authorships,abstract_inverted_index`;
    const response = await checked(() => this.request(url, signal), 'openalex', signal);
    const parsed = parseJson<OpenAlexResponse>(response.body, 'openalex');
    return asArray(parsed.results).filter((item) => Boolean(item.title && item.id)).map((item) => ({
      title: cleanText(item.title), authors: asArray(item.authorships).map((entry) => entry.author?.display_name ?? '').filter(Boolean),
      year: item.publication_year ?? null, venue: item.primary_location?.source?.display_name ?? '', doi: normalizeDoi(item.doi ?? ''), url: item.doi ?? item.id,
      arxivId: arxivFromUrl(item.primary_location?.landing_page_url ?? ''), abstract: rebuildAbstract(item.abstract_inverted_index), provider: 'openalex', fullTextUrl: item.primary_location?.pdf_url ?? '',
    }));
  }

  private async searchSemanticScholar(query: string, signal: AbortSignal): Promise<Candidate[]> {
    const fields = 'title,authors,year,venue,abstract,url,externalIds,openAccessPdf';
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query.replace(/-/g, ' '))}&limit=${RESULT_LIMIT}&fields=${encodeURIComponent(fields)}`;
    const response = await checked(() => this.request(url, signal), 'semantic-scholar', signal);
    const parsed = parseJson<SemanticScholarResponse>(response.body, 'semantic-scholar');
    return asArray(parsed.data).filter((item) => Boolean(item.title && item.paperId)).map((item) => ({
      title: cleanText(item.title), authors: asArray(item.authors).map((author) => author.name).filter(Boolean), year: item.year ?? null,
      venue: item.venue ?? '', doi: normalizeDoi(item.externalIds?.DOI ?? ''), url: item.url ?? item.openAccessPdf?.url ?? '',
      arxivId: item.externalIds?.ArXiv ?? '', abstract: cleanText(item.abstract ?? ''), provider: 'semantic-scholar', fullTextUrl: item.openAccessPdf?.url ?? '',
    }));
  }

  private persistCandidate(projectId: string, query: string, candidate: Candidate, relevanceScore: number, existing: LiteratureRecord[]): LiteratureRecord {
    const identity = candidateIdentity(candidate);
    const previous = existing.find((record) => candidateIdentity(record) === identity);
    const sourceId = previous?.sourceId ?? randomUUID();
    const retrievalTime = new Date().toISOString();
    const record: LiteratureRecord = {
      ...candidate, id: previous?.id ?? randomUUID(), projectId, sourceId, query, retrievalTime,
      verificationStatus: 'VERIFIED_METADATA', relevanceScore,
    };
    const source: Source = {
      id: sourceId, projectId, type: candidate.arxivId ? 'arxiv' : candidate.doi ? 'journal' : 'paper', title: candidate.title,
      authors: candidate.authors.join(', '), abstract: candidate.abstract, path: candidate.url, tags: ['literature'], notes: '', excerpt: candidate.abstract.slice(0, 4_000),
      documentType: 'abstract', chunkCount: 0, indexStatus: 'unsupported', extractionStatus: 'unsupported', doi: candidate.doi, url: candidate.url,
      arxivId: candidate.arxivId, year: candidate.year, venue: candidate.venue, provider: candidate.provider, retrievalTime,
      literatureVerificationStatus: 'VERIFIED_METADATA', createdAt: previous?.retrievalTime ?? retrievalTime,
    };
    this.database.saveRecord('sources', source);
    this.database.saveRecord('literature', record);
    return record;
  }

  private persistNoveltyCheck(projectId: string, claim: string, records: LiteratureRecord[], incomplete: boolean): void {
    const strongest = records[0]?.relevanceScore ?? 0;
    const status: NoveltyCheck['status'] = strongest >= 0.8 ? 'KNOWN' : records.length > 0 ? 'PARTIALLY_KNOWN' : 'UNKNOWN';
    const check: NoveltyCheck = {
      id: randomUUID(), projectId, claim, status, literatureIds: records.slice(0, 12).map((record) => record.id),
      summary: records.length
        ? `${records.length} traceable metadata records were compared with the claim. This automatic comparison is not proof of novelty.`
        : incomplete ? 'The provider search was incomplete; novelty cannot be assessed.' : 'No matching metadata record was returned; absence of a result is not evidence of novelty.',
      searchedAt: new Date().toISOString(),
    };
    this.database.saveRecord('noveltyChecks', check);
  }

  private async hydrateOpenFullText(projectId: string, candidate: Candidate, record: LiteratureRecord, signal: AbortSignal): Promise<void> {
    if (!this.fullTextDirectory || !candidate.fullTextUrl) return;
    const existing = this.database.getProject(projectId, false).sources.find((source) => source.id === record.sourceId);
    if (!existing || existing.indexStatus === 'indexed') return;
    try {
      const targetUrl = new URL(candidate.fullTextUrl);
      if (targetUrl.protocol !== 'https:') return;
      const response = await net.fetch(targetUrl.toString(), { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: 'follow' });
      if (!response.ok) throw new Error(`Open full text returned HTTP ${response.status}.`);
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== 'https:') throw new Error('Open full text redirected to an unsafe protocol.');
      const declaredSize = Number(response.headers.get('content-length') ?? 0);
      if (declaredSize > 25 * 1024 * 1024) throw new Error('Open full text exceeds the 25 MB indexing limit.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Open full text exceeds the 25 MB indexing limit.');
      if (new TextDecoder('ascii').decode(bytes.slice(0, 4)) !== '%PDF') throw new Error('Open full text was not a PDF.');
      const directory = join(this.fullTextDirectory, projectId);
      mkdirSync(directory, { recursive: true });
      const path = join(directory, `${record.sourceId}.pdf`);
      writeFileSync(path, bytes);
      const extraction = await extractDocument(path);
      const source: Source = {
        ...existing, path, excerpt: extraction.content.slice(0, 4_000), contentHash: extraction.contentHash, contentCharacters: extraction.contentCharacters,
        extractionStatus: extraction.extractionStatus, extractionWarnings: extraction.extractionWarnings, indexedAt: extraction.indexedAt,
        documentType: 'pdf', pageCount: extraction.pageCount, indexStatus: 'indexed', notes: existing.notes,
      };
      const chunks = buildDocumentChunks(source, extraction);
      this.database.replaceDocumentChunks(projectId, source.id, chunks);
      this.database.saveRecord('sources', { ...source, chunkCount: chunks.length });
    } catch (error) {
      if (signal.aborted) return;
      this.database.saveRecord('sources', { ...existing, notes: `Open full-text indexing unavailable: ${safeError(error)}` });
    }
  }
}

export function buildLiteratureQueries(query: string, includeDomestic = true, includeInternational = true): string[] {
  const normalized = cleanText(query).replace(/[?？!！]/g, '');
  const variants = [normalized];
  if (includeInternational && /(?:ES\s*\(?\s*7\s*\)?|Erd[oő]s|Szekeres|\u5384\u591a\u4ec0|\u827e\u5c14\u591a\u65af)/i.test(normalized)) {
    variants.push('Erdos Szekeres convex polygon ES(7)', 'happy ending problem convex position seven points');
  }
  if (includeInternational && /\u51f8\u591a\u8fb9\u5f62|\u51f8\u4f4d\u7f6e/.test(normalized)) variants.push('convex polygon convex position combinatorial geometry');
  if (includeDomestic && /[\u3400-\u9fff]/.test(normalized)) variants.push(normalized.replace(/\s+/g, ' '));
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
}

export function deduplicateCandidates(candidates: Candidate[]): Candidate[] {
  const chosen = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidateIdentity(candidate);
    const current = chosen.get(key);
    if (!current || candidateQuality(candidate) > candidateQuality(current)) chosen.set(key, candidate);
  }
  return [...chosen.values()];
}

async function electronRequest(url: string, signal: AbortSignal): Promise<LiteratureHttpResponse> {
  const response = await net.fetch(url, {
    method: 'GET', signal, redirect: 'follow',
    headers: { Accept: 'application/json, application/atom+xml, application/xml;q=0.9', 'User-Agent': 'MathResearchAgent/1.0 (desktop literature search)' },
  });
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
}

async function checked(request: () => Promise<LiteratureHttpResponse>, provider: LiteratureProviderName, signal: AbortSignal): Promise<LiteratureHttpResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request();
    if (response.status >= 200 && response.status < 300) {
      if (!response.body.trim()) throw new Error(`${provider} returned an empty response.`);
      return response;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`${provider} returned HTTP ${response.status}.`);
    await abortableDelay(400 * 2 ** attempt, signal);
  }
  throw new Error(`${provider} request failed.`);
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('Request aborted.')); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('Request aborted.')); }, { once: true });
  });
}

function parseJson<T>(body: string, provider: string): T {
  try { return JSON.parse(body) as T; }
  catch { throw new Error(`${provider} returned malformed JSON.`); }
}

function candidateIdentity(candidate: Pick<Candidate, 'doi' | 'arxivId' | 'title'>): string {
  if (candidate.doi) return `doi:${normalizeDoi(candidate.doi)}`;
  if (candidate.arxivId) return `arxiv:${candidate.arxivId.toLowerCase().replace(/v\d+$/, '')}`;
  return `title:${candidate.title.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '')}`;
}

function candidateQuality(candidate: Candidate): number {
  return candidate.abstract.length + candidate.authors.length * 50 + (candidate.doi ? 200 : 0) + (candidate.arxivId ? 100 : 0);
}

function enabledProviders(settings: Record<LiteratureProviderName, boolean>): LiteratureProviderName[] {
  return (Object.entries(settings) as Array<[LiteratureProviderName, boolean]>).filter(([, enabled]) => enabled).map(([provider]) => provider);
}

function dedupeErrors(errors: LiteratureSearchResult['providerErrors']): LiteratureSearchResult['providerErrors'] {
  const seen = new Set<string>();
  return errors.filter((error) => { const key = `${error.provider}:${error.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Request was aborted or timed out.';
  return error instanceof Error ? error.message.slice(0, 300) : 'Literature provider request failed.';
}

function cleanText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function stripTags(value: string): string { return cleanText(value.replace(/<[^>]*>/g, ' ')); }
function normalizeDoi(value: string): string { return value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim().toLowerCase(); }
function doiUrl(value: string): string { const doi = normalizeDoi(value); return doi ? `https://doi.org/${doi}` : ''; }
function yearFrom(value: string): number | null { const year = Number(value.slice(0, 4)); return Number.isInteger(year) && year > 1000 ? year : null; }
function arxivFromUrl(value: string): string { return value.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i)?.[1]?.replace(/\.pdf$/i, '').replace(/v\d+$/, '') ?? ''; }
function textValue(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function asArray<T>(value: T | T[] | undefined | null): T[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }

function rebuildAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return cleanText(words.filter(Boolean).join(' '));
}

interface ArxivAuthor { name?: unknown }
interface ArxivEntry { id?: unknown; title?: unknown; summary?: unknown; published?: unknown; author?: ArxivAuthor | ArxivAuthor[]; doi?: unknown; journal_ref?: unknown }
interface CrossrefResponse { message?: { items?: CrossrefItem[] } }
interface CrossrefItem { DOI?: string; title?: string[]; author?: Array<{ given?: string; family?: string }>; published?: { 'date-parts'?: number[][] }; 'container-title'?: string[]; abstract?: string; URL?: string }
interface OpenAlexResponse { results?: OpenAlexItem[] }
interface OpenAlexItem { id: string; doi?: string; title: string; publication_year?: number; primary_location?: { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } }; authorships?: Array<{ author?: { display_name?: string } }>; abstract_inverted_index?: Record<string, number[]> | null }
interface SemanticScholarResponse { data?: SemanticScholarItem[] }
interface SemanticScholarItem { paperId: string; title: string; authors?: Array<{ name: string }>; year?: number; venue?: string; abstract?: string; url?: string; externalIds?: { DOI?: string; ArXiv?: string }; openAccessPdf?: { url?: string } | null }

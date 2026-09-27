/**
 * Zod schemas for raw external API responses. These shapes never leave the `api/` layer:
 * each client maps them into internal models immediately after validation.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- MediaWiki Action API

const pagePropsSchema = z
  .object({
    wikibase_item: z.string().optional(),
    disambiguation: z.string().optional(),
  })
  .loose();

export const mediaWikiPageSchema = z
  .object({
    pageid: z.number().int().optional(),
    ns: z.number().int(),
    title: z.string(),
    missing: z.boolean().optional(),
    invalid: z.boolean().optional(),
    index: z.number().int().optional(),
    pageprops: pagePropsSchema.optional(),
    description: z.string().optional(),
  })
  .loose();

const redirectSchema = z.object({ from: z.string(), to: z.string() }).loose();
const normalizedSchema = z.object({ from: z.string(), to: z.string() }).loose();

const mediaWikiErrorSchema = z.object({ code: z.string(), info: z.string() }).loose();

export const mediaWikiQueryResponseSchema = z
  .object({
    error: mediaWikiErrorSchema.optional(),
    query: z
      .object({
        pages: z.array(mediaWikiPageSchema).optional(),
        redirects: z.array(redirectSchema).optional(),
        normalized: z.array(normalizedSchema).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type MediaWikiQueryResponse = z.infer<typeof mediaWikiQueryResponseSchema>;

const siteMatrixSiteSchema = z
  .object({
    url: z.string(),
    dbname: z.string(),
    code: z.string(),
    closed: z.boolean().optional(),
    private: z.boolean().optional(),
    fishbowl: z.boolean().optional(),
  })
  .loose();

const siteMatrixLanguageSchema = z
  .object({
    code: z.string(),
    localname: z.string().optional(),
    site: z.array(siteMatrixSiteSchema),
  })
  .loose();

export const siteMatrixResponseSchema = z
  .object({
    sitematrix: z.record(z.string(), z.unknown()),
  })
  .loose();

export const siteMatrixLanguageEntrySchema = siteMatrixLanguageSchema;

// ---------------------------------------------------------------- Wikidata

const wikidataTermSchema = z.object({ language: z.string(), value: z.string() }).loose();

export const wikidataEntitySchema = z
  .object({
    id: z.string(),
    missing: z.string().optional(),
    labels: z.record(z.string(), wikidataTermSchema).optional(),
    descriptions: z.record(z.string(), wikidataTermSchema).optional(),
    sitelinks: z
      .record(z.string(), z.object({ site: z.string(), title: z.string() }).loose())
      .optional(),
    redirects: z.object({ from: z.string(), to: z.string() }).loose().optional(),
  })
  .loose();

export const wikidataEntitiesResponseSchema = z
  .object({
    error: mediaWikiErrorSchema.optional(),
    entities: z.record(z.string(), wikidataEntitySchema).optional(),
  })
  .loose();

// ---------------------------------------------------------------- Wikimedia Pageviews (AQS)

const timestampSchema = z.string().regex(/^\d{10}$/, 'expected YYYYMMDDHH timestamp');

export const perArticleResponseSchema = z.object({
  items: z.array(
    z
      .object({
        project: z.string(),
        article: z.string(),
        granularity: z.string(),
        timestamp: timestampSchema,
        access: z.string(),
        agent: z.string(),
        views: z.number(),
      })
      .loose(),
  ),
});

export const aggregateResponseSchema = z.object({
  items: z.array(
    z
      .object({
        project: z.string(),
        granularity: z.string(),
        timestamp: timestampSchema,
        access: z.string(),
        agent: z.string(),
        views: z.number(),
      })
      .loose(),
  ),
});

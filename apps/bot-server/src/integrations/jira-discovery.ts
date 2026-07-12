/**
 * Jira space schema discovery via the createmeta REST endpoints.
 *
 * These endpoints let the bot adapt to whatever the target space actually supports
 * (issue/work types, whether Priority exists and its allowed values, required fields)
 * instead of assuming a fixed schema. Used both at runtime (jira.ts) and by the
 * `jira:doctor` preflight CLI.
 *
 * Endpoints (current, non-deprecated):
 *   GET /rest/api/{v}/issue/createmeta/{projectKey}/issuetypes
 *   GET /rest/api/{v}/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}
 */

export function buildAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

export interface DiscoveryContext {
  host: string;
  auth: string;
  projectKey: string;
  apiVersion: string;
}

export interface RequiredField {
  fieldId: string;
  name: string;
}

export interface IssueTypeMeta {
  id: string;
  name: string;
  hasPriority: boolean;
  priorityAllowedValues: string[];
  hasLabels: boolean;
  hasComponents: boolean;
  /** Required fields the bot does NOT populate by default (excludes project/issuetype/summary/description). */
  requiredFields: RequiredField[];
}

export interface DiscoveryResult {
  /** Metadata for the requested issue type, or null if that type is absent from the space. */
  meta: IssueTypeMeta | null;
  /** All issue/work type names available in the space (for error messages / suggestions). */
  availableTypes: string[];
}

interface Paginated<T> {
  maxResults?: number;
  startAt?: number;
  total?: number;
  /**
   * The array container key varies by endpoint: the createmeta issuetypes endpoint
   * returns `issueTypes`, the per-type fields endpoint returns `fields`. Older/other
   * Jira responses use the generic `values`. Callers read whichever is present.
   */
  values?: T[];
  issueTypes?: T[];
  fields?: T[];
}

interface IssueTypeValue {
  id: string;
  name: string;
}

interface FieldMeta {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
  allowedValues?: Array<{ name?: string; value?: string }>;
}

/** Fields the bot always supplies itself, so a "required" flag on them is not a blocker. */
const SELF_PROVIDED_FIELDS = new Set(['project', 'issuetype', 'summary', 'description']);

async function jiraGet<T>(ctx: DiscoveryContext, path: string): Promise<T> {
  const url = `https://${ctx.host}/rest/api/${ctx.apiVersion}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: ctx.auth, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira GET ${path} failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/** Fetch all issue/work types for the project, following pagination. */
export async function fetchIssueTypes(ctx: DiscoveryContext): Promise<IssueTypeValue[]> {
  const out: IssueTypeValue[] = [];
  let startAt = 0;
  // Bounded loop; Jira caps page size at 50-ish. The +1 guard prevents runaway pagination.
  for (let page = 0; page < 100; page++) {
    const data = await jiraGet<Paginated<IssueTypeValue>>(
      ctx,
      `/issue/createmeta/${encodeURIComponent(ctx.projectKey)}/issuetypes?startAt=${startAt}&maxResults=50`,
    );
    const values = data.issueTypes ?? data.values ?? [];
    out.push(...values.map((v) => ({ id: v.id, name: v.name })));
    startAt += values.length;
    if (values.length === 0 || (data.total !== undefined && startAt >= data.total)) break;
  }
  return out;
}

/** Fetch all field metadata for a specific issue type, following pagination. */
async function fetchIssueTypeFields(ctx: DiscoveryContext, issueTypeId: string): Promise<FieldMeta[]> {
  const out: FieldMeta[] = [];
  let startAt = 0;
  for (let page = 0; page < 100; page++) {
    const data = await jiraGet<Paginated<FieldMeta>>(
      ctx,
      `/issue/createmeta/${encodeURIComponent(ctx.projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?startAt=${startAt}&maxResults=50`,
    );
    const values = data.fields ?? data.values ?? [];
    out.push(...values);
    startAt += values.length;
    if (values.length === 0 || (data.total !== undefined && startAt >= data.total)) break;
  }
  return out;
}

function buildIssueTypeMeta(type: IssueTypeValue, fields: FieldMeta[]): IssueTypeMeta {
  const byId = new Map(fields.map((f) => [f.fieldId, f]));
  const priority = byId.get('priority');

  const requiredFields: RequiredField[] = fields
    .filter((f) => f.required && !f.hasDefaultValue && !SELF_PROVIDED_FIELDS.has(f.fieldId))
    .map((f) => ({ fieldId: f.fieldId, name: f.name }));

  return {
    id: type.id,
    name: type.name,
    hasPriority: !!priority,
    priorityAllowedValues: (priority?.allowedValues ?? [])
      .map((v) => v.name ?? v.value ?? '')
      .filter((n) => n.length > 0),
    hasLabels: byId.has('labels'),
    hasComponents: byId.has('components'),
    requiredFields,
  };
}

/**
 * Discover metadata for the configured issue type. Never throws on an absent type —
 * returns meta: null with the list of available types so callers can report a helpful error.
 * Throws only on connection/auth failures.
 */
export async function discoverIssueType(ctx: DiscoveryContext, issueTypeName: string): Promise<DiscoveryResult> {
  const types = await fetchIssueTypes(ctx);
  const availableTypes = types.map((t) => t.name);

  const match = types.find((t) => t.name.toLowerCase() === issueTypeName.toLowerCase());
  if (!match) {
    return { meta: null, availableTypes };
  }

  const fields = await fetchIssueTypeFields(ctx, match.id);
  return { meta: buildIssueTypeMeta(match, fields), availableTypes };
}

/** Verify credentials by calling /myself. Returns the account's display name/email on success. */
export async function verifyAuth(ctx: DiscoveryContext): Promise<{ displayName: string; email: string }> {
  const me = await jiraGet<{ displayName?: string; emailAddress?: string }>(ctx, '/myself');
  return { displayName: me.displayName ?? '(unknown)', email: me.emailAddress ?? '(hidden)' };
}

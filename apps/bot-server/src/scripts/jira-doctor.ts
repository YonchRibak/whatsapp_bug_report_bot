/**
 * jira:doctor — a preflight that inspects your Jira space and tells you exactly how
 * to configure the bot for it. Run: `pnpm --filter bot-server jira:doctor`
 *
 * Reads Jira env vars directly (via --env-file) so it works even before the rest of
 * the bot's environment is set up. It never creates issues — read-only.
 */

import {
  buildAuthHeader,
  discoverIssueType,
  verifyAuth,
  type DiscoveryContext,
} from '../integrations/jira-discovery.js';
import { DEFAULT_PRIORITY_MAP } from '../integrations/jira-mapping.js';

const OK = '✅';
const WARN = '⚠️ ';
const BAD = '❌';

function line(msg = ''): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function fail(msg: string): never {
  line(`${BAD} ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const issueType = process.env.JIRA_ISSUE_TYPE ?? 'Bug';
  const apiVersion = process.env.JIRA_API_VERSION ?? '3';
  const categoryTarget = process.env.JIRA_CATEGORY_TARGET ?? 'labels';
  const priorityMode = process.env.JIRA_PRIORITY_MODE ?? 'auto';

  line('── Jira Doctor ─────────────────────────────');

  const missing = [
    ['JIRA_HOST', host],
    ['JIRA_EMAIL', email],
    ['JIRA_API_TOKEN', apiToken],
    ['JIRA_PROJECT_KEY', projectKey],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length > 0) {
    line(`${BAD} Missing required env vars: ${missing.join(', ')}`);
    line('');
    line('Set them in apps/bot-server/.env, then re-run. Create an API token at:');
    line('  https://id.atlassian.com/manage-profile/security/api-tokens');
    process.exit(1);
  }

  const ctx: DiscoveryContext = {
    host: host!,
    auth: buildAuthHeader(email!, apiToken!),
    projectKey: projectKey!,
    apiVersion,
  };

  line(`Host:        ${host}`);
  line(`Project:     ${projectKey}`);
  line(`Issue type:  ${issueType}`);
  line(`API version: ${apiVersion}`);
  line('');

  // 1. Auth
  let account: { displayName: string; email: string };
  try {
    account = await verifyAuth(ctx);
    line(`${OK} Authenticated as ${account.displayName} <${account.email}>`);
  } catch (error) {
    fail(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Discover the issue type + its fields
  let result;
  try {
    result = await discoverIssueType(ctx, issueType);
  } catch (error) {
    fail(`Could not read project schema (is JIRA_PROJECT_KEY correct?): ${error instanceof Error ? error.message : String(error)}`);
  }

  const suggestions: string[] = [];

  if (!result.meta) {
    line(`${BAD} Issue type "${issueType}" not found in project ${projectKey}.`);
    line(`   Available types: ${result.availableTypes.join(', ') || '(none)'}`);
    if (result.availableTypes.length > 0) {
      line(`   → Either add a "${issueType}" work type in the space, or set JIRA_ISSUE_TYPE to one of the above.`);
      suggestions.push(`JIRA_ISSUE_TYPE=${result.availableTypes[0]}`);
    }
    line('');
    line('── Fix the issue type, then re-run. ────────');
    process.exit(1);
  }

  const meta = result.meta;
  line(`${OK} Issue type "${meta.name}" found (id ${meta.id})`);
  line('');

  // 3. Priority
  if (meta.hasPriority) {
    line(`${OK} Priority field present. Allowed values: ${meta.priorityAllowedValues.join(', ') || '(not exposed)'}`);
    const mappedNames = Object.values(DEFAULT_PRIORITY_MAP);
    const unmatched = meta.priorityAllowedValues.length
      ? mappedNames.filter((n) => !meta.priorityAllowedValues.some((a) => a.toLowerCase() === n.toLowerCase()))
      : [];
    if (unmatched.length > 0) {
      line(`${WARN}Default priority names not in your space: ${unmatched.join(', ')}`);
      line('   → Provide a JIRA_PRIORITY_MAP that maps severities to YOUR priority names, e.g.:');
      const example = JSON.stringify(
        Object.fromEntries(Object.keys(DEFAULT_PRIORITY_MAP).map((sev) => [sev, meta.priorityAllowedValues[0] ?? 'Medium'])),
      );
      suggestions.push(`JIRA_PRIORITY_MAP=${example}`);
    }
  } else {
    line(`${WARN}No Priority field on this issue type. The bot will omit priority (JIRA_PRIORITY_MODE=auto handles this).`);
    suggestions.push('JIRA_PRIORITY_MODE=auto');
  }
  line('');

  // 4. Category target
  const catOk =
    (categoryTarget === 'labels' && meta.hasLabels) ||
    (categoryTarget === 'components' && meta.hasComponents) ||
    categoryTarget === 'none' ||
    categoryTarget.startsWith('customfield_');
  if (catOk) {
    line(`${OK} Category target "${categoryTarget}" is available.`);
  } else {
    line(`${WARN}Category target "${categoryTarget}" is not available on this issue type.`);
    if (meta.hasLabels) suggestions.push('JIRA_CATEGORY_TARGET=labels');
    else if (meta.hasComponents) suggestions.push('JIRA_CATEGORY_TARGET=components');
    else {
      line('   → No Labels or Components field found. Set JIRA_CATEGORY_TARGET=none or a customfield id.');
      suggestions.push('JIRA_CATEGORY_TARGET=none');
    }
  }
  line('');

  // 5. Required fields the bot doesn't fill
  if (meta.requiredFields.length > 0) {
    line(`${WARN}Required fields the bot does NOT set by default:`);
    for (const f of meta.requiredFields) {
      line(`     • ${f.name} (${f.fieldId})`);
    }
    line('   → Supply these via JIRA_EXTRA_FIELDS, e.g. {"customfield_10050":{"value":"..."}}');
    const example = JSON.stringify(Object.fromEntries(meta.requiredFields.map((f) => [f.fieldId, '<value>'])));
    suggestions.push(`JIRA_EXTRA_FIELDS=${example}`);
  } else {
    line(`${OK} No unhandled required fields — the bot's default payload should be accepted.`);
  }
  line('');

  // Summary
  line('── Suggested .env additions ────────────────');
  if (suggestions.length === 0) {
    line('(none — your space works with the defaults)');
    line('');
    line(`Priority mode is "${priorityMode}", category target is "${categoryTarget}". You're good to go.`);
  } else {
    for (const s of suggestions) line(s);
  }
  line('');
  line('Tip: set JIRA_DRY_RUN=true to log payloads without creating issues while testing.');
}

main().catch((error) => {
  line(`${BAD} Unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});

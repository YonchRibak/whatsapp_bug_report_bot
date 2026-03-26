import { config } from '../config.js';
import { logger } from '../logger.js';

export interface CreateJiraParams {
  title: string;
  description: string | null;
  steps: string[];
  category: string;
  severity: string;
  affectedFeature: string | null;
  screenshotUrl: string | null;
}

const SEVERITY_TO_PRIORITY: Record<string, string> = {
  critical: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}

function buildAdfDescription(description: string | null, steps: string[], affectedFeature: string | null): AdfNode {
  const content: AdfNode[] = [];

  if (description) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: description }],
    });
  }

  if (affectedFeature) {
    content.push(
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Affected feature: ', attrs: { fontWeight: 'bold' } as never },
          { type: 'text', text: affectedFeature },
        ],
      },
    );
  }

  if (steps.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Steps to Reproduce' }],
    });
    content.push({
      type: 'orderedList',
      content: steps.map(step => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: step }] }],
      })),
    });
  }

  // ADF requires at least one content node
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: '(No description provided)' }] });
  }

  return { type: 'doc', attrs: { version: 1 } as never, content };
}

function authHeader(): string {
  const { email, apiToken } = config.jira!;
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

async function attachScreenshot(issueKey: string, screenshotUrl: string): Promise<void> {
  // Download from Supabase public URL
  const imageResponse = await fetch(screenshotUrl);
  if (!imageResponse.ok) {
    logger.warn({ status: imageResponse.status, issueKey, stage: 'jira-attachment' }, 'Failed to download screenshot for Jira attachment');
    return;
  }

  const blob = await imageResponse.blob();
  const formData = new FormData();
  formData.append('file', blob, 'screenshot.png');

  const { host } = config.jira!;
  const response = await fetch(`https://${host}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'X-Atlassian-Token': 'no-check',
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn({ status: response.status, body: text, issueKey, stage: 'jira-attachment' }, 'Failed to attach screenshot to Jira issue');
  }
}

export async function createJiraIssue(params: CreateJiraParams): Promise<string | null> {
  if (!config.jira) return null;

  try {
    const { host, projectKey } = config.jira;

    const body = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Bug' },
        summary: params.title,
        description: buildAdfDescription(params.description, params.steps, params.affectedFeature),
        priority: { name: SEVERITY_TO_PRIORITY[params.severity] ?? 'Medium' },
        labels: [params.category],
      },
    };

    const response = await fetch(`https://${host}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, body: text, stage: 'jira' }, 'Jira issue creation failed');
      return null;
    }

    const data = (await response.json()) as { key: string };
    logger.info({ jiraKey: data.key, stage: 'jira' }, 'Jira issue created');

    // Attach screenshot (non-fatal)
    if (params.screenshotUrl) {
      try {
        await attachScreenshot(data.key, params.screenshotUrl);
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : error, jiraKey: data.key, stage: 'jira-attachment' }, 'Failed to attach screenshot');
      }
    }

    return data.key;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : error, stage: 'jira' }, 'Jira integration failed');
    return null;
  }
}

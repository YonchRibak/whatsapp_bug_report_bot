CREATE TABLE issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT now(),

  -- WhatsApp metadata
  wa_message_id   TEXT UNIQUE NOT NULL,
  sender_jid      TEXT NOT NULL,
  sender_name     TEXT,
  raw_text        TEXT,
  screenshot_url  TEXT,

  -- AI triage output
  category        TEXT NOT NULL CHECK (category IN (
                    'bug', 'ux_issue', 'feature_request', 'question', 'other'
                  )),
  title           TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  description     TEXT,
  steps           JSONB DEFAULT '[]',
  affected_feature TEXT,
  confidence      FLOAT,

  -- Workflow
  status          TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix')),
  notes           TEXT
);

ALTER PUBLICATION supabase_realtime ADD TABLE issues;

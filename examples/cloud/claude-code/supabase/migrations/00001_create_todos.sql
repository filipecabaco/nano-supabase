CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own todos"
  ON todos FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own todos"
  ON todos FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own todos"
  ON todos FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own todos"
  ON todos FOR DELETE
  USING (user_id = auth.uid());

ALTER TABLE candidate_screens
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'excluded', 'merged')),
  ADD COLUMN screen_title text,
  ADD COLUMN screen_notes text,
  ADD COLUMN merged_into_id uuid REFERENCES candidate_screens(id),
  ADD COLUMN reviewed_at timestamptz;

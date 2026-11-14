-- btree_gist for the academy feature (feat/academy-courses).
--
-- Needed by academy_course_sessions (migration 3): an EXCLUDE USING gist
-- constraint on (instructor_id WITH =, period WITH &&) mixes a uuid equality
-- with a range overlap, and plain GiST has no operator class for uuid `=`.
--
-- Installed in the `extensions` schema, where pgcrypto / uuid-ossp / pg_net
-- already live on this project. Nothing references it until migration 3.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 0003: lets a teacher view a student's code in the roster.
-- Additive only. code_enc holds the code encrypted with the CODE_ENC_KEY secret
-- (AES-GCM); it is NULL for students created before this change.
ALTER TABLE students ADD COLUMN code_enc TEXT;

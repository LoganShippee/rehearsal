-- Raise the default student limit from 200 to 300 for teachers still on the old default.
-- Data-only change: no tables or columns are dropped or altered.
UPDATE teachers SET student_soft_cap = 300 WHERE student_soft_cap = 200;

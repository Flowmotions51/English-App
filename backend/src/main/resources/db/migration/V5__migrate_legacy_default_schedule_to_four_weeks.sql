-- Replace auto-created legacy default (1h, 3h, 6h, 1d, 2d, 1w) with the new ladder
-- (1d, 2d, 1w, 4w). Open-ended tail spacing is handled in Java (28-day repeats).
-- Only templates whose steps match the legacy sequence exactly are updated; custom schedules are left unchanged.

DO $$
DECLARE
    tid BIGINT;
BEGIN
    FOR tid IN
        SELECT schedule_template_id
        FROM (
            SELECT schedule_template_id,
                   array_agg(offset_minutes ORDER BY step_order) AS steps
            FROM sentence_schedule_steps
            GROUP BY schedule_template_id
        ) x
        WHERE steps = ARRAY[60, 180, 360, 1440, 2880, 10080]::integer[]
    LOOP
        DELETE FROM sentence_schedule_steps WHERE schedule_template_id = tid;
        INSERT INTO sentence_schedule_steps (schedule_template_id, step_order, offset_minutes)
        VALUES
            (tid, 0, 1440),
            (tid, 1, 2880),
            (tid, 2, 10080),
            (tid, 3, 40320);
        UPDATE schedule_templates SET updated_at = NOW() WHERE id = tid;
    END LOOP;
END $$;

-- The follow-up flag filters on follow_up_date <= today (PRD, "List filters at scale").
CREATE INDEX "lots_follow_up_date_idx" ON "lots"("follow_up_date");

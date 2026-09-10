-- provider_class_schedule had RLS ENABLED with ZERO policies, making it
-- deny-all to every client: customers could not read classes and providers
-- could not create them (useProviderClassSchedule.ts insert/update/delete all
-- failed). The fitness-studio booking flow could never work on DEV.
--
-- NOT part of the membership/packages work — this repairs a pre-existing DEV
-- parity gap left over from how DEV was rebuilt on 2026-08-28.
--
-- Applied to DEV as migration `provider_class_schedule_rls_policies`.

-- Customers browsing a fitness studio's weekly classes.
CREATE POLICY "Anyone can view active class schedule"
  ON provider_class_schedule FOR SELECT USING (is_active = true);

-- The provider managing their own classes. FOR ALL so insert/update/delete
-- from the class-schedule tab work; without this the table stays empty no
-- matter what the read policy allows.
CREATE POLICY "Provider manages own class schedule"
  ON provider_class_schedule FOR ALL USING (
    provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid())
  );

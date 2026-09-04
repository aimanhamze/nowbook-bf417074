-- Membership / package system — Phase 1, migration 7 of 8.
--
-- Templates are publicly readable so customers can browse offers.
-- customer_packages is READ by the customer, WRITTEN only by the provider —
-- a customer write path here would be a free-entry button.
-- package_usage_log has SELECT policies ONLY. No insert/update/delete policy
-- exists by design: rows come exclusively from the SECURITY DEFINER triggers.
ALTER TABLE package_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_usage_log ENABLE ROW LEVEL SECURITY;

-- package_templates
CREATE POLICY "Anyone can view active templates" ON package_templates
  FOR SELECT USING (is_active = true);

CREATE POLICY "Provider manages own templates" ON package_templates
  FOR ALL USING (
    provider_id IN (
      SELECT id FROM provider_profiles WHERE user_id = auth.uid()
    )
  );

-- customer_packages
CREATE POLICY "Customer views own packages" ON customer_packages
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "Provider views own customer packages" ON customer_packages
  FOR SELECT USING (
    provider_id IN (
      SELECT id FROM provider_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Provider manages own customer packages" ON customer_packages
  FOR ALL USING (
    provider_id IN (
      SELECT id FROM provider_profiles WHERE user_id = auth.uid()
    )
  );

-- package_usage_log
CREATE POLICY "Customer views own usage log" ON package_usage_log
  FOR SELECT USING (
    customer_package_id IN (
      SELECT id FROM customer_packages WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY "Provider views own usage log" ON package_usage_log
  FOR SELECT USING (
    customer_package_id IN (
      SELECT id FROM customer_packages
      WHERE provider_id IN (
        SELECT id FROM provider_profiles WHERE user_id = auth.uid()
      )
    )
  );

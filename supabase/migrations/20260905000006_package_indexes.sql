-- Membership / package system — Phase 1, migration 6 of 8.
CREATE INDEX ON package_templates(provider_id);
CREATE INDEX ON customer_packages(customer_id);
CREATE INDEX ON customer_packages(provider_id);
CREATE INDEX ON customer_packages(status);
CREATE INDEX ON package_usage_log(customer_package_id);
CREATE INDEX ON package_usage_log(booking_id);
CREATE INDEX ON bookings(customer_package_id);

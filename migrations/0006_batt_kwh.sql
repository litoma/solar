-- 蓄電池の実容量 (batt_cap_kwh) と実測残電力量 (batt_kwh) を minute_samples に追加
ALTER TABLE minute_samples ADD COLUMN batt_kwh REAL;
ALTER TABLE minute_samples ADD COLUMN batt_cap_kwh REAL;

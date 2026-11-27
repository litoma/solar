-- 2026-10-28 〜 2026-11-15 の未記録・途中開始期間について、実測(2026-11-16〜27)・練馬区太陽軌道・Open-Meteo時間別日射量モデルから
-- 日別実績 solar_kwh と一致するよう算出した PV1〜PV4 推定値を daily_summary へ反映する
UPDATE daily_summary SET pv1_kwh = 1.3576, pv2_kwh = 1.3910, pv3_kwh = 1.2623, pv4_kwh = 0.9091 WHERE jst_date = '2026-10-28' AND ABS(COALESCE(solar_kwh, 0) - 4.92) < 0.01;
UPDATE daily_summary SET pv1_kwh = 3.1213, pv2_kwh = 2.7256, pv3_kwh = 2.7111, pv4_kwh = 1.2120 WHERE jst_date = '2026-10-29' AND ABS(COALESCE(solar_kwh, 0) - 9.77) < 0.01;
UPDATE daily_summary SET pv1_kwh = 2.5536, pv2_kwh = 2.4272, pv3_kwh = 2.2436, pv4_kwh = 1.1156 WHERE jst_date = '2026-10-30' AND ABS(COALESCE(solar_kwh, 0) - 8.34) < 0.01;
UPDATE daily_summary SET pv1_kwh = 5.5942, pv2_kwh = 5.3270, pv3_kwh = 4.6466, pv4_kwh = 1.2422 WHERE jst_date = '2026-10-31' AND ABS(COALESCE(solar_kwh, 0) - 16.81) < 0.01;
UPDATE daily_summary SET pv1_kwh = 4.4621, pv2_kwh = 5.1532, pv3_kwh = 3.7924, pv4_kwh = 1.4423 WHERE jst_date = '2026-11-01' AND ABS(COALESCE(solar_kwh, 0) - 14.85) < 0.01;
UPDATE daily_summary SET pv1_kwh = 0.8224, pv2_kwh = 1.2713, pv3_kwh = 0.8121, pv4_kwh = 0.7842 WHERE jst_date = '2026-11-02' AND ABS(COALESCE(solar_kwh, 0) - 3.69) < 0.01;
UPDATE daily_summary SET pv1_kwh = 3.7104, pv2_kwh = 3.3943, pv3_kwh = 3.1634, pv4_kwh = 1.1519 WHERE jst_date = '2026-11-03' AND ABS(COALESCE(solar_kwh, 0) - 11.42) < 0.01;
UPDATE daily_summary SET pv1_kwh = 1.0323, pv2_kwh = 1.0555, pv3_kwh = 0.9524, pv4_kwh = 0.6498 WHERE jst_date = '2026-11-04' AND ABS(COALESCE(solar_kwh, 0) - 3.69) < 0.01;
UPDATE daily_summary SET pv1_kwh = 1.7128, pv2_kwh = 1.6179, pv3_kwh = 1.5058, pv4_kwh = 0.7335 WHERE jst_date = '2026-11-05' AND ABS(COALESCE(solar_kwh, 0) - 5.57) < 0.01;
UPDATE daily_summary SET pv1_kwh = 4.9150, pv2_kwh = 4.9169, pv3_kwh = 4.0564, pv4_kwh = 0.9317 WHERE jst_date = '2026-11-06' AND ABS(COALESCE(solar_kwh, 0) - 14.82) < 0.01;
UPDATE daily_summary SET pv1_kwh = 5.2742, pv2_kwh = 4.8980, pv3_kwh = 4.3672, pv4_kwh = 1.0306 WHERE jst_date = '2026-11-07' AND ABS(COALESCE(solar_kwh, 0) - 15.57) < 0.01;
UPDATE daily_summary SET pv1_kwh = 4.9417, pv2_kwh = 4.5632, pv3_kwh = 4.0842, pv4_kwh = 0.9209 WHERE jst_date = '2026-11-08' AND ABS(COALESCE(solar_kwh, 0) - 14.51) < 0.01;
UPDATE daily_summary SET pv1_kwh = 0.6374, pv2_kwh = 0.6653, pv3_kwh = 0.6009, pv4_kwh = 0.4564 WHERE jst_date = '2026-11-09' AND ABS(COALESCE(solar_kwh, 0) - 2.36) < 0.01;
UPDATE daily_summary SET pv1_kwh = 0.8353, pv2_kwh = 0.7952, pv3_kwh = 0.8056, pv4_kwh = 0.6739 WHERE jst_date = '2026-11-10' AND ABS(COALESCE(solar_kwh, 0) - 3.11) < 0.01;
UPDATE daily_summary SET pv1_kwh = 5.1179, pv2_kwh = 4.8673, pv3_kwh = 4.2114, pv4_kwh = 0.8434 WHERE jst_date = '2026-11-11' AND ABS(COALESCE(solar_kwh, 0) - 15.04) < 0.01;
UPDATE daily_summary SET pv1_kwh = 4.9348, pv2_kwh = 4.6523, pv3_kwh = 4.0643, pv4_kwh = 0.8186 WHERE jst_date = '2026-11-12' AND ABS(COALESCE(solar_kwh, 0) - 14.47) < 0.01;
UPDATE daily_summary SET pv1_kwh = 5.0211, pv2_kwh = 4.7082, pv3_kwh = 4.1289, pv4_kwh = 0.7918 WHERE jst_date = '2026-11-13' AND ABS(COALESCE(solar_kwh, 0) - 14.65) < 0.01;
UPDATE daily_summary SET pv1_kwh = 2.3801, pv2_kwh = 3.6861, pv3_kwh = 2.1276, pv4_kwh = 1.2162 WHERE jst_date = '2026-11-14' AND ABS(COALESCE(solar_kwh, 0) - 9.41) < 0.01;
UPDATE daily_summary SET pv1_kwh = 0.7102, pv2_kwh = 0.7919, pv3_kwh = 0.7219, pv4_kwh = 0.7060 WHERE jst_date = '2026-11-15' AND ABS(COALESCE(solar_kwh, 0) - 2.93) < 0.01;

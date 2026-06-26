-- SwingSight — reference data seed (Phase 2)
-- Mirrors app/src/domain/faultLibrary.ts (FAULT_LIBRARY_VERSION 2026.06.0). The
-- worker and app both carry this in code; the DB copy is the versioned record the
-- report joins against and the validation layer regresses. Idempotent so it is
-- safe to re-apply.

-- ---------------------------------------------------------------------------
-- Drills (vetted catalogue) — DRILLS in faultLibrary.ts
-- ---------------------------------------------------------------------------
insert into public.drills (id, title, steps, target_metric_key, improvement_direction) values
  ('towel_extension', 'Towel-under-lead-arm extension',
   array[
     'Tuck a small towel under your lead armpit at address.',
     'Make slow half-swings, keeping the towel pinned through impact.',
     'Feel the lead arm stay long and extend down the target line after the ball.'
   ], 'lead_elbow_flexion_impact_deg', 'decrease'),
  ('release_extension', 'Two-tee extension gate',
   array[
     'Place a tee just past the ball on the target line.',
     'Swing trying to brush the second tee with the clubhead after impact.',
     'This trains the arms to keep extending instead of folding up.'
   ], 'lead_elbow_flexion_impact_deg', 'decrease'),
  ('tilt_away_drill', 'Tilt-away at the top',
   array[
     'At address, feel your trail shoulder slightly lower than the lead.',
     'As you reach the top, keep your spine tilted away from the target.',
     'Avoid letting your upper body lean toward the target going back.'
   ], 'reverse_spine_deg', 'decrease'),
  ('wall_head_drill', 'Steady-head wall drill',
   array[
     'Stand so the top of your head lightly touches a wall at address.',
     'Make slow swings keeping your head in contact with the wall to the top.',
     'Quiet the head; let the body turn around a stable center.'
   ], 'head_sway_cm', 'decrease'),
  ('pump_drill', 'Downswing pump drill',
   array[
     'Take the club to the top, then pump the hands down toward your trail pocket.',
     'Repeat two pumps, then swing through, keeping the club on the inside path.',
     'Trains the downswing to drop under the plane instead of over the top.'
   ], 'over_the_top_deg', 'decrease'),
  ('headcover_gate', 'Headcover outside gate',
   array[
     'Place a headcover just outside the ball, along the target line.',
     'Swing without hitting the headcover on the way down.',
     'Forces an inside, shallower downswing path.'
   ], 'over_the_top_deg', 'decrease'),
  ('chair_drill', 'Glute-on-chair drill',
   array[
     'Set a chair so your trail glute just touches it at address.',
     'Keep both glutes touching their reference through the downswing.',
     'Stops the hips from thrusting toward the ball (early extension).'
   ], 'early_extension_cm', 'decrease'),
  ('belt_buckle_back', 'Hips-back through impact',
   array[
     'Feel your trail hip move back and around, not toward the ball.',
     'Keep your belt buckle behind its address position into impact.',
     'Maintains posture and room for the arms to swing down.'
   ], 'early_extension_cm', 'decrease')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Fault library (5 launch faults) — FAULT_LIBRARY in faultLibrary.ts
-- ---------------------------------------------------------------------------
insert into public.fault_library
  (id, version, name, views, severity_weight, gate, highlight,
   explanation_hook, ball_flight_hook, headline_template, why_template, drill_ids)
values
  ('chicken_wing', '2026.06.0', 'Chicken wing',
   array['face_on']::public.swing_view[], 0.95,
   '{"metricKey":"lead_elbow_flexion_impact_deg","operator":"exceeds","threshold":{"min":22},"requires3d":false,"minKeypointConfidence":0.4}'::jsonb,
   '{"joints":["lead_shoulder","lead_elbow","lead_wrist"],"phaseWindow":{"start":"impact","end":"mid_follow_through"}}'::jsonb,
   'The lead arm folds (elbow bends) through impact instead of extending, often because the body stops rotating or the hands work up rather than left. The effect is a loss of width and speed and inconsistent strike.',
   'Tends to produce a weak, high, or pushed/leaked-right shot for a right-hander.',
   'Your lead arm is folding through impact',
   'Your lead elbow stays bent (about {value}°) past impact instead of extending. That loses width and speed and makes the strike inconsistent.',
   array['towel_extension','release_extension']),

  ('reverse_spine_angle', '2026.06.0', 'Reverse spine angle',
   array['face_on']::public.swing_view[], 0.8,
   '{"metricKey":"reverse_spine_deg","operator":"exceeds","threshold":{"min":8},"requires3d":false,"minKeypointConfidence":0.4}'::jsonb,
   '{"joints":["pelvis_mid","shoulder_mid","head"],"phaseWindow":{"start":"mid_backswing","end":"top"}}'::jsonb,
   'The upper body leans toward the target at the top, reversing the spine tilt. It limits rotation, stresses the lower back, and makes a consistent downswing hard.',
   'Often linked to fat/thin strikes and a loss of power.',
   'Your spine is tilting toward the target at the top',
   'At the top your upper body leans toward the target (about {value}°) instead of staying tilted away. That cramps your turn and hurts the strike.',
   array['tilt_away_drill']),

  ('excessive_head_movement', '2026.06.0', 'Excessive head movement',
   array['face_on']::public.swing_view[], 0.7,
   '{"metricKey":"head_sway_cm","operator":"exceeds","threshold":{"min":6},"requires3d":false,"minKeypointConfidence":0.5}'::jsonb,
   '{"joints":["head"],"phaseWindow":{"start":"address","end":"impact"}}'::jsonb,
   'The head drifts laterally during the swing instead of staying over a stable center, which moves the low point and makes solid contact harder to repeat.',
   'Contributes to inconsistent strike — thins and fats.',
   'Your head is moving off the ball',
   'Your head sways about {value} cm during the swing. A steadier center makes the bottom of your swing more repeatable.',
   array['wall_head_drill']),

  ('over_the_top', '2026.06.0', 'Over the top',
   array['dtl']::public.swing_view[], 0.9,
   '{"metricKey":"over_the_top_deg","operator":"exceeds","threshold":{"min":6},"requires3d":false,"minKeypointConfidence":0.4}'::jsonb,
   '{"joints":["trail_shoulder","trail_elbow","trail_wrist"],"phaseWindow":{"start":"top","end":"mid_downswing"}}'::jsonb,
   'From the top the club and trail arm move out and over the plane, throwing the downswing path to the outside. It is the classic slice/pull pattern.',
   'Typically a slice or a pull for a right-hander.',
   'Your downswing is coming over the top',
   'Your hands and trail arm start out and over the plane on the way down (about {value}° steep). That sends the club across the ball.',
   array['pump_drill','headcover_gate']),

  ('early_extension', '2026.06.0', 'Early extension',
   array['dtl']::public.swing_view[], 0.85,
   '{"metricKey":"early_extension_cm","operator":"exceeds","threshold":{"min":6},"requires3d":false,"minKeypointConfidence":0.4}'::jsonb,
   '{"joints":["lead_hip","pelvis_mid","trail_hip"],"phaseWindow":{"start":"mid_downswing","end":"impact"}}'::jsonb,
   'The hips thrust toward the ball in the downswing and the posture stands up, crowding the arms and forcing compensations to find the ball.',
   'Leads to blocks, hooks, and inconsistent contact.',
   'Your hips are moving toward the ball',
   'Your hips push toward the ball about {value} cm in the downswing and you stand up out of posture. Keeping your hips back gives the arms room.',
   array['chair_drill','belt_buckle_back'])
on conflict (id, version) do nothing;

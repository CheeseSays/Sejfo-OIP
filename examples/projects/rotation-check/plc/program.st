(* Rotation check on one belt. Start runs the belt and the infeed; Stop drops both.

   The infeed turns each box to a random heading as it drops. The Vision Inspector arch over the belt at x = 2.5 m
   measures how far each box is turned from lying straight along the belt. It pulses Inspected once per box and
   holds RotationOk (true when the box is within 10 degrees, a half turn counting as straight) and
   Deviation (degrees, + turned left) until the next box.

   A box that is turned too far latches RotationAlarm and counts in Rejected. The alarm stays latched until Reset.
   The belt keeps running: a real line would divert the box here, which needs a diverter this example leaves out.
   tests/rotation.test.json checks the alarm and the counts. *)
VAR_INPUT
  Start : BOOL;
  Stop : BOOL;
  Reset : BOOL;
  Inspected : BOOL;
  RotationOk : BOOL;
END_VAR
VAR_OUTPUT
  BeltRun : BOOL;
  Infeed : BOOL;
  RotationAlarm : BOOL;
  Rejected : DINT;
END_VAR
VAR
  Seen : R_TRIG;
END_VAR

Seen(CLK := Inspected);
IF Reset THEN
  RotationAlarm := FALSE;
END_IF;
IF Seen.Q AND NOT RotationOk THEN
  RotationAlarm := TRUE;
  Rejected := Rejected + 1;
END_IF;

BeltRun := (BeltRun OR Start) AND NOT Stop;
Infeed := BeltRun;

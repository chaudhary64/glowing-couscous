/*
  This file used to carry `intakeSamples`, four authored submissions the capture console
  walked to show four verdict paths. The console now reads the submissions the database
  actually holds, through `listRecentIntakes`, so the fixtures are gone rather than left
  here unused — a fixture nobody reads is one that can only ever go stale.

  What is left is the one counter the public landing page quotes.
*/

/*
  The languages the intake pipeline actually handles.

  This list held four — Hindi, Marathi, Gujarati, Tamil — under a panel headed "Languages in
  the pilot". Only Hindi is wired: `ITEM_SYSTEM_INSTRUCTION` asks the model for a Hindi voice
  note, `itemPrompt` describes the transcript as Hindi, and `parseIntake` defaults every
  transcript's language to `Hindi (hi-IN)`. There is no recogniser, no prompt and no test for
  the other three, so they are gone until there is. The count that matters — how often a
  voice note is the input — comes from the stored records, not from here.
*/
export const intakeLanguages = ["Hindi"] as const;

/** Simple counters for the intake header. */
export const intakeStats = {
  voiceShare: 0.63,
};

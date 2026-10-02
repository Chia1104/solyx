/** Where a skill comes from, which decides whether it is offered and which one wins a name. */
export const SkillSource = {
  /** `skills/` in the app's config folder: the user's own, always offered, ahead of built-ins. */
  Solyx: "solyx",
  BuiltIn: "built-in",
  /** `~/.agents/skills`, shared with other agents: offered only once the user switches one on. */
  Shared: "shared",
} as const;

export type SkillSource = (typeof SkillSource)[keyof typeof SkillSource];

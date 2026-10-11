/** A learned-skill name as the memory inbox and skills/ folders use it: lowercase words joined by single hyphens. */
export const isSkillName = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)

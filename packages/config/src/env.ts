import { z } from 'zod';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface ConfigIssue {
  /** Name of the environment variable, or "(environment)" for cross-variable rules. */
  readonly variable: string;
  /** Human-readable problem. Never contains the offending value. */
  readonly problem: string;
}

/**
 * Thrown when the environment does not satisfy a schema. The message names every invalid
 * variable and why, and never includes a variable's value (values may be secrets).
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(formatConfigIssues(issues));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.problem}`);
  return `Invalid configuration. Fix these environment variables (see .env.example):\n${lines.join('\n')}`;
}

function describe(issue: z.core.$ZodIssue, hasValue: boolean): string {
  if (!hasValue) return 'is required but not set';
  switch (issue.code) {
    case 'invalid_value':
      return 'is not one of the allowed values';
    case 'invalid_type':
      return 'has the wrong type';
    case 'too_small':
      return 'is too short or too small';
    case 'too_big':
      return 'is too long or too large';
    case 'invalid_format':
      return 'has an invalid format';
    default:
      // Custom rules are authored in this repo and are written without the value.
      return issue.message;
  }
}

/**
 * Parses an environment source against a Zod object schema. Defaults, coercion, and
 * cross-variable refinements live in the schema. Throws ConfigError on any problem.
 */
export function parseEnv<S extends z.ZodObject>(schema: S, source: EnvSource): z.infer<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const seen = new Set<string>();
  const issues: ConfigIssue[] = [];
  for (const issue of result.error.issues) {
    const variable = typeof issue.path[0] === 'string' ? issue.path[0] : '(environment)';
    const hasValue = variable !== '(environment)' && source[variable] !== undefined;
    const problem = describe(issue, hasValue);
    const key = `${variable}|${problem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ variable, problem });
  }
  throw new ConfigError(issues);
}

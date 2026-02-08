import Ajv from "ajv";

const ajv = new Ajv();

export function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
): { valid: true } | { valid: false; errors: string } {
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    return { valid: false, errors: ajv.errorsText(validate.errors) };
  }
  return { valid: true };
}

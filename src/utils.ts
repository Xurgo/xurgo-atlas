import { z } from 'zod';

/**
 * Convert a Zod schema to a JSON Schema object suitable for MCP tool definitions.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodTypeToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return withDescription(schema, {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    });
  }

  // Fallback
  return withDescription(schema, { type: 'object' });
}

function zodTypeToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodString) {
    return withDescription(schema, { type: 'string' });
  }
  if (schema instanceof z.ZodNumber) {
    return withDescription(schema, { type: 'number' });
  }
  if (schema instanceof z.ZodBoolean) {
    return withDescription(schema, { type: 'boolean' });
  }
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return zodTypeToJsonSchema(schema.removeDefault());
  }
  if (schema instanceof z.ZodArray) {
    return withDescription(schema, {
      type: 'array',
      items: zodTypeToJsonSchema(schema.element),
    });
  }
  if (schema instanceof z.ZodEnum) {
    return withDescription(schema, {
      type: 'string',
      enum: schema._def.values as string[],
    });
  }
  if (schema instanceof z.ZodObject) {
    return zodToJsonSchema(schema);
  }

  return withDescription(schema, { type: 'string' });
}

function withDescription(
  schema: z.ZodType,
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  const description = (schema as z.ZodType & { description?: string }).description;
  if (!description) {
    return jsonSchema;
  }

  return {
    ...jsonSchema,
    description,
  };
}

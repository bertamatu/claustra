type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

// Zod-like
export const Schema = {
  parse: <T>(input: unknown): T => input as T,
  safeParse: <T>(input: unknown): ParseResult<T> => ({ success: true, data: input as T }),
};

// Valibot-like (free function)
export const parse = <T>(_schema: unknown, input: unknown): T => input as T;
export const ValibotSchema = {};

// Yup-like
export const YupSchema = {
  validateSync: <T>(input: unknown): T => input as T,
  validate: async <T>(input: unknown): Promise<T> => input as T,
};

// ArkType-like
export const ArkSchema = {
  assert: <T>(input: unknown): T => input as T,
};

// next/cache stubs (the real `next/cache` isn't installed in this fixture)
export const revalidatePath = (_path: string): void => {};
export const revalidateTag = (_tag: string): void => {};

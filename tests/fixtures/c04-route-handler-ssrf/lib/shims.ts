// Synthetic shims used only to give c04 fixtures something to import
// without pulling node_modules. Never installed, never executed.
export const axios = {
  get: async (_url: string): Promise<unknown> => ({}),
  post: async (_url: string, _body?: unknown): Promise<unknown> => ({}),
};

export const got = async (_url: string): Promise<unknown> => ({});

export class ImageResponse {
  constructor(_options: { src: string; width?: number; height?: number }) {}
}

export const ALLOWED_HOSTS = ['api.example.com', 'cdn.example.com'];
export const isAllowedUrl = (_url: string): boolean => true;

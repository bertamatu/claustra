// Synthetic config used only to exercise claustra's a03 rule.
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Violation: high-entropy base64 string inlined into env block.
    // (Stripe-shaped values are covered by a separate runtime-constructed
    // test so this file does not trip GitHub's secret-scanning protection.)
    NEXT_PUBLIC_INLINE_TOKEN: 'Xq7vK2pQ8mN4sF6dG9hL3bR1tY5wZ0cE8oP2nM6k',
    // Non-violation: stable API URL.
    NEXT_PUBLIC_API_BASE: 'https://api.example.com/v1',
    // Non-violation: publishable key.
    NEXT_PUBLIC_PK: 'pk_test_NotARealKeyJustAFixturePlaceholder',
  },
};

export default nextConfig;

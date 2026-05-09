// Server component (no 'use client') - leaking should NOT be flagged here.
export const ServerCard = (_p: { user?: unknown; secret?: string }): JSX.Element => <div>sc</div>;

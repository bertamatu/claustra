// No 'use client' — this is a server component. Function props are fine here.
export type ServerCounterProps = {
  cb?: () => void;
};

export const ServerCounter = (_p: ServerCounterProps): JSX.Element => <span>sc</span>;

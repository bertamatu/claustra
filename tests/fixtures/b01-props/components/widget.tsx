'use client';
import type { ReactNode } from 'react';
import type { UserClass } from '../lib/user-class.js';

export type WidgetProps = {
  cb?: () => void;
  asyncCb?: () => Promise<void>;
  date?: Date;
  map?: Map<string, string>;
  set?: Set<string>;
  big?: bigint;
  sym?: symbol;
  promise?: Promise<string>;
  user?: UserClass;
  children?: ReactNode;
  data?: string;
  count?: number;
};

export const Widget = (_p: WidgetProps): JSX.Element => <span>widget</span>;

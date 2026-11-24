import type { NextApiRequest, NextApiResponse } from 'next';
import { release } from '@rr/core';

export default function handler(_req: NextApiRequest, res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'no-store').json({ release });
}

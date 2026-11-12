import { z } from 'zod';

export const nameSchema = z.string().normalize('NFKC').trim()
  .min(1, 'Please enter a short name.').max(32, 'Use 32 characters or fewer.')
  .refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), 'Names cannot contain hidden or control characters.');

// Comparison key so "Chris", "CHRIS" and "chris" (or full-width variants) count as the same name.
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const giftUrl = z.string().trim().max(2048).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'Use a public http or https gift link without login details.' });
      return z.NEVER;
    }
    url.hash = '';
    return url.href;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Please enter a complete gift URL.' });
    return z.NEVER;
  }
});

export const giftSchema = z.object({
  url: giftUrl,
  priceCents: z.number().int().min(1, 'Enter a price above $0.').max(5000, 'Each gift must cost AUD $50 or less.'),
  description: z.string().trim().max(300, 'Keep descriptions to 300 characters.'),
});

export const wishlistSchema = z.array(giftSchema).max(3, 'You can add up to three gifts.').superRefine((gifts, ctx) => {
  const seen = new Set<string>();
  gifts.forEach((gift, index) => {
    if (seen.has(gift.url)) {
      ctx.addIssue({ code: 'custom', path: [index, 'url'], message: 'Each gift must have a different URL.' });
    }
    seen.add(gift.url);
  });
});

export type Gift = z.infer<typeof giftSchema>;
export type Member = { id: string; shortName: string; gifts: Gift[] };
export type CurrentUser = { id: string; shortName: string | null; member: boolean; gifts: Gift[] };
export type SessionInfo = { user: CurrentUser | null; providers: { google: boolean; facebook: boolean } };

export function priceToCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return NaN;
  return Math.round(Number(value) * 100);
}

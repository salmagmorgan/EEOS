/* The Board Consulting — official visual identity (lock-up & colours guideline).
   Use these everywhere TBC-branded output is produced (PDFs, exports, emails).
   Logo files: client/public/brand/
     tbc-lockup-white.png / tbc-lockup-black.png — TBC monogram + "The Board Consulting" + "Insights . Strategy . Impact"
     tbc-mark-white.png   / tbc-mark-black.png   — TBC monogram only (headers)
   Layout signature: a black header band with the white TBC monogram on the left, a thin white
   line across, and the section title on the right; content on white below. */
export const TBC = {
  name: 'The Board Consulting',
  tagline: 'Insights . Strategy . Impact',
  // Primary
  black: '#100F0D',
  white: '#FFFFFF',
  grey: '#6A6B6D',
  // Secondary
  indigo: '#4A49A7',
  lavender: '#B1A7DA',
  navy: '#2B2D6E',
  // Accent
  red: '#ED2429',
  pink: '#F47381',
  maroon: '#811A1B',
} as const;

/** Status colours in TBC brand colours (labels are always printed next to them). */
export const TBC_STATUS = {
  'on-track': TBC.indigo,
  'at-risk': TBC.pink,
  'off-track': TBC.red,
} as const;

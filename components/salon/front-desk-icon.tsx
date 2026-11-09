import { createLucideIcon } from 'lucide-react'

/**
 * The Front Desk mark: a service bell on a reception desk. Drawn like the other line icons
 * (lucide), so it takes the same size, colour and stroke props wherever an icon goes.
 */
export const FrontDeskIcon = createLucideIcon('front-desk', [
  ['path', { d: 'M12 6v2.5', key: 'knob' }],
  ['path', { d: 'M10.5 6h3', key: 'cap' }],
  ['path', { d: 'M6.5 13.5a5.5 5 0 0 1 11 0', key: 'bell' }],
  ['path', { d: 'M3 13.5h18', key: 'top' }],
  ['path', { d: 'M4.5 13.5V20h15v-6.5', key: 'desk' }],
  ['path', { d: 'M10 16.75h4', key: 'drawer' }],
])

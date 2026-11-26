// ZP-1200: the Pixel config for one storefront request (layout and product page share one read). Server only.
import { cache } from 'react'
import prisma from '@/lib/db'
import { loadPixelConfigForStorefront } from './pixel'

export const getStorefrontPixel = cache(() => loadPixelConfigForStorefront(prisma))

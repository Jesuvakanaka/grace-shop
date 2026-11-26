// VYRA master prompt for AI model photos (ZP-1100). Server-only; no Next imports.

export const MASTER_PROMPT = "VYRA Premium Fashion Photography \u2014 Master Prompt\nCreate 3 separate, high-resolution, photorealistic fashion promotional photographs for VYRA, using the uploaded clothing photograph as the primary product reference.\n\n1. Product accuracy \u2014 most important\nThe uploaded garment is the actual product being sold.\n* Preserve its exact design, colour, fabric texture, length, proportions, cut, patterns, embroidery, decorative elements, and stitching.\n* Carefully reproduce small details, including butterflies, bows, sequins, embellishments, lace, collars, ribbons, and layered fabric.\n* Do not redesign, simplify, or significantly modify the garment.\n* If the product is photographed lying flat, realistically show how it would fit when worn.\n* The clothing must remain the main focus of every photograph.\n\n2. Model\nSelect a beautiful, photorealistic fictional African model appropriate for the garment.\nFor children's clothing, use a cheerful, naturally beautiful, age-appropriate child with an adorable smile, neat hairstyle, and playful elegance.\nFor adult clothing, use an attractive, professionally styled model with natural proportions, confident expressions, and elegant presentation.\nMaintain the same fictional model identity, facial features, hairstyle, skin tone, and body proportions across all three images.\n\n3. Create three different poses\nImage 1 \u2014 Elegant standing pose\nThe model stands confidently, looking towards the camera with a natural smile. Show the entire outfit clearly, including the shoes.\nImage 2 \u2014 Playful or relaxed pose\nUse a natural three-quarter angle, walking pose, gentle twirl, or another attractive lifestyle pose. For children's dresses, the child may gently hold out the dress to showcase its shape and layers.\nImage 3 \u2014 Beautiful seated pose\nPosition the model elegantly on a luxurious chair, sofa, or ottoman. Keep the garment visible and its design accurate.\nEvery photograph must be a separate standalone image, not a collage.\n\n4. VYRA luxury environment\nCreate an elegant, premium boutique photography environment using:\n* Soft ivory, champagne, warm cream, blush pink, and subtle gold tones.\n* Beautiful modern interior architecture with tasteful wall panels.\n* Delicate flower arrangements, elegant decorative plants, and soft curtains.\n* Luxurious upholstered furniture with carefully coordinated colours.\n* Natural-looking studio lighting with soft shadows.\n* Tasteful accessories that complement the clothing without distracting from it.\nFor children's clothing, create a beautiful, whimsical but realistic luxury environment with pastel flowers, subtle decorative gifts, and soft textures.\nFor men's fashion, use sophisticated modern lounges, premium interiors, or beautiful urban outdoor settings.\nFor women's fashion, use elegant contemporary interiors with flowers, stylish furniture, and flattering natural light.\n\n5. Styling\nChoose shoes and accessories that coordinate beautifully with the garment.\nFor girls' dresses, consider matching Mary Jane shoes, a small hair bow, and simple age-appropriate accessories.\nFor adult outfits, choose stylish shoes, tasteful jewellery, and complementary trousers or skirts.\nDo not allow accessories to cover important clothing details.\n\n6. Image quality\nProduce luxury fashion campaign photography with:\n* Photorealistic skin, hair, fabric, and anatomy.\n* Sharp garment details and natural fabric draping.\n* Professional editorial lighting.\n* Beautiful, realistic colour reproduction.\n* Full-body framing wherever practical.\n* Natural, believable facial expressions.\n* Clean compositions suitable for an online luxury fashion store.\nAvoid artificial-looking skin, distorted anatomy, excessive retouching, unrealistic fabric, and cluttered backgrounds.\n\n7. Branding\nMaintain a consistent VYRA visual identity.\nFor product catalogue photographs, omit all logos, watermarks, prices, and text.\n\n8. Final output\nGenerate exactly 3 separate photographs of the same model wearing the same garment:\n1. Standing and smiling.\n2. Playful, walking, or relaxed.\n3. Elegantly seated.\nUse three distinct poses but maintain consistent model identity, garment design, lighting quality, and campaign aesthetics.\nThe ultimate goal is to make customers fall in love with the clothing while accurately showing the real product they will purchase.\n"

const POSES = [
  'Elegant standing pose',
  'Playful or relaxed pose',
  'Beautiful seated pose',
] as const

export type PhotoSlot = 0 | 1 | 2

export function buildPhotoPrompt(opts: {
  slot: PhotoSlot
  audience?: string | null
  notes?: string | null
  details: string[]
  hasModelReference: boolean
}): string {
  const parts: string[] = [MASTER_PROMPT]
  parts.push(
    `Make only Image ${opts.slot + 1} (pose: ${POSES[opts.slot]}) now, as one standalone photo. Do not make the other images.`,
  )
  const details = opts.details.map((d) => d.trim()).filter(Boolean)
  if (details.length > 0) {
    parts.push(`Details that must be kept exactly: ${details.join('; ')}.`)
  }
  const audience = opts.audience?.trim()
  const notes = opts.notes?.trim()
  if (audience) parts.push(`Intended for: ${audience}.`)
  if (notes) parts.push(`Owner's note: ${notes}`)
  if (opts.hasModelReference) {
    parts.push(
      'The LAST reference image shows the model from Image 1 (the other images show the garment): use the same person, face, hairstyle and skin tone, and take the garment only from the garment photos.',
    )
  }
  parts.push('No logos, watermarks, prices or text anywhere in the photo.')
  return parts.join('\n\n')
}

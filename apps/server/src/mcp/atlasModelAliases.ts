/**
 * Code Atlas: agents may name a model by its family ("sol", "astra", "luna",
 * "opus", "sonnet") when delegating; this picks the provider's advertised slug
 * for it, the first listed (the catalog lists newer models first). An exact
 * slug, or a name no model matches, is returned unchanged.
 */
export function resolveAtlasModelAlias(
  requested: string,
  advertised: ReadonlyArray<{ readonly slug: string }>,
): string {
  if (advertised.some((model) => model.slug === requested)) return requested;
  const alias = requested.trim().toLowerCase();
  if (!/^[a-z]+$/.test(alias)) return requested;
  // Never the vendor prefix: "gpt" or "claude" alone names no family.
  const family = new RegExp(`[-.]${alias}($|[-.])`);
  return advertised.find((model) => family.test(model.slug.toLowerCase()))?.slug ?? requested;
}

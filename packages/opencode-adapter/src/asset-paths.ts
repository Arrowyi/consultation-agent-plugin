import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export function resolveAsset(asset: string): string {
  return resolveAssetFromUrl(asset, import.meta.url)
}

export function resolveAssetFromUrl(asset: string, moduleUrl: string): string {
  const primary = fileURLToPath(new URL(`../../../assets/${asset}`, moduleUrl))
  if (existsSync(primary)) return primary

  let directory = dirname(fileURLToPath(moduleUrl))
  for (let level = 0; level < 6; level += 1) {
    const candidate = join(directory, "assets", asset)
    if (existsSync(candidate)) return candidate
    directory = dirname(directory)
  }
  return primary
}

export async function resolveAssetPath(asset: string): Promise<string> {
  return resolveAsset(asset)
}

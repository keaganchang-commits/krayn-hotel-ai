import fs from 'fs';
import path from 'path';

export interface BusinessAsset {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  description?: string;
  purpose?: string;
  whenToShare?: string;
  relevantTopics?: string[];
  extractedFactsCount?: number;
}

const ASSET_DIR = path.join(process.cwd(), 'data', 'assets');
const ASSET_META_FILE = path.join(process.cwd(), 'data', 'assets_meta.json');

function ensureDirectories() {
  if (!fs.existsSync(ASSET_DIR)) {
    fs.mkdirSync(ASSET_DIR, { recursive: true });
  }
  if (!fs.existsSync(path.dirname(ASSET_META_FILE))) {
    fs.mkdirSync(path.dirname(ASSET_META_FILE), { recursive: true });
  }
}

export function listBusinessAssets(): BusinessAsset[] {
  ensureDirectories();
  if (!fs.existsSync(ASSET_META_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(ASSET_META_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveBusinessAsset(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  description?: string
): BusinessAsset {
  ensureDirectories();
  const id = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const ext = path.extname(originalName) || '';
  const safeFilename = `${id}${ext}`;
  const filePath = path.join(ASSET_DIR, safeFilename);

  fs.writeFileSync(filePath, fileBuffer);

  const asset: BusinessAsset = {
    id,
    name: originalName,
    filename: safeFilename,
    mimeType: mimeType || 'application/octet-stream',
    size: fileBuffer.length,
    uploadedAt: new Date().toISOString(),
    description: description || originalName,
  };

  const assets = listBusinessAssets();
  assets.unshift(asset);
  fs.writeFileSync(ASSET_META_FILE, JSON.stringify(assets, null, 2));

  return asset;
}

export function deleteBusinessAsset(id: string): boolean {
  ensureDirectories();
  const assets = listBusinessAssets();
  const target = assets.find(a => a.id === id);
  if (!target) return false;

  const filePath = path.join(ASSET_DIR, target.filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Could not delete physical asset file:', e);
    }
  }

  const updated = assets.filter(a => a.id !== id);
  fs.writeFileSync(ASSET_META_FILE, JSON.stringify(updated, null, 2));
  return true;
}

export function updateBusinessAsset(id: string, updates: Partial<BusinessAsset>): BusinessAsset | null {
  ensureDirectories();
  const assets = listBusinessAssets();
  const idx = assets.findIndex(a => a.id === id);
  if (idx === -1) return null;

  assets[idx] = { ...assets[idx], ...updates };
  fs.writeFileSync(ASSET_META_FILE, JSON.stringify(assets, null, 2));
  return assets[idx];
}

export function getAssetFilePath(filename: string): string | null {
  const filePath = path.join(ASSET_DIR, filename);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

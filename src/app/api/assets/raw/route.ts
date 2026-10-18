import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { listBusinessAssets, getAssetFilePath } from '@/lib/assets/storage';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('id');
    const filename = searchParams.get('filename');

    const assets = listBusinessAssets();
    const asset = assets.find(a => (assetId && a.id === assetId) || (filename && a.filename === filename));

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const filePath = getAssetFilePath(asset.filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Asset file not found on disk' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': asset.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${asset.name}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to serve asset' }, { status: 500 });
  }
}
